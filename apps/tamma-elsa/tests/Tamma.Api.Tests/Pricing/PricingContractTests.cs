using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Pricing;
using Tamma.Core;
using Tamma.Core.Enums;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Pricing;

/// <summary>
/// Story 34-10 (AC4, AC6, AC11, AC13) — contract conformance tests for
/// <see cref="PricingContract"/>: closed 7-key entitlement set, pinned version
/// surviving deprecation, <c>PricingMode</c> honoring (platform vs BYOK),
/// <c>PriceNetAsync</c> invariant + pass-through default, and fail-loud on
/// missing assignment or missing catalog snapshot.
/// </summary>
[TestFixture]
public class PricingContractTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    private Mock<IPlanCatalogService> _catalog = null!;
    private Mock<IPlanAssignmentService> _assignments = null!;
    private Mock<IEntitlementService> _entitlements = null!;
    private Mock<IUsagePricingEngine> _usageEngine = null!;
    private Mock<IMarginPolicyResolver> _marginResolver = null!;
    private Mock<ICreditAwarePricingEngine> _creditEngine = null!;
    private PricingContract _sut = null!;

    [SetUp]
    public void SetUp()
    {
        _catalog = new Mock<IPlanCatalogService>();
        _assignments = new Mock<IPlanAssignmentService>();
        _entitlements = new Mock<IEntitlementService>();
        _usageEngine = new Mock<IUsagePricingEngine>();
        _marginResolver = new Mock<IMarginPolicyResolver>();
        _creditEngine = new Mock<ICreditAwarePricingEngine>();

        _sut = new PricingContract(
            _catalog.Object,
            _assignments.Object,
            _entitlements.Object,
            _usageEngine.Object,
            _marginResolver.Object,
            _creditEngine.Object,
            Mock.Of<ILogger<PricingContract>>());
    }

    [Test]
    public async Task ResolvePlanAsync_Returns_Pinned_Deprecated_Version_Not_Latest()
    {
        var tenantId = Guid.NewGuid();
        var planV1Id = Guid.NewGuid();

        _assignments.Setup(a => a.GetActiveAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TenantPlanAssignment
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                PlanId = planV1Id,
                PlanVersion = 1,
                Status = "active",
            });

        _catalog.Setup(c => c.GetByIdAsync(planV1Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlanSnapshot(
                PlanId: planV1Id,
                Slug: "team",
                DisplayName: "Team v1",
                Version: 1,
                Status: "deprecated",
                IsCustom: false,
                BillingInterval: "monthly",
                SupersedesPlanId: null,
                Features: [],
                Entitlements: [],
                Prices: []));

        var view = await _sut.ResolvePlanAsync(tenantId);

        view.TenantId.Should().Be(tenantId);
        view.PlanId.Should().Be(planV1Id);
        view.PlanVersion.Should().Be(1);
        view.Status.Should().Be("deprecated", "pinned version survives deprecation");
        _catalog.Verify(c => c.GetActiveBySlugAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task ResolvePlanAsync_FailsLoud_On_Missing_Assignment_And_Missing_Snapshot()
    {
        var tenantId = Guid.NewGuid();
        _assignments.Setup(a => a.GetActiveAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((TenantPlanAssignment?)null);

        var ex1 = (await FluentActions.Invoking(() => _sut.ResolvePlanAsync(tenantId))
            .Should().ThrowAsync<TammaError>()).Which;
        ex1.Code.Should().Be(PricingContract.NoAssignmentErrorCode);

        var missingPlanId = Guid.NewGuid();
        _assignments.Setup(a => a.GetActiveAsync(tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TenantPlanAssignment { TenantId = tenantId, PlanId = missingPlanId, PlanVersion = 1, Status = "active" });
        _catalog.Setup(c => c.GetByIdAsync(missingPlanId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlanSnapshot?)null);

        var ex2 = (await FluentActions.Invoking(() => _sut.ResolvePlanAsync(tenantId))
            .Should().ThrowAsync<TammaError>()).Which;
        ex2.Code.Should().Be(PricingContract.CatalogUnavailableErrorCode);
    }

    [Test]
    public async Task ResolveEntitlementsAsync_Always_Returns_Closed_SevenKey_Set()
    {
        var tenantId = Guid.NewGuid();
        var planId = Guid.NewGuid();
        var closedMap = EntitlementDefaults.BuildClosedMap(
        [
            new PlanEntitlementView(EntitlementMetricKey.LlmTokens, 2_000_000, "monthly", "meter"),
            new PlanEntitlementView(EntitlementMetricKey.Seats, 10, "total", "block"),
        ]);

        _entitlements.Setup(e => e.ResolveAsync(
                It.Is<EntitlementPrincipal>(p => p.TenantId == tenantId),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ResolvedEntitlements(tenantId, planId, 2, false, closedMap));

        var view = await _sut.ResolveEntitlementsAsync(tenantId);

        view.TenantId.Should().Be(tenantId);
        view.PlanVersion.Should().Be(2);
        view.Limits.Should().HaveCount(7, "all 7 EntitlementMetricKey members must always be returned");
        view.Limits.Select(l => l.MetricKey).Should().BeEquivalentTo(EntitlementMetricKeyExtensions.AllMetricStrings);
        view.Limits.Single(l => l.MetricKey == "llm_tokens").LimitValue.Should().Be(2_000_000L);
    }

    [Test]
    public async Task PriceUsageAsync_Honors_PlatformProvided_And_Byok_PricingModes()
    {
        var tenantId = Guid.NewGuid();
        var policy = new MarginPolicy { Id = Guid.NewGuid(), Scope = "global", MarkupMultiplier = 1.3m, Status = "active", EffectiveFrom = FixedNow.AddDays(-1) };
        _marginResolver.Setup(m => m.ResolveAsync("anthropic", It.IsAny<string?>(), FixedNow, It.IsAny<CancellationToken>()))
            .ReturnsAsync(policy);

        var platformLine = new UsageLine("anthropic", "claude-sonnet-4-5", 1000, 500, PricingMode.PlatformProvided, FixedNow);
        var byokLine = new UsageLine("anthropic", "claude-sonnet-4-5", 1000, 500, PricingMode.Byok, FixedNow);

        _usageEngine.Setup(u => u.PriceUsage(platformLine, policy))
            .Returns(new PricedUsage(1.00m, 0.30m, 1.30m, PricingMode.PlatformProvided));
        _usageEngine.Setup(u => u.PriceUsage(byokLine, policy))
            .Returns(new PricedUsage(1.00m, 0.00m, 0.00m, PricingMode.Byok));

        var platformView = await _sut.PriceUsageAsync(tenantId, platformLine);
        platformView.CostBasisUsd.Should().Be(1.00m);
        platformView.MarginUsd.Should().Be(0.30m);
        platformView.SellPriceUsd.Should().Be(1.30m);
        platformView.PricingMode.Should().Be("platform_provided");

        var byokView = await _sut.PriceUsageAsync(tenantId, byokLine);
        byokView.CostBasisUsd.Should().Be(1.00m);
        byokView.MarginUsd.Should().Be(0.00m);
        byokView.SellPriceUsd.Should().Be(0.00m);
        byokView.PricingMode.Should().Be("byok");
    }

    [Test]
    public async Task PriceNetAsync_Maintains_NetPrice_Invariant_And_PassThrough_Default()
    {
        var tenantId = Guid.NewGuid();
        var line = new UsageLine("anthropic", "claude-sonnet-4-5", 1000, 500, PricingMode.PlatformProvided, FixedNow);

        _creditEngine.Setup(c => c.PriceNetAsync(line, tenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new NetPriceResult(
                SellPriceUsd: 10.00m,
                PromoDiscountUsd: 2.00m,
                CreditsAppliedUsd: 3.50m,
                NetPriceUsd: 4.50m,
                TrialWaived: false));

        var view = await _sut.PriceNetAsync(tenantId, line);
        view.NetPriceUsd.Should().Be(view.SellPriceUsd - view.PromoDiscountUsd - view.CreditsAppliedUsd);
        view.NetPriceUsd.Should().Be(4.50m);
        view.TrialWaived.Should().BeFalse();

        // Also test PassThroughCreditAwarePricingEngine default directly
        var policy = new MarginPolicy { Id = Guid.NewGuid(), Scope = "global", MarkupMultiplier = 1.25m, Status = "active", EffectiveFrom = FixedNow.AddDays(-1) };
        _marginResolver.Setup(m => m.ResolveAsync("anthropic", It.IsAny<string?>(), FixedNow, It.IsAny<CancellationToken>()))
            .ReturnsAsync(policy);
        _usageEngine.Setup(u => u.PriceUsage(line, policy))
            .Returns(new PricedUsage(4.00m, 1.00m, 5.00m, PricingMode.PlatformProvided));

        var passThrough = new PassThroughCreditAwarePricingEngine(
            _assignments.Object,
            _catalog.Object,
            _marginResolver.Object,
            _usageEngine.Object,
            Mock.Of<ILogger<PassThroughCreditAwarePricingEngine>>());

        var net = await passThrough.PriceNetAsync(line, tenantId);
        net.SellPriceUsd.Should().Be(5.00m);
        net.PromoDiscountUsd.Should().Be(0m);
        net.CreditsAppliedUsd.Should().Be(0m);
        net.NetPriceUsd.Should().Be(5.00m);
        net.TrialWaived.Should().BeFalse();
    }
}
