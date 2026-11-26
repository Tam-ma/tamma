using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Alerts;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-3 (AC9, AC10, AC11, AC13, AC14) — unit tests for
/// <see cref="UsageReconciliationTaskHandler"/>: matching totals emit no drift,
/// drift beyond tolerance emits <c>BILLING.USAGE.RECONCILIATION_MISMATCH</c> +
/// raises an alert via <see cref="IAlertSink"/>, per-customer iteration with
/// fail-open isolation, and self-rescheduling.
/// </summary>
[TestFixture]
public class UsageReconciliationTaskHandlerTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 16, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime PeriodStart = new(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime PeriodEnd = new(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private Mock<IBillingProvider> _billing = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<IAlertSink> _alerts = null!;
    private Mock<IPlatformQueuedTaskRepository> _taskQueue = null!;
    private StubTimeProvider _clock = null!;
    private UsageReconciliationTaskHandler _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"usage-reconcile-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);

        _cp.BillingPlanPrices.Add(new BillingPlanPrice
        {
            Id = Guid.NewGuid(),
            PlanSlug = "team",
            TokensInputMeterId = "mtr_in",
            TokensOutputMeterId = "mtr_out",
            SeatsMeterId = "mtr_seats",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.SaveChanges();

        _billing = new Mock<IBillingProvider>();
        _billing.SetupGet(b => b.IsEnabled).Returns(true);

        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent evt) => evt);

        _alerts = new Mock<IAlertSink>();
        _alerts.Setup(a => a.RaiseAsync(It.IsAny<AlertPayload>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AlertRaiseResult(Guid.NewGuid(), true, 1, false));

        _taskQueue = new Mock<IPlatformQueuedTaskRepository>();
        _taskQueue.Setup(q => q.EnqueueAsync(It.IsAny<PlatformQueuedTask>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlatformQueuedTask t, CancellationToken _) => t);

        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));

        _sut = new UsageReconciliationTaskHandler(
            _cp,
            _billing.Object,
            _events.Object,
            _alerts.Object,
            _taskQueue.Object,
            Options.Create(new BillingUsageOptions
            {
                ReconcileIntervalMinutes = 60,
                DriftToleranceTokens = 100,
                DriftToleranceUsd = 0.01m,
            }),
            _clock,
            NullLogger<UsageReconciliationTaskHandler>.Instance);
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    private async Task<Guid> SeedCustomerAndRollupAsync(
        string stripeCustomerId, long inputTokens, long outputTokens, decimal billableUsd)
    {
        var tenantId = Guid.NewGuid();
        _cp.BillingCustomers.Add(new BillingCustomer
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeCustomerId = stripeCustomerId,
            BillingMode = "PlatformProvided",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.BillingUsageRollups.Add(new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = PeriodStart,
            PeriodEnd = PeriodEnd,
            PlatformInputTokens = inputTokens,
            PlatformOutputTokens = outputTokens,
            BillableAmountUsd = billableUsd,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();
        return tenantId;
    }

    private static PlatformQueuedTask MakeTask() => new()
    {
        Id = Guid.NewGuid(),
        Type = UsageReconciliationTaskHandler.TaskTypeName,
        Payload = "{}",
        Status = "processing",
    };

    [Test]
    public async Task HandleAsync_Matching_Totals_Emits_No_Drift_Event_And_No_Alert()
    {
        await SeedCustomerAndRollupAsync("cus_match", 50_000, 12_000, 2.50m);

        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                "mtr_in", "cus_match", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ReturnsAsync(50_000L);
        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                "mtr_out", "cus_match", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ReturnsAsync(12_000L);

        await _sut.HandleAsync(MakeTask(), CancellationToken.None);

        _events.Verify(e => e.AppendAsync(
            It.Is<DomainEvent>(d => d.Type == BillingMeterEventTypes.ReconciliationMismatch)),
            Times.Never);
        _alerts.Verify(a => a.RaiseAsync(It.IsAny<AlertPayload>(), It.IsAny<CancellationToken>()),
            Times.Never);

        // Reschedules hourly tick.
        _taskQueue.Verify(q => q.EnqueueAsync(
            It.Is<PlatformQueuedTask>(t =>
                t.Type == UsageReconciliationTaskHandler.TaskTypeName &&
                t.VisibleAt == FixedNow.AddMinutes(60)),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public async Task HandleAsync_Drift_Beyond_Tolerance_Emits_Mismatch_Event_And_Raises_Alert_Once()
    {
        var tenantId = await SeedCustomerAndRollupAsync("cus_drift", 100_000, 20_000, 10.00m);

        // Input meter drifts by 5,000 tokens (~$0.4167); output meter matches.
        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                "mtr_in", "cus_drift", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ReturnsAsync(95_000L);
        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                "mtr_out", "cus_drift", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ReturnsAsync(20_000L);

        await _sut.HandleAsync(MakeTask(), CancellationToken.None);

        _events.Verify(e => e.AppendAsync(
            It.Is<DomainEvent>(d =>
                d.Type == BillingMeterEventTypes.ReconciliationMismatch &&
                d.TenantId == tenantId &&
                d.Tags.Contains(BillingMeterNames.PlatformTokensInput))),
            Times.Once);

        _alerts.Verify(a => a.RaiseAsync(
            It.Is<AlertPayload>(p =>
                p.Severity == AlertSeverity.Warning &&
                p.TenantId == tenantId &&
                p.Title.Contains(BillingMeterNames.PlatformTokensInput)),
            It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Test]
    public async Task HandleAsync_Iterates_All_Customers_And_Continues_When_One_Customer_Fails()
    {
        var tenantA = await SeedCustomerAndRollupAsync("cus_err", 10_000, 1_000, 1.00m);
        var tenantB = await SeedCustomerAndRollupAsync("cus_ok_drift", 10_000, 1_000, 5.00m);

        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                It.IsAny<string>(), "cus_err", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Stripe timeout"));

        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                "mtr_in", "cus_ok_drift", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0L);
        _billing.Setup(b => b.GetMeterEventSummaryTotalAsync(
                "mtr_out", "cus_ok_drift", PeriodStart, PeriodEnd, It.IsAny<CancellationToken>()))
            .ReturnsAsync(1_000L);

        var act = async () => await _sut.HandleAsync(MakeTask(), CancellationToken.None);
        await act.Should().NotThrowAsync();

        _events.Verify(e => e.AppendAsync(
            It.Is<DomainEvent>(d => d.Type == BillingMeterEventTypes.ReconciliationMismatch && d.TenantId == tenantB)),
            Times.Once);
        _events.Verify(e => e.AppendAsync(
            It.Is<DomainEvent>(d => d.TenantId == tenantA)),
            Times.Never);
    }

    [Test]
    public async Task HandleAsync_Disabled_Provider_Throws_TerminalException()
    {
        _billing.SetupGet(b => b.IsEnabled).Returns(false);

        var act = async () => await _sut.HandleAsync(MakeTask(), CancellationToken.None);
        await act.Should().ThrowAsync<PlatformTaskTerminalException>();
    }
}
