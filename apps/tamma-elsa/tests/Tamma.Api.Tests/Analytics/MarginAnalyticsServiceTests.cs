using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Endpoints.Analytics;
using Tamma.Api.Services.Analytics;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Analytics;

/// <summary>
/// Story 36-7 (AC1–AC5, AC11, AC12, AC13) — unit tests for
/// <see cref="MarginAnalyticsService"/> and its DTOs:
/// margin summation / MarginPct / zero-revenue, 4-dimension breakdown reconciliation
/// (including preserved NULL bucket), BYOK zero-revenue / negative margin, daily +
/// monthly + sub-day hourly trends, empty-tenant zeroed safety, best-effort
/// <c>ANALYTICS.MARGIN.VIEWED</c> audit emit, and the AC2 no-recompute boundary guard.
/// </summary>
[TestFixture]
public class MarginAnalyticsServiceTests
{
    private static readonly DateTimeOffset FixedNow = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private static (MarginAnalyticsService Svc, TenantDbContext Db, List<DomainEvent> Emitted) CreateHarness(
        Guid tenantId,
        bool failEventEmit = false)
    {
        var dbName = $"margin-analytics-{Guid.NewGuid():N}";
        var opts = new DbContextOptionsBuilder<TenantDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;
        var db = new TenantDbContext(opts, tenantId);

        var factory = new Mock<ITenantDbContextFactory>();
        factory.Setup(f => f.CreateAsync(tenantId, It.IsAny<CancellationToken>()))
            .Returns(() => new ValueTask<TenantDbContext>(new TenantDbContext(opts, tenantId)));

        var emitted = new List<DomainEvent>();
        var events = new Mock<IEventRepository>();
        if (failEventEmit)
        {
            events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
                .ThrowsAsync(new InvalidOperationException("event store offline"));
        }
        else
        {
            events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
                .ReturnsAsync((DomainEvent evt) =>
                {
                    emitted.Add(evt);
                    return evt;
                });
        }

        var svc = new MarginAnalyticsService(
            factory.Object,
            events.Object,
            new FixedClock(FixedNow),
            NullLogger<MarginAnalyticsService>.Instance);

        return (svc, db, emitted);
    }

    // ───────────────────── AC1: margin math + rounding + zero-revenue ─────────────────────

    [Test]
    public void MarginSummary_From_ComputesExactMarginAndPct_AndGuardsZeroRevenue()
    {
        var positive = MarginSummary.From(cost: 80m, revenue: 100m, FixedNow.UtcDateTime);
        positive.CostUsd.Should().Be(80m);
        positive.RevenueUsd.Should().Be(100m);
        positive.MarginUsd.Should().Be(20m);
        positive.MarginPct.Should().Be(0.2m);

        var negative = MarginSummary.From(cost: 120m, revenue: 100m, FixedNow.UtcDateTime);
        negative.MarginUsd.Should().Be(-20m);
        negative.MarginPct.Should().Be(-0.2m);

        var zeroRev = MarginSummary.From(cost: 15.5m, revenue: 0m, FixedNow.UtcDateTime);
        zeroRev.CostUsd.Should().Be(15.5m);
        zeroRev.RevenueUsd.Should().Be(0m);
        zeroRev.MarginUsd.Should().Be(-15.5m);
        zeroRev.MarginPct.Should().Be(0m, "zero revenue must guard divide-by-zero and return 0");

        var rounded = MarginSummary.From(cost: 1m, revenue: 3m, FixedNow.UtcDateTime);
        rounded.MarginPct.Should().Be(0.6667m, "4dp away-from-zero determinism");

        MarginSummary.Empty.CostUsd.Should().Be(0m);
        MarginSummary.Empty.RevenueUsd.Should().Be(0m);
        MarginSummary.Empty.MarginUsd.Should().Be(0m);
        MarginSummary.Empty.MarginPct.Should().Be(0m);
    }

    // ───────────────────── AC3 + AC4: breakdowns, NULL preservation, BYOK ─────────────────────

