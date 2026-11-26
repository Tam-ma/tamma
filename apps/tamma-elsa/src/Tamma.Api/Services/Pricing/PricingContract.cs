using Microsoft.Extensions.Logging;
using Tamma.Api.Dtos.Pricing;
using Tamma.Core;
using Tamma.Core.Enums;

namespace Tamma.Api.Services.Pricing;

/// <summary>
/// Story 34-10 (AC4, AC6) — thin, delegation-only implementation of
/// <see cref="IPricingContract"/>. Contains ZERO pricing math or caching of its
/// own: every call forwards directly to the canonical Epic 34 services
/// (<see cref="IPlanCatalogService"/>, <see cref="IPlanAssignmentService"/>,
/// <see cref="IEntitlementService"/>, <see cref="IUsagePricingEngine"/>,
/// <see cref="IMarginPolicyResolver"/>, and <see cref="ICreditAwarePricingEngine"/>).
/// </summary>
public sealed class PricingContract : IPricingContract
{
    public const string NoAssignmentErrorCode = "PRICING.CONTRACT.NO_ASSIGNMENT";
    public const string CatalogUnavailableErrorCode = "PRICING.CONTRACT.CATALOG_UNAVAILABLE";

    private readonly IPlanCatalogService _catalog;
    private readonly IPlanAssignmentService _assignments;
    private readonly IEntitlementService _entitlements;
    private readonly IUsagePricingEngine _usageEngine;
    private readonly IMarginPolicyResolver _marginResolver;
    private readonly ICreditAwarePricingEngine _creditEngine;
    private readonly ILogger<PricingContract> _logger;

    public PricingContract(
        IPlanCatalogService catalog,
        IPlanAssignmentService assignments,
        IEntitlementService entitlements,
        IUsagePricingEngine usageEngine,
        IMarginPolicyResolver marginResolver,
        ICreditAwarePricingEngine creditEngine,
        ILogger<PricingContract> logger)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(assignments);
        ArgumentNullException.ThrowIfNull(entitlements);
        ArgumentNullException.ThrowIfNull(usageEngine);
        ArgumentNullException.ThrowIfNull(marginResolver);
        ArgumentNullException.ThrowIfNull(creditEngine);
        ArgumentNullException.ThrowIfNull(logger);

        _catalog = catalog;
        _assignments = assignments;
        _entitlements = entitlements;
        _usageEngine = usageEngine;
        _marginResolver = marginResolver;
        _creditEngine = creditEngine;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<PlanContractView> ResolvePlanAsync(Guid tenantId, CancellationToken ct = default)
    {
        _logger.LogDebug("PricingContract.ResolvePlanAsync tenantId={TenantId}", tenantId);

        var active = await _assignments.GetActiveAsync(tenantId, ct).ConfigureAwait(false);
        if (active is null)
        {
            _logger.LogError(
                "{ErrorCode}: tenant {TenantId} has no active plan assignment.",
                NoAssignmentErrorCode, tenantId);
            throw new TammaError(
                NoAssignmentErrorCode,
                $"Tenant '{tenantId:D}' has no active plan assignment.",
                new Dictionary<string, object?> { ["tenantId"] = tenantId.ToString("D") },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }

        var snapshot = await _catalog.GetByIdAsync(active.PlanId, ct).ConfigureAwait(false);
        if (snapshot is null)
        {
            _logger.LogError(
                "{ErrorCode}: pinned plan {PlanId} (v{PlanVersion}) for tenant {TenantId} was not found in catalog.",
                CatalogUnavailableErrorCode, active.PlanId, active.PlanVersion, tenantId);
            throw new TammaError(
                CatalogUnavailableErrorCode,
                $"Pinned plan '{active.PlanId:D}' v{active.PlanVersion} for tenant '{tenantId:D}' is unavailable.",
                new Dictionary<string, object?>
                {
                    ["tenantId"] = tenantId.ToString("D"),
                    ["planId"] = active.PlanId.ToString("D"),
                    ["planVersion"] = active.PlanVersion,
                },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }

        return PlanContractView.From(snapshot, active);
    }

    /// <inheritdoc />
    public async Task<EntitlementContractView> ResolveEntitlementsAsync(
        Guid tenantId, CancellationToken ct = default)
    {
        _logger.LogDebug("PricingContract.ResolveEntitlementsAsync tenantId={TenantId}", tenantId);

        var resolved = await _entitlements
            .ResolveAsync(EntitlementPrincipal.ForTenant(tenantId), ct)
            .ConfigureAwait(false);

        return EntitlementContractView.From(resolved);
    }

    /// <inheritdoc />
    public async Task<PricedUsageView> PriceUsageAsync(
        Guid tenantId, UsageLine line, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(line);
        _logger.LogDebug(
            "PricingContract.PriceUsageAsync tenantId={TenantId} provider={Provider} mode={Mode}",
            tenantId, line.Provider, line.PricingMode);

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
        return PricedUsageView.From(priced);
    }

    /// <inheritdoc />
    public async Task<NetPriceView> PriceNetAsync(
        Guid tenantId, UsageLine line, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(line);
        _logger.LogDebug(
            "PricingContract.PriceNetAsync tenantId={TenantId} provider={Provider} mode={Mode}",
            tenantId, line.Provider, line.PricingMode);

        var net = await _creditEngine
            .PriceNetAsync(line, tenantId, ct)
            .ConfigureAwait(false);

        return NetPriceView.From(net);
    }
}
