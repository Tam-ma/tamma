using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Stripe;
using Stripe.Billing;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Core;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-3 (AC6, AC7, AC10, AC12, AC13, AC14) — tests for
/// <see cref="MeterEventFlushTaskHandler"/>, plus <see cref="StripeBillingProvider"/>
/// meter-event / summary delegation and <see cref="NullBillingProvider"/> SaaS-only guards.
/// </summary>
[TestFixture]
public class MeterEventFlushTaskHandlerTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 14, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime PeriodStart = new(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private Mock<IBillingProvider> _billing = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<IPlatformQueuedTaskRepository> _taskQueue = null!;
    private StubTimeProvider _clock = null!;
    private MeterEventFlushTaskHandler _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"meter-flush-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);

        _billing = new Mock<IBillingProvider>();
        _billing.SetupGet(b => b.IsEnabled).Returns(true);

        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent evt) => evt);

        _taskQueue = new Mock<IPlatformQueuedTaskRepository>();
        _taskQueue.Setup(q => q.EnqueueAsync(It.IsAny<PlatformQueuedTask>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlatformQueuedTask t, CancellationToken _) => t);

        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));

        _sut = new MeterEventFlushTaskHandler(
            _cp,
            _billing.Object,
            _events.Object,
            _taskQueue.Object,
            Options.Create(new BillingUsageOptions { MeterFlushIntervalSeconds = 60, MeterFlushBatchSize = 200 }),
            _clock,
            NullLogger<MeterEventFlushTaskHandler>.Instance);
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    private static PlatformQueuedTask MakeTask(string payload = "{}") => new()
    {
        Id = Guid.NewGuid(),
        Type = MeterEventFlushTaskHandler.TaskTypeName,
        Payload = payload,
        Status = "processing",
    };

    [Test]
    public async Task HandleAsync_Flushes_Pending_Rows_And_Marks_ReportedToStripe()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        var rowA = new BillingMeterEventBuffer
        {
            Id = Guid.NewGuid(),
            TenantId = tenantA,
            StripeCustomerId = "cus_tenant_a",
            EventName = BillingMeterNames.PlatformTokensInput,
            BillingMode = BillingModeTokens.Platform,
            Value = "5000",
            IdempotencyKey = $"{tenantA:D}:20260601:in:1",
            PeriodStart = PeriodStart,
            EventTimestamp = FixedNow.AddMinutes(-1),
            ReportedToStripe = false,
            CreatedAt = FixedNow.AddMinutes(-1),
        };
        var rowB = new BillingMeterEventBuffer
        {
            Id = Guid.NewGuid(),
            TenantId = tenantB,
            StripeCustomerId = "cus_tenant_b",
            EventName = BillingMeterNames.PlatformTokensOutput,
            BillingMode = BillingModeTokens.Platform,
            Value = "1200",
            IdempotencyKey = $"{tenantB:D}:20260601:out:1",
            PeriodStart = PeriodStart,
            EventTimestamp = FixedNow,
            ReportedToStripe = false,
            CreatedAt = FixedNow,
        };
        _cp.BillingMeterEventBuffers.AddRange(rowA, rowB);
        await _cp.SaveChangesAsync();

        _billing.Setup(b => b.ReportMeterEventAsync(It.IsAny<MeterEventReportRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((MeterEventReportRequest r, CancellationToken _) => new MeterEventReportResult($"evt_{r.IdempotencyKey}"));

        await _sut.HandleAsync(MakeTask(), CancellationToken.None);

        var savedA = await _cp.BillingMeterEventBuffers.SingleAsync(x => x.Id == rowA.Id);
        var savedB = await _cp.BillingMeterEventBuffers.SingleAsync(x => x.Id == rowB.Id);

        savedA.ReportedToStripe.Should().BeTrue();
        savedA.StripeEventId.Should().Be($"evt_{rowA.IdempotencyKey}");
        savedA.AttemptCount.Should().Be(1);
        savedA.LastAttemptAt.Should().Be(FixedNow);

        savedB.ReportedToStripe.Should().BeTrue();
        savedB.StripeEventId.Should().Be($"evt_{rowB.IdempotencyKey}");
        savedB.AttemptCount.Should().Be(1);

        // Tenant isolation: each tenant's usage reported strictly to its own StripeCustomerId.
        _billing.Verify(b => b.ReportMeterEventAsync(
            It.Is<MeterEventReportRequest>(r => r.StripeCustomerId == "cus_tenant_a" && r.Value == "5000"),
            It.IsAny<CancellationToken>()), Times.Once);
        _billing.Verify(b => b.ReportMeterEventAsync(
            It.Is<MeterEventReportRequest>(r => r.StripeCustomerId == "cus_tenant_b" && r.Value == "1200"),
            It.IsAny<CancellationToken>()), Times.Once);

        // Self-reschedules next cycle 60s later.
        _taskQueue.Verify(q => q.EnqueueAsync(
            It.Is<PlatformQueuedTask>(t =>
                t.Type == MeterEventFlushTaskHandler.TaskTypeName &&
                t.VisibleAt == FixedNow.AddSeconds(60)),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public async Task HandleAsync_Failure_Leaves_Row_Pending_Increments_Attempt_Emits_Event_And_Retries_Cleanly()
    {
        var tenantId = Guid.NewGuid();
        var idempotencyKey = $"{tenantId:D}:20260601:in:retry";
        var row = new BillingMeterEventBuffer
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeCustomerId = "cus_retry",
            EventName = BillingMeterNames.PlatformTokensInput,
            BillingMode = BillingModeTokens.Platform,
            Value = "2500",
            IdempotencyKey = idempotencyKey,
            PeriodStart = PeriodStart,
            EventTimestamp = FixedNow,
            ReportedToStripe = false,
            CreatedAt = FixedNow,
        };
        _cp.BillingMeterEventBuffers.Add(row);
        await _cp.SaveChangesAsync();

        // Attempt 1 fails transiently.
        _billing.Setup(b => b.ReportMeterEventAsync(It.IsAny<MeterEventReportRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Stripe 503"));

        await _sut.HandleAsync(MakeTask(), CancellationToken.None);

        var afterFail = await _cp.BillingMeterEventBuffers.SingleAsync(x => x.Id == row.Id);
        afterFail.ReportedToStripe.Should().BeFalse();
        afterFail.AttemptCount.Should().Be(1);
        afterFail.LastAttemptAt.Should().Be(FixedNow);
        afterFail.LastError.Should().Contain("Stripe 503");

        _events.Verify(e => e.AppendAsync(
            It.Is<DomainEvent>(d => d.Type == BillingMeterEventTypes.FlushFailed && d.TenantId == tenantId)),
            Times.Once);

        // Attempt 2 succeeds with the EXACT same IdempotencyKey (preventing double-billing).
        _clock.Advance(TimeSpan.FromSeconds(60));
        _billing.Setup(b => b.ReportMeterEventAsync(
                It.Is<MeterEventReportRequest>(r => r.IdempotencyKey == idempotencyKey),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MeterEventReportResult("stripe_evt_ok"));

        await _sut.HandleAsync(MakeTask(), CancellationToken.None);

        var afterRetry = await _cp.BillingMeterEventBuffers.SingleAsync(x => x.Id == row.Id);
        afterRetry.ReportedToStripe.Should().BeTrue();
        afterRetry.AttemptCount.Should().Be(2);
        afterRetry.StripeEventId.Should().Be("stripe_evt_ok");
        afterRetry.LastError.Should().BeNull();
    }

    [Test]
    public async Task HandleAsync_Empty_Buffer_Makes_Zero_Stripe_Calls()
    {
        await _sut.HandleAsync(MakeTask(), CancellationToken.None);

        _billing.Verify(b => b.ReportMeterEventAsync(
            It.IsAny<MeterEventReportRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task HandleAsync_Malformed_Payload_Throws_TerminalException()
    {
        var act = async () => await _sut.HandleAsync(MakeTask("{not-json"), CancellationToken.None);
        await act.Should().ThrowAsync<PlatformTaskTerminalException>();
    }

    [Test]
    public async Task HandleAsync_Disabled_Provider_Throws_TerminalException_With_Zero_Stripe_Calls()
    {
        _billing.SetupGet(b => b.IsEnabled).Returns(false);

        var act = async () => await _sut.HandleAsync(MakeTask(), CancellationToken.None);
        await act.Should().ThrowAsync<PlatformTaskTerminalException>();

        _billing.Verify(b => b.ReportMeterEventAsync(
            It.IsAny<MeterEventReportRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task StripeBillingProvider_Delegates_MeterEvent_And_Summaries_To_StripeServices()
    {
        var meterEvents = new Mock<MeterEventService>();
        meterEvents.Setup(s => s.CreateAsync(
                It.Is<MeterEventCreateOptions>(o =>
                    o.EventName == BillingMeterNames.PlatformTokensInput &&
                    o.Identifier == "idem-1" &&
                    o.Payload["stripe_customer_id"] == "cus_live_1" &&
                    o.Payload["value"] == "4200"),
                It.Is<RequestOptions>(ro => ro.IdempotencyKey == "idem-1"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MeterEvent { Identifier = "idem-1" });

        var meterSummaries = new Mock<MeterEventSummaryService>();
        meterSummaries.Setup(s => s.ListAsync(
                "mtr_in_123",
                It.Is<MeterEventSummaryListOptions>(o => o.Customer == "cus_live_1"),
                null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new StripeList<MeterEventSummary>
            {
                Data = new List<MeterEventSummary>
                {
                    new() { AggregatedValue = 3000 },
                    new() { AggregatedValue = 1200 },
                },
            });

        var stripeServices = new Mock<IStripeServices>();
        stripeServices.SetupGet(s => s.MeterEvents).Returns(meterEvents.Object);
        stripeServices.SetupGet(s => s.MeterEventSummaries).Returns(meterSummaries.Object);

        var factory = new Mock<IStripeServicesFactory>();
        factory.Setup(f => f.CreateAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(stripeServices.Object);

        var provider = new StripeBillingProvider(
            factory.Object,
            _cp,
            _events.Object,
            Options.Create(new BillingOptions()),
            NullLogger<StripeBillingProvider>.Instance);

        var res = await provider.ReportMeterEventAsync(new MeterEventReportRequest(
            BillingMeterNames.PlatformTokensInput, "cus_live_1", "4200", "idem-1", FixedNow));
        res.Identifier.Should().Be("idem-1");

        var total = await provider.GetMeterEventSummaryTotalAsync(
            "mtr_in_123", "cus_live_1", PeriodStart, PeriodStart.AddMonths(1));
        total.Should().Be(4200);
    }

    [Test]
    public async Task NullBillingProvider_Rejects_Meter_Calls_With_SaasOnly_Error()
    {
        var nullProvider = new NullBillingProvider();
        nullProvider.IsEnabled.Should().BeFalse();

        var reportAct = async () => await nullProvider.ReportMeterEventAsync(
            new MeterEventReportRequest(BillingMeterNames.PlatformTokensInput, "cus_1", "10", "k", FixedNow));
        (await reportAct.Should().ThrowAsync<TammaError>()).Which.Code.Should().Be("BILLING.SAAS_ONLY");

        var summaryAct = async () => await nullProvider.GetMeterEventSummaryTotalAsync(
            "mtr_1", "cus_1", PeriodStart, PeriodStart.AddMonths(1));
        (await summaryAct.Should().ThrowAsync<TammaError>()).Which.Code.Should().Be("BILLING.SAAS_ONLY");
    }
}