    [Test]
    public async Task GetTenantMarginAsync_ReconcilesAllFourDimensions_PreservesNull_AndHandlesByok()
    {
        var tenantId = Guid.NewGuid();
        var wf1 = Guid.NewGuid();
        var (svc, db, emitted) = CreateHarness(tenantId);
        await using var _ = db;

        var day1 = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        var day2 = new DateTime(2026, 6, 2, 0, 0, 0, DateTimeKind.Utc);

        db.AnalyticsUsageDaily.AddRange(
            new AnalyticsUsageDaily
            {
                Id = Guid.NewGuid(),
                Day = day1,
                Provider = "anthropic",
                AgentId = "implementer",
                WorkflowDefinitionId = wf1,
                CostBasis = CostBasis.Platform,
                CostUsd = 10.00m,
                PlatformBilledUsd = 15.00m,
                ComputedAt = FixedNow.UtcDateTime,
            },
            new AnalyticsUsageDaily
            {
                Id = Guid.NewGuid(),
                Day = day2,
                Provider = "openai",
                AgentId = "reviewer",
                WorkflowDefinitionId = null, // unattributed workflow
                CostBasis = CostBasis.Platform,
                CostUsd = 20.00m,
                PlatformBilledUsd = 25.00m,
                ComputedAt = FixedNow.UtcDateTime,
            },
            new AnalyticsUsageDaily
            {
                Id = Guid.NewGuid(),
                Day = day2,
                Provider = null, // unattributed provider
                AgentId = null,  // unattributed agent
                WorkflowDefinitionId = null,
                CostBasis = CostBasis.Byok,
                CostUsd = 5.00m,
                PlatformBilledUsd = 0m, // Story 34-5/36-2 invariant: BYOK carries 0 revenue
                ComputedAt = FixedNow.UtcDateTime,
            });
        await db.SaveChangesAsync();

        var from = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        var to = new DateTime(2026, 6, 10, 0, 0, 0, DateTimeKind.Utc);

        var report = await svc.GetTenantMarginAsync(tenantId, from, to, MarginGrain.Day);

        // Grand totals: Cost = 35, Revenue = 40, Margin = 5, MarginPct = 5/40 = 0.125
        report.Summary.CostUsd.Should().Be(35m);
        report.Summary.RevenueUsd.Should().Be(40m);
        report.Summary.MarginUsd.Should().Be(5m);
        report.Summary.MarginPct.Should().Be(0.125m);

        // Every dimension reconciles losslessly to grand total AND preserves NULL key (AC3)
        foreach (var dim in new[]
        {
            MarginAnalyticsService.DimensionProvider,
            MarginAnalyticsService.DimensionAgent,
            MarginAnalyticsService.DimensionWorkflow,
            MarginAnalyticsService.DimensionCostBasis,
        })
        {
            var rows = report.Breakdowns.Where(b => b.Dimension == dim).ToList();
            rows.Should().NotBeEmpty();
            rows.Sum(r => r.CostUsd).Should().Be(report.Summary.CostUsd, $"dimension {dim} cost must reconcile");
            rows.Sum(r => r.RevenueUsd).Should().Be(report.Summary.RevenueUsd, $"dimension {dim} revenue must reconcile");
            rows.Sum(r => r.MarginUsd).Should().Be(report.Summary.MarginUsd, $"dimension {dim} margin must reconcile");
        }

        // NULL bucket preserved (never coerced to "unknown")
        report.Breakdowns.Should().Contain(b => b.Dimension == "provider" && b.Key == null && b.CostUsd == 5m);
        report.Breakdowns.Should().Contain(b => b.Dimension == "agent" && b.Key == null && b.CostUsd == 5m);
        report.Breakdowns.Should().Contain(b => b.Dimension == "workflow" && b.Key == null && b.CostUsd == 25m);

        // AC4: BYOK row yields Revenue == 0, Margin == -Cost, MarginPct == 0
        var byok = report.Breakdowns.Single(b => b.Dimension == "costBasis" && b.Key == "byok");
        byok.CostUsd.Should().Be(5m);
        byok.RevenueUsd.Should().Be(0m);
        byok.MarginUsd.Should().Be(-5m);
        byok.MarginPct.Should().Be(0m);

        var platform = report.Breakdowns.Single(b => b.Dimension == "costBasis" && b.Key == "platform");
        platform.CostUsd.Should().Be(30m);
        platform.RevenueUsd.Should().Be(40m);
        platform.MarginUsd.Should().Be(10m);
        platform.MarginPct.Should().Be(0.25m);

        // AC5: daily trend sums losslessly to grand total
        report.Trend.Should().HaveCount(2);
        report.Trend.Sum(t => t.CostUsd).Should().Be(report.Summary.CostUsd);
        report.Trend.Sum(t => t.RevenueUsd).Should().Be(report.Summary.RevenueUsd);
        report.Trend.Sum(t => t.MarginUsd).Should().Be(report.Summary.MarginUsd);

        // AC12: ANALYTICS.MARGIN.VIEWED audit event emitted with expected tags
        emitted.Should().ContainSingle();
        emitted[0].Type.Should().Be(MarginAnalyticsEvents.MarginViewed);
        emitted[0].TenantId.Should().Be(tenantId);
        using var tagDoc = JsonDocument.Parse(emitted[0].Tags);
        tagDoc.RootElement.GetProperty("scope").GetString().Should().Be("tenant");
        tagDoc.RootElement.GetProperty("tenantId").GetString().Should().Be(tenantId.ToString("D"));
        tagDoc.RootElement.GetProperty("grain").GetString().Should().Be("day");
    }

