using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Activities.Analytics;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.Pricing;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-3 (AC1–AC5, AC10, AC11, AC14) — unit tests for
/// <see cref="UsageMeteringService"/>: platform-vs-BYOK token split, strict
/// delegation to 34-5's <see cref="IUsagePricingEngine"/>, rollup idempotency,
/// incremental meter-event buffering (excluding BYOK), missing-tag WARN
/// handling, fail-open error swallowing, and <see cref="PlatformAnalyticsHourly"/>
/// split fallback.
/// </summary>
[TestFixture]
public class UsageMeteringServiceTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);
    private static readonly BillingPeriod JunePeriod = new(
        new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
        new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));

    private ControlPlaneDbContext _cp = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<IUsagePricingEngine> _pricingEngine = null!;
    private Mock<IMarginPolicyResolver> _marginResolver = null!;
    private Mock<IBillingProvider> _billing = null!;
    private StubTimeProvider _clock = null!;
    private Mock<ILogger<UsageMeteringService>> _logger = null!;
    private UsageMeteringService _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"usage-metering-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);

        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ReturnsAsync((DomainEvent evt) => evt);
        _events.Setup(e => e.QueryEventsAsync(
                It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<bool>(),
                It.IsAny<string?>(), It.IsAny<string?>(),
                It.IsAny<DateTimeOffset?>(), It.IsAny<DateTimeOffset?>(),
                It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<bool>()))
            .ReturnsAsync((Array.Empty<DomainEvent>(), (int?)null));

        _pricingEngine = new Mock<IUsagePricingEngine>();
        _marginResolver = new Mock<IMarginPolicyResolver>();
        _marginResolver.Setup(m => m.ResolveAsync(
                It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MarginPolicy
            {
                Id = Guid.NewGuid(),
                Scope = "global",
                MarkupMultiplier = 1.3m,
                Status = "active",
                EffectiveFrom = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            });

        _billing = new Mock<IBillingProvider>();
        _billing.SetupGet(b => b.IsEnabled).Returns(true);

        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));
        _logger = new Mock<ILogger<UsageMeteringService>>();

        _sut = new UsageMeteringService(
            _cp, _events.Object, _pricingEngine.Object, _marginResolver.Object,
            _billing.Object, _clock, _logger.Object);
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    private async Task<Guid> SeedTenantCustomerAsync(string stripeCustomerId = "cus_test_1", int seats = 5, string planSlug = "team")
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
        _cp.BillingSubscriptions.Add(new BillingSubscription
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeSubscriptionId = $"sub_{tenantId:N}",
            PlanSlug = planSlug,
            Status = "active",
            CurrentPeriodStart = JunePeriod.StartUtc,
            CurrentPeriodEnd = JunePeriod.EndUtc,
            Seats = seats,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();
        return tenantId;
    }

    private static DomainEvent MakeLlmEvent(
        Guid tenantId, long seq, string? billingMode, string provider, string model,
        long inputTokens, long outputTokens)
    {
        var tagsDict = new Dictionary<string, object?>
        {
            ["tenantId"] = tenantId.ToString("D"),
            ["provider"] = provider,
            ["model"] = model,
        };
        if (billingMode is not null)
        {
            tagsDict["billing_mode"] = billingMode;
        }

        return new DomainEvent
        {
            Id = Guid.NewGuid(),
            SequenceNumber = seq,
            TenantId = tenantId,
            Type = BillingModeEvents.LlmCallSuccess,
            Tags = JsonSerializer.Serialize(tagsDict),
            Data = JsonSerializer.Serialize(new { inputTokens, outputTokens, costUsd = 0.01m }),
            CreatedAt = FixedNow.AddMinutes(-seq),
        };
    }

    [Test]
    public async Task UpsertRollup_Splits_Platform_And_Byok_And_Delegates_Pricing_To_IUsagePricingEngine()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_split_1", seats: 7, planSlug: "team");

        var evts = new List<DomainEvent>
        {
            MakeLlmEvent(tenantId, 10, BillingModeTokens.Platform, "anthropic", "claude-sonnet-4", 1000, 400),
            MakeLlmEvent(tenantId, 11, BillingModeTokens.Platform, "openai", "gpt-4o", 500, 200),
            MakeLlmEvent(tenantId, 12, BillingModeTokens.Byok, "anthropic", "claude-sonnet-4", 9000, 3000),
        };

        _events.Setup(e => e.QueryEventsAsync(
                tenantId, BillingModeEvents.LlmCallSuccess, false,
                null, null, It.IsAny<DateTimeOffset?>(), It.IsAny<DateTimeOffset?>(),
                null, It.IsAny<int>(), false))
            .ReturnsAsync((evts, (int?)null));

        // Return arbitrary sentinel prices from mocked 34-5 engine to prove
        // UsageMeteringService NEVER re-derives margin math itself.
        _pricingEngine.Setup(p => p.PriceUsage(
                It.Is<UsageLine>(l => l.Provider == "anthropic" && l.PricingMode == PricingMode.PlatformProvided),
                It.IsAny<MarginPolicy>()))
            .Returns(new PricedUsage(CostBasisUsd: 1.2500m, MarginUsd: 0.7500m, SellPriceUsd: 2.0000m, PricingMode.PlatformProvided));

        _pricingEngine.Setup(p => p.PriceUsage(
                It.Is<UsageLine>(l => l.Provider == "openai" && l.PricingMode == PricingMode.PlatformProvided),
                It.IsAny<MarginPolicy>()))
            .Returns(new PricedUsage(CostBasisUsd: 0.5000m, MarginUsd: 0.2345m, SellPriceUsd: 0.7345m, PricingMode.PlatformProvided));

        await _sut.UpsertRollupAsync(tenantId, JunePeriod);

        var rollup = await _cp.BillingUsageRollups.SingleAsync(r => r.TenantId == tenantId);
        rollup.PlatformInputTokens.Should().Be(1500);
        rollup.PlatformOutputTokens.Should().Be(600);
        rollup.ByokInputTokens.Should().Be(9000);
        rollup.ByokOutputTokens.Should().Be(3000);
        rollup.PlatformCostUsd.Should().Be(1.7500m);
        rollup.BillableAmountUsd.Should().Be(2.7345m);
        rollup.Seats.Should().Be(7);
        rollup.LastSourceCursor.Should().Be(12);

        // Pricing engine called ONLY for the 2 platform events (never for BYOK).
        _pricingEngine.Verify(p => p.PriceUsage(It.IsAny<UsageLine>(), It.IsAny<MarginPolicy>()), Times.Exactly(2));

        // BILLING.USAGE.RECORDED appended once.
        _events.Verify(e => e.AppendAsync(
            It.Is<DomainEvent>(d => d.Type == BillingMeterEventTypes.UsageRecorded && d.TenantId == tenantId)),
            Times.Once);
    }

    [Test]
    public async Task BufferMeterEvents_Buffers_Only_Platform_Tokens_And_Never_Buffers_Byok()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_byok_excl");

        _cp.BillingUsageRollups.Add(new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = JunePeriod.StartUtc,
            PeriodEnd = JunePeriod.EndUtc,
            PlatformInputTokens = 12_000,
            PlatformOutputTokens = 3_500,
            ByokInputTokens = 999_000,
            ByokOutputTokens = 444_000,
            PlatformCostUsd = 1.00m,
            BillableAmountUsd = 1.30m,
            Seats = 3,
            LastSourceCursor = 42,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        await _sut.BufferMeterEventsAsync(tenantId, JunePeriod);

        var rows = await _cp.BillingMeterEventBuffers
            .Where(b => b.TenantId == tenantId)
            .OrderBy(b => b.EventName)
            .ToListAsync();

        rows.Should().HaveCount(2);
        rows.Should().OnlyContain(r => r.BillingMode == BillingModeTokens.Platform);
        rows.Should().NotContain(r => r.BillingMode == BillingModeTokens.Byok);

        rows[0].EventName.Should().Be(BillingMeterNames.PlatformTokensInput);
        rows[0].Value.Should().Be("12000");
        rows[0].StripeCustomerId.Should().Be("cus_byok_excl");
        rows[0].ReportedToStripe.Should().BeFalse();

        rows[1].EventName.Should().Be(BillingMeterNames.PlatformTokensOutput);
        rows[1].Value.Should().Be("3500");
        rows[1].ReportedToStripe.Should().BeFalse();
    }

    [Test]
    public async Task BufferMeterEvents_ByokOnly_Tenant_Produces_Zero_Buffer_Rows()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_pure_byok");

        _cp.BillingUsageRollups.Add(new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = JunePeriod.StartUtc,
            PeriodEnd = JunePeriod.EndUtc,
            PlatformInputTokens = 0,
            PlatformOutputTokens = 0,
            ByokInputTokens = 500_000,
            ByokOutputTokens = 250_000,
            PlatformCostUsd = 0m,
            BillableAmountUsd = 0m,
            Seats = 2,
            LastSourceCursor = 10,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        await _sut.BufferMeterEventsAsync(tenantId, JunePeriod);

        var rows = await _cp.BillingMeterEventBuffers.Where(b => b.TenantId == tenantId).ToListAsync();
        rows.Should().BeEmpty("BYOK tokens must never be buffered as Stripe meter events");
    }

    [Test]
    public async Task BufferMeterEvents_Is_Idempotent_And_Emits_Only_Positive_Deltas()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_delta");

        var rollup = new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = JunePeriod.StartUtc,
            PeriodEnd = JunePeriod.EndUtc,
            PlatformInputTokens = 1000,
            PlatformOutputTokens = 200,
            LastSourceCursor = 5,
            UpdatedAt = FixedNow,
        };
        _cp.BillingUsageRollups.Add(rollup);
        await _cp.SaveChangesAsync();

        // First buffer writes 1000 / 200.
        await _sut.BufferMeterEventsAsync(tenantId, JunePeriod);
        // Second call with unchanged rollup writes NOTHING.
        await _sut.BufferMeterEventsAsync(tenantId, JunePeriod);

        var afterReplay = await _cp.BillingMeterEventBuffers.Where(b => b.TenantId == tenantId).ToListAsync();
        afterReplay.Should().HaveCount(2);

        // New usage arrives: +500 input, +100 output.
        rollup.PlatformInputTokens = 1500;
        rollup.PlatformOutputTokens = 300;
        rollup.LastSourceCursor = 8;
        await _cp.SaveChangesAsync();

        await _sut.BufferMeterEventsAsync(tenantId, JunePeriod);

        var inputRows = await _cp.BillingMeterEventBuffers
            .Where(b => b.TenantId == tenantId && b.EventName == BillingMeterNames.PlatformTokensInput)
            .OrderBy(b => b.CreatedAt)
            .Select(b => b.Value)
            .ToListAsync();
        inputRows.Should().BeEquivalentTo(new[] { "1000", "500" });
    }

    [Test]
    public async Task UpsertRollup_Is_Idempotent_When_Run_Twice_On_Same_Facts()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_idem");
        var evts = new List<DomainEvent>
        {
            MakeLlmEvent(tenantId, 20, BillingModeTokens.Platform, "anthropic", "claude-sonnet-4", 800, 200),
        };
        _events.Setup(e => e.QueryEventsAsync(
                tenantId, BillingModeEvents.LlmCallSuccess, false,
                null, null, It.IsAny<DateTimeOffset?>(), It.IsAny<DateTimeOffset?>(),
                null, It.IsAny<int>(), false))
            .ReturnsAsync((evts, (int?)null));

        _pricingEngine.Setup(p => p.PriceUsage(It.IsAny<UsageLine>(), It.IsAny<MarginPolicy>()))
            .Returns(new PricedUsage(0.40m, 0.12m, 0.52m, PricingMode.PlatformProvided));

        await _sut.UpsertRollupAsync(tenantId, JunePeriod);
        await _sut.UpsertRollupAsync(tenantId, JunePeriod);

        var rollups = await _cp.BillingUsageRollups.Where(r => r.TenantId == tenantId).ToListAsync();
        rollups.Should().HaveCount(1);
        rollups[0].PlatformInputTokens.Should().Be(800);
        rollups[0].PlatformOutputTokens.Should().Be(200);
        rollups[0].BillableAmountUsd.Should().Be(0.5200m);
    }

    [Test]
    public async Task UpsertRollup_Missing_BillingMode_Tag_Treated_As_Platform_With_Warning()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_missing_tag");
        var evts = new List<DomainEvent>
        {
            MakeLlmEvent(tenantId, 30, billingMode: null, "openai", "gpt-4o", 500, 100),
        };
        _events.Setup(e => e.QueryEventsAsync(
                tenantId, BillingModeEvents.LlmCallSuccess, false,
                null, null, It.IsAny<DateTimeOffset?>(), It.IsAny<DateTimeOffset?>(),
                null, It.IsAny<int>(), false))
            .ReturnsAsync((evts, (int?)null));

        _pricingEngine.Setup(p => p.PriceUsage(It.IsAny<UsageLine>(), It.IsAny<MarginPolicy>()))
            .Returns(new PricedUsage(0.10m, 0.03m, 0.13m, PricingMode.PlatformProvided));

        await _sut.UpsertRollupAsync(tenantId, JunePeriod);

        var rollup = await _cp.BillingUsageRollups.SingleAsync(r => r.TenantId == tenantId);
        rollup.PlatformInputTokens.Should().Be(500);
        rollup.PlatformOutputTokens.Should().Be(100);
        rollup.ByokInputTokens.Should().Be(0);

        _logger.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, _) => v.ToString()!.Contains("missing billing_mode")),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Test]
    public async Task UpsertRollup_Swallows_FactRead_Failure_FailOpen()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_failopen");
        _events.Setup(e => e.QueryEventsAsync(
                tenantId, BillingModeEvents.LlmCallSuccess, false,
                null, null, It.IsAny<DateTimeOffset?>(), It.IsAny<DateTimeOffset?>(),
                null, It.IsAny<int>(), false))
            .ThrowsAsync(new InvalidOperationException("tenant DB unreachable"));

        var act = async () => await _sut.UpsertRollupAsync(tenantId, JunePeriod);
        await act.Should().NotThrowAsync("metering is fail-open and must never block the LLM path");

        _logger.Verify(
            l => l.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<InvalidOperationException>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Test]
    public async Task UpsertRollup_Falls_Back_To_PlatformAnalyticsHourly_Split_Columns()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_hourly");
        _cp.PlatformAnalyticsHourly.Add(new PlatformAnalyticsHourly
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Hour = JunePeriod.StartUtc.AddHours(2),
            TokensIn = 1500,
            TokensOut = 700,
            PlatformTokensIn = 1000,
            PlatformTokensOut = 400,
            ByokTokensIn = 500,
            ByokTokensOut = 300,
            CostUsd = 0.8500m,
            ComputedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        await _sut.UpsertRollupAsync(tenantId, JunePeriod);

        var rollup = await _cp.BillingUsageRollups.SingleAsync(r => r.TenantId == tenantId);
        rollup.PlatformInputTokens.Should().Be(1000);
        rollup.PlatformOutputTokens.Should().Be(400);
        rollup.ByokInputTokens.Should().Be(500);
        rollup.ByokOutputTokens.Should().Be(300);
    }

    [Test]
    public async Task GetCurrentUsage_Reads_Local_Rollup_Without_Calling_Stripe()
    {
        var tenantId = await SeedTenantCustomerAsync("cus_read", seats: 9);
        _cp.BillingUsageRollups.Add(new BillingUsageRollup
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PeriodStart = JunePeriod.StartUtc,
            PeriodEnd = JunePeriod.EndUtc,
            PlatformInputTokens = 1_840_221,
            PlatformOutputTokens = 412_980,
            ByokInputTokens = 90_112,
            ByokOutputTokens = 21_044,
            PlatformCostUsd = 12.4310m,
            BillableAmountUsd = 16.1603m,
            Seats = 9,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        var dto = await _sut.GetCurrentUsageAsync(tenantId);

        dto.PlatformInputTokens.Should().Be(1_840_221);
        dto.PlatformOutputTokens.Should().Be(412_980);
        dto.ByokInputTokens.Should().Be(90_112);
        dto.ByokOutputTokens.Should().Be(21_044);
        dto.PlatformCostUsd.Should().Be(12.4310m);
        dto.BillableUsd.Should().Be(16.1603m);
        dto.Seats.Should().Be(9);
        dto.PeriodStart.Should().Be(JunePeriod.StartUtc);
        dto.PeriodEnd.Should().Be(JunePeriod.EndUtc);

        _billing.Verify(b => b.GetMeterEventSummaryTotalAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Test]
    public async Task UpsertRollup_Is_NoOp_When_BillingProvider_Disabled()
    {
        _billing.SetupGet(b => b.IsEnabled).Returns(false);
        var tenantId = await SeedTenantCustomerAsync("cus_disabled");

        await _sut.UpsertRollupAsync(tenantId, JunePeriod);
        await _sut.BufferMeterEventsAsync(tenantId, JunePeriod);

        (await _cp.BillingUsageRollups.CountAsync()).Should().Be(0);
        (await _cp.BillingMeterEventBuffers.CountAsync()).Should().Be(0);
    }

    [Test]
    public void ComputeTenantRollupActivity_Splits_LlmUsage_By_BillingMode()
    {
        var rows = new (string? Data, string? Tags)[]
        {
            ("""{"inputTokens":100,"outputTokens":50,"costUsd":0.10}""", """{"billing_mode":"platform"}"""),
            ("""{"inputTokens":400,"outputTokens":200,"costUsd":0.40}""", """{"billing_mode":"byok"}"""),
            ("""{"inputTokens":50,"outputTokens":25,"costUsd":0.05}""", """{"provider":"openai"}"""), // missing → platform
        };

        var result = ComputeTenantRollupActivity.AggregateLlmUsageByBillingMode(rows);

        result.TokensIn.Should().Be(550);
        result.TokensOut.Should().Be(275);
        result.PlatformTokensIn.Should().Be(150);
        result.PlatformTokensOut.Should().Be(75);
        result.ByokTokensIn.Should().Be(400);
        result.ByokTokensOut.Should().Be(200);
        result.CostUsd.Should().Be(0.5500m);
    }
}

internal sealed class StubTimeProvider(DateTimeOffset utcNow) : TimeProvider
{
    private DateTimeOffset _utcNow = utcNow;
    public override DateTimeOffset GetUtcNow() => _utcNow;
    public void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
}
