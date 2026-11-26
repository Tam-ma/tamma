using Tamma.Api.Dtos.Pricing;

namespace Tamma.Api.Services.Pricing;

/// <summary>
/// Story 34-10 (AC4, AC5) — THE published, stable read-contract for Epic 34
/// Pricing. Downstream epics (Billing / Epic 35, Enforcement, Analytics) call
/// ONLY these four read operations rather than reaching into <c>Plan</c>,
/// <c>PlanEntitlement</c>, <c>TenantPlanAssignment</c>, or internal pricing
/// engines directly. See <c>docs/stories/epic-34/pricing-contract.md</c>.
/// </summary>
public interface IPricingContract
{
    /// <summary>
    /// Resolve the tenant's pinned, effective plan version (NOT "latest" —
    /// survives plan deprecation). Fails loud with
    /// <c>PRICING.CONTRACT.NO_ASSIGNMENT</c> or
    /// <c>PRICING.CONTRACT.CATALOG_UNAVAILABLE</c>.
    /// </summary>
    Task<PlanContractView> ResolvePlanAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Resolve the complete, closed 7-key entitlement set for the tenant.
    /// </summary>
    Task<EntitlementContractView> ResolveEntitlementsAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Price one usage line at LIST price (cost basis × margin), honoring
    /// <c>PricingMode</c> (BYOK token markup = 0).
    /// </summary>
    Task<PricedUsageView> PriceUsageAsync(Guid tenantId, UsageLine line, CancellationToken ct = default);

    /// <summary>
    /// Price one usage line NET of promos, credits, and trial waiver.
    /// </summary>
    Task<NetPriceView> PriceNetAsync(Guid tenantId, UsageLine line, CancellationToken ct = default);
}
