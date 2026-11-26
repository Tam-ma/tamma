using Microsoft.Extensions.Logging;

namespace Tamma.Api.Services.Pricing;

/// <summary>
/// Story 34-7 / Story 34-10 — net price outcome after promotional discounts,
/// wallet/prepaid credits, and trial waiver. Satisfies the invariant
/// <c>NetPriceUsd == SellPriceUsd - PromoDiscountUsd - CreditsAppliedUsd</c>
/// when <see cref="TrialWaived"/> is <c>false</c>.
/// </summary>
public sealed record NetPriceResult(
    decimal SellPriceUsd,
    decimal PromoDiscountUsd,
    decimal CreditsAppliedUsd,
    decimal NetPriceUsd,
    bool TrialWaived);

/// <summary>
/// Story 34-7 / Story 34-10 — seam computing net billable price for a usage
/// line after applying active promos, credits, and trial status. Until Story
/// 34-7 registers its full implementation, <see cref="PassThroughCreditAwarePricingEngine"/>
/// serves as the documented pass-through default (<c>NetPriceUsd == SellPriceUsd</c>).
/// </summary>
public interface ICreditAwarePricingEngine
{
    Task<NetPriceResult> PriceNetAsync(UsageLine line, Guid tenantId, CancellationToken ct = default);
}

/// <summary>
/// Story 34-10 (Soft Prerequisite fallback for Story 34-7) — pass-through
/// implementation that delegates to Story 34-5's <see cref="IUsagePricingEngine"/>
/// + <see cref="IMarginPolicyResolver"/> and returns <c>NetPriceUsd == SellPriceUsd</c>
/// with zero discounts and <c>TrialWaived == false</c>.
/// </summary>
public sealed class PassThroughCreditAwarePricingEngine : ICreditAwarePricingEngine
{
    private readonly IPlanAssignmentService _assignments;
    private readonly IPlanCatalogService _catalog;
    private readonly IMarginPolicyResolver _marginResolver;
    private readonly IUsagePricingEngine _usageEngine;
    private readonly ILogger<PassThroughCreditAwarePricingEngine> _logger;

    public PassThroughCreditAwarePricingEngine(
        IPlanAssignmentService assignments,
        IPlanCatalogService catalog,
        IMarginPolicyResolver marginResolver,
        IUsagePricingEngine usageEngine,
        ILogger<PassThroughCreditAwarePricingEngine> logger)
    {
        ArgumentNullException.ThrowIfNull(assignments);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(marginResolver);
        ArgumentNullException.ThrowIfNull(usageEngine);
        ArgumentNullException.ThrowIfNull(logger);

        _assignments = assignments;
        _catalog = catalog;
        _marginResolver = marginResolver;
        _usageEngine = usageEngine;
        _logger = logger;
    }

    public async Task<NetPriceResult> PriceNetAsync(
        UsageLine line, Guid tenantId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(line);

        string? planSlug = null;
        var active = await _assignments.GetActiveAsync(tenantId, ct).ConfigureAwait(false);
        if (active is not null)
        {
            var snap = await _catalog.GetByIdAsync(active.PlanId, ct).ConfigureAwait(false);
            planSlug = snap?.Slug;
        }

        var policy = await _marginResolver
            .ResolveAsync(line.Provider, planSlug, line.OccurredAt, ct)
            .ConfigureAwait(false);
        var priced = _usageEngine.PriceUsage(line, policy);

        _logger.LogDebug(
            "Pass-through credit-aware pricing engaged (Story 34-7 pending) for tenantId={TenantId} sellPriceUsd={SellPrice}",
            tenantId, priced.SellPriceUsd);

        return new NetPriceResult(
            SellPriceUsd: priced.SellPriceUsd,
            PromoDiscountUsd: 0m,
            CreditsAppliedUsd: 0m,
            NetPriceUsd: priced.SellPriceUsd,
            TrialWaived: false);
    }
}