    // ───────────────────── AC1 + AC5: monthly rollup & sub-day hourly fallback ─────────────────────

    [Test]
    public async Task GetTenantMarginAsync_MonthlyGrain_RollsDailyRowsIntoCalendarMonths()
    {
        var tenantId = Guid.NewGuid();
        var (svc, db, _) = CreateHarness(tenantId);
        await using var _ = db;

        db.AnalyticsUsageDaily.AddRange(
            new AnalyticsUsageDaily
            {
                Id = Guid.NewGuid(),
                Day = new DateTime(2026, 4, 10, 0, 0, 0, DateTimeKind.Utc),
                Provider = "anthropic",
                CostBasis = CostBasis.Platform,
                CostUsd = 10m,
                PlatformBilledUsd = 12m,
                ComputedAt = FixedNow.UtcDateTime,
            },
            new AnalyticsUsageDaily
            {
                Id = Guid.NewGuid(),
                Day = new DateTime(2026, 4, 25, 0, 0, 0, DateTimeKind.Utc),
                Provider = "anthropic",
                CostBasis = CostBasis.Platform,
                CostUsd = 15m,
                PlatformBilledUsd = 20m,
                ComputedAt = FixedNow.UtcDateTime,
            },
            new AnalyticsUsageDaily
            {
                Id = Guid.NewGuid(),
                Day = new DateTime(2026, 5, 5, 0, 0, 0, DateTimeKind.Utc),
                Provider = "openai",
                CostBasis = CostBasis.Platform,
                CostUsd = 8m,
                PlatformBilledUsd = 10m,
                ComputedAt = FixedNow.UtcDateTime,
            });
        await db.SaveChangesAsync();

        var report = await svc.GetTenantMarginAsync(
            tenantId,
            new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            MarginGrain.Month);

        report.Grain.Should().Be("month");
        report.Trend.Should().HaveCount(2);
        report.Trend[0].Bucket.Should().Be(new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc));
        report.Trend[0].CostUsd.Should().Be(25m);
        report.Trend[0].RevenueUsd.Should().Be(32m);
        report.Trend[0].MarginUsd.Should().Be(7m);

