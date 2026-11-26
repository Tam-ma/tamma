using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Pricing;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Tests.Billing;
using Tamma.Core;
using Tamma.Core.Enums;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Pricing;

/// <summary>
/// Story 34-10 (AC1, AC2, AC9, AC10, AC13) — unit tests for
/// <see cref="PricingBackfillService"/>: insert-missing-only JSON→entitlement
/// conversion, tenant fallback chain (<c>PlanId → Slug → free</c>), zero-unassigned
/// invariant, idempotent second-run no-op, platform event emission, and tenant isolation.
/// </summary>
[TestFixture]
public class PricingBackfillServiceTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private List<PlatformEvent> _emitted = null!;
    private Mock<IPlatformEventPublisher> _events = null!;
    private Mock<ITammaModeProvider> _mode = null!;
    private StubTimeProvider _clock = null!;
    private PricingBackfillService _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"pricing-backfill-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);

        _emitted = [];
        _events = new Mock<IPlatformEventPublisher>();
        _events.Setup(e => e.AppendAndPublishAsync(It.IsAny<PlatformEvent>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlatformEvent evt, CancellationToken _) =>
            {
                _emitted.Add(evt);
                _cp.PlatformEvents.Add(evt);
                _cp.SaveChanges();
                return evt;
            });

        _mode = new Mock<ITammaModeProvider>();
        _mode.SetupGet(m => m.Mode).Returns(TammaMode.SaaS);
        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));

        _sut = new PricingBackfillService(
            _cp,
            _events.Object,
            _mode.Object,
            _clock,
            Mock.Of<ILogger<PricingBackfillService>>());
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    [Test]
    public async Task RunAsync_ConvertsLegacyQuotas_InsertMissingOnly_And_Leaves_Seeded_Plans_Untouched()
    {
        var legacyPlan = new Plan
        {
            Id = Guid.NewGuid(),
            Slug = "legacy-pro",
            DisplayName = "Legacy Pro",
            Version = 1,
            Status = "active",
            Quotas = """{"llmTokensPerMonth":2000000,"seats":10,"concurrentWorkflows":5}""",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        };
        var structuredPlanId = Guid.NewGuid();
        var structuredPlan = new Plan
        {
            Id = structuredPlanId,
            Slug = "free",
            DisplayName = "Free",
            Version = 1,
            Status = "active",
            Quotas = """{"llmTokensPerMonth":999,"seats":99}""",
            Entitlements =
            {
                new PlanEntitlement
                {
                    Id = Guid.NewGuid(),
                    PlanId = structuredPlanId,
                    MetricKey = EntitlementMetricKey.LlmTokens,
                    LimitValue = 100_000,
                    Period = "monthly",
                    OverageMode = "block",
                },
            },
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        };
        _cp.Plans.AddRange(legacyPlan, structuredPlan);
        await _cp.SaveChangesAsync();

        var report = await _sut.RunAsync(BackfillTrigger.Startup);

        report.WasNoOp.Should().BeFalse();
        report.PlansConverted.Should().Be(1);
        report.EntitlementsCreated.Should().Be(2);

        var legacyEnts = await _cp.PlanEntitlements.Where(e => e.PlanId == legacyPlan.Id).ToListAsync();
        legacyEnts.Should().HaveCount(2);
        legacyEnts.Should().Contain(e => e.MetricKey == EntitlementMetricKey.LlmTokens && e.LimitValue == 2_000_000L);
        legacyEnts.Should().Contain(e => e.MetricKey == EntitlementMetricKey.Seats && e.LimitValue == 10L);

        // Already-structured plan was left untouched (no double-insert)
        var freeEnts = await _cp.PlanEntitlements.Where(e => e.PlanId == structuredPlanId).ToListAsync();
        freeEnts.Should().ContainSingle().Which.LimitValue.Should().Be(100_000L);
    }

    [Test]
    public async Task RunAsync_Assigns_Every_Live_Tenant_Via_FallbackChain_And_SecondRun_Is_NoOp()
    {
        var freePlan = new Plan
        {
            Id = Guid.NewGuid(), Slug = "free", DisplayName = "Free", Version = 1, Status = "active",
            Quotas = "{}", CreatedAt = FixedNow, UpdatedAt = FixedNow,
        };
        var teamPlan = new Plan
        {
            Id = Guid.NewGuid(), Slug = "team", DisplayName = "Team", Version = 2, Status = "active",
            Quotas = "{}", CreatedAt = FixedNow, UpdatedAt = FixedNow,
        };
        var entPlan = new Plan
        {
            Id = Guid.NewGuid(), Slug = "enterprise", DisplayName = "Enterprise", Version = 3, Status = "active",
            Quotas = "{}", CreatedAt = FixedNow, UpdatedAt = FixedNow,
        };
        _cp.Plans.AddRange(freePlan, teamPlan, entPlan);

        // Tenant 1: explicit PlanId shadow column -> enterprise v3
        var tById = new Tenant { Id = Guid.NewGuid(), Name = "ById", Slug = "by-id", Plan = "free" };
        // Tenant 2: null PlanId, slug "team" -> team v2
        var tBySlug = new Tenant { Id = Guid.NewGuid(), Name = "BySlug", Slug = "by-slug", Plan = "team" };
        // Tenant 3: unknown slug -> fallback to free v1
        var tFallback = new Tenant { Id = Guid.NewGuid(), Name = "Fallback", Slug = "fallback", Plan = "nonexistent" };
        // Tenant 4: soft-deleted -> must NOT receive an assignment
        var tDeleted = new Tenant { Id = Guid.NewGuid(), Name = "Deleted", Slug = "deleted", Plan = "free", DeletedAt = FixedNow };

        _cp.Tenants.AddRange(tById, tBySlug, tFallback, tDeleted);
        _cp.Entry(tById).Property<Guid?>("PlanId").CurrentValue = entPlan.Id;
        await _cp.SaveChangesAsync();

        var first = await _sut.RunAsync(BackfillTrigger.Startup);

        first.WasNoOp.Should().BeFalse();
        first.TenantsAssigned.Should().Be(3);
        (await _sut.CountUnassignedLiveTenantsAsync()).Should().Be(0);

        var a1 = await _cp.TenantPlanAssignments.SingleAsync(a => a.TenantId == tById.Id && a.Status == "active");
        a1.PlanId.Should().Be(entPlan.Id);
        a1.PlanVersion.Should().Be(3);
        a1.Reason.Should().Be(PricingBackfillService.BackfillReason);

        var a2 = await _cp.TenantPlanAssignments.SingleAsync(a => a.TenantId == tBySlug.Id && a.Status == "active");
        a2.PlanId.Should().Be(teamPlan.Id);
        a2.PlanVersion.Should().Be(2);

        var a3 = await _cp.TenantPlanAssignments.SingleAsync(a => a.TenantId == tFallback.Id && a.Status == "active");
        a3.PlanId.Should().Be(freePlan.Id);
        a3.PlanVersion.Should().Be(1);

        (await _cp.TenantPlanAssignments.AnyAsync(a => a.TenantId == tDeleted.Id)).Should().BeFalse();

        _emitted.Select(e => e.Type).Should().Equal(
            PricingBackfillEventTypes.Started,
            PricingBackfillEventTypes.Completed);

        // Second run is a verified no-op (AC9, AC10)
        var second = await _sut.RunAsync(BackfillTrigger.Admin);

        second.WasNoOp.Should().BeTrue();
        second.PlansConverted.Should().Be(0);
        second.EntitlementsCreated.Should().Be(0);
        second.TenantsAssigned.Should().Be(0);
        second.SkippedTenants.Should().Be(3);

        _emitted.Select(e => e.Type).Should().Equal(
            PricingBackfillEventTypes.Started,
            PricingBackfillEventTypes.Completed,
            PricingBackfillEventTypes.Skipped);
    }

    [Test]
    public async Task RunAsync_Throws_Incomplete_Critical_Error_When_Tenant_Cannot_Be_Assigned()
    {
        // Live tenant exists, but NO plans exist at all -> invariant fails loudly!
        _cp.Tenants.Add(new Tenant { Id = Guid.NewGuid(), Name = "Orphan", Slug = "orphan", Plan = "free" });
        await _cp.SaveChangesAsync();

        var act = () => _sut.RunAsync(BackfillTrigger.Startup);

        var ex = (await act.Should().ThrowAsync<TammaError>()).Which;
        ex.Code.Should().Be(PricingBackfillService.IncompleteErrorCode);
        ex.Severity.Should().Be(TammaErrorSeverity.Critical);
    }
}