        report.Trend[1].Bucket.Should().Be(new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc));
        report.Trend[1].CostUsd.Should().Be(8m);
        report.Trend[1].RevenueUsd.Should().Be(10m);
        report.Trend[1].MarginUsd.Should().Be(2m);

        report.Trend.Sum(t => t.MarginUsd).Should().Be(report.Summary.MarginUsd);
    }

    [Test]
    public async Task GetTenantMarginAsync_SubDayWindow_ReadsAnalyticsUsageHourly()
    {
        var tenantId = Guid.NewGuid();
        var (svc, db, _) = CreateHarness(tenantId);
        await using var _ = db;

        var h10 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);
        var h11 = new DateTime(2026, 6, 15, 11, 0, 0, DateTimeKind.Utc);

        db.AnalyticsUsageHourly.AddRange(
            new AnalyticsUsageHourly
            {
                Id = Guid.NewGuid(),
                Hour = h10,
                Provider = "anthropic",
                CostBasis = CostBasis.Platform,
                CostUsd = 2m,
                PlatformBilledUsd = 3m,
                ComputedAt = FixedNow.UtcDateTime,
            },
            new AnalyticsUsageHourly
            {
                Id = Guid.NewGuid(),
                Hour = h11,
                Provider = "anthropic",
                CostBasis = CostBasis.Platform,
                CostUsd = 4m,
                PlatformBilledUsd = 6m,
                ComputedAt = FixedNow.UtcDateTime,
            });
        await db.SaveChangesAsync();

        // 6-hour sub-day window -> must read AnalyticsUsageHourly (AC1)
        var report = await svc.GetTenantMarginAsync(
            tenantId,
            new DateTime(2026, 6, 15, 8, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 6, 15, 14, 0, 0, DateTimeKind.Utc),
            MarginGrain.Day);

        report.Summary.CostUsd.Should().Be(6m);
        report.Summary.RevenueUsd.Should().Be(9m);
        report.Summary.MarginUsd.Should().Be(3m);
        report.Trend.Should().HaveCount(2);
        report.Trend[0].Bucket.Should().Be(h10);
        report.Trend[1].Bucket.Should().Be(h11);
    }

    // ───────────────────── AC11 + AC12: empty tenant & best-effort audit emit ─────────────────────

    [Test]
    public async Task GetTenantMarginAsync_EmptyTenant_ReturnsZeroedReport_NeverThrows()
    {
        var tenantId = Guid.NewGuid();
        var (svc, db, _) = CreateHarness(tenantId);
        await using var _ = db;

        var report = await svc.GetTenantMarginAsync(
            tenantId,
            new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));

        report.Should().NotBeNull();
        report.Summary.CostUsd.Should().Be(0m);
        report.Summary.RevenueUsd.Should().Be(0m);
        report.Summary.MarginUsd.Should().Be(0m);
        report.Summary.MarginPct.Should().Be(0m);
        report.Breakdowns.Should().BeEmpty();
        report.Trend.Should().BeEmpty();
    }

    [Test]
    public async Task GetTenantMarginAsync_EventEmitFailure_IsSwallowedBestEffort()
    {
        var tenantId = Guid.NewGuid();
        var (svc, db, _) = CreateHarness(tenantId, failEventEmit: true);
        await using var _ = db;

        db.AnalyticsUsageDaily.Add(new AnalyticsUsageDaily
        {
            Id = Guid.NewGuid(),
            Day = new DateTime(2026, 6, 3, 0, 0, 0, DateTimeKind.Utc),
            Provider = "anthropic",
            CostBasis = CostBasis.Platform,
            CostUsd = 10m,
            PlatformBilledUsd = 14m,
            ComputedAt = FixedNow.UtcDateTime,
        });
        await db.SaveChangesAsync();

        var report = await svc.GetTenantMarginAsync(
            tenantId,
            new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 6, 10, 0, 0, 0, DateTimeKind.Utc));

        report.Summary.MarginUsd.Should().Be(4m);
    }

    // ───────────────────── AC2: strict no-recompute boundary guard ─────────────────────

    [Test]
    public void MarginAnalyticsTypes_TakeZeroDependency_OnStory34_5_PricingNamespace_AC2()
    {
        var guardedTypes = new[]
        {
            typeof(IMarginAnalyticsService),
            typeof(MarginAnalyticsService),
            typeof(MarginSummary),
            typeof(MarginBreakdownRow),
            typeof(MarginTrendPoint),
            typeof(TenantMarginReport),
            typeof(MarginAnalyticsEndpoints),
        };

        var forbiddenNamespacePrefix = "Tamma.Api.Services.Pricing";
        var forbiddenTypeNames = new[]
        {
            "IUsagePricingEngine",
            "UsagePricingEngine",
            "IMarginPolicyResolver",
            "MarginPolicyResolver",
            "IProviderPricingService",
            "ProviderPricingService",
            "MarginPolicy",
            "IPricingContract",
        };

        foreach (var type in guardedTypes)
        {
            var referencedTypes = new List<Type>();

            foreach (var ctor in type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                referencedTypes.AddRange(ctor.GetParameters().Select(p => p.ParameterType));
            }

            foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static))
            {
                referencedTypes.Add(field.FieldType);
            }

            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static))
            {
                referencedTypes.Add(prop.PropertyType);
            }

            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
            {
                referencedTypes.Add(method.ReturnType);
                referencedTypes.AddRange(method.GetParameters().Select(p => p.ParameterType));
            }

            foreach (var refType in referencedTypes)
            {
                var ns = refType.Namespace ?? string.Empty;
                ns.Should().NotStartWith(
                    forbiddenNamespacePrefix,
                    $"AC2: {type.Name} must NEVER depend on Story 34-5 pricing namespace (found {refType.FullName})");
                forbiddenTypeNames.Should().NotContain(
                    refType.Name,
                    $"AC2: {type.Name} must NEVER reference {refType.Name}");
            }
        }

        // Tenant margin service must never read control-plane analytics either
        var svcCtorTypes = typeof(MarginAnalyticsService)
            .GetConstructors().Single()
            .GetParameters().Select(p => p.ParameterType).ToList();
        svcCtorTypes.Should().NotContain(typeof(IPlatformAnalyticsService));
        svcCtorTypes.Should().NotContain(typeof(ControlPlaneDbContext));
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
