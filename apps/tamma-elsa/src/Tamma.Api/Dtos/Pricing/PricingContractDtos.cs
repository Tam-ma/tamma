using Tamma.Api.Services.Pricing;
using Tamma.Core.Enums;
using Tamma.Data.Entities;

namespace Tamma.Api.Dtos.Pricing;

/// <summary>
/// Story 34-10 (AC4, AC6) — stable wire/contract view of a tenant's pinned plan
/// version returned by <see cref="IPricingContract.ResolvePlanAsync"/>.
/// </summary>
public sealed record PlanContractView(
    Guid TenantId,
    Guid PlanId,
    string Slug,
    string DisplayName,
    int PlanVersion,
    bool IsCustom,
    string BillingInterval,
    string Status)
{
    public static PlanContractView From(PlanSnapshot snapshot, TenantPlanAssignment assignment) =>
        new(
            TenantId: assignment.TenantId,
            PlanId: assignment.PlanId,
            Slug: snapshot.Slug,
            DisplayName: snapshot.DisplayName,
            PlanVersion: assignment.PlanVersion,
            IsCustom: snapshot.IsCustom,
            BillingInterval: snapshot.BillingInterval,
            Status: snapshot.Status);
}

/// <summary>
/// Story 34-10 (AC4, AC6) — stable contract view of one entitlement line.
/// </summary>
public sealed record EntitlementLineView(
    string MetricKey,
    long? LimitValue,
    string Period,
    string OverageMode);

/// <summary>
/// Story 34-10 (AC4, AC6) — complete, closed 7-key entitlement set returned by
/// <see cref="IPricingContract.ResolveEntitlementsAsync"/>.
/// </summary>
public sealed record EntitlementContractView(
    Guid TenantId,
    Guid PlanId,
    int PlanVersion,
    bool IsCustom,
    IReadOnlyList<EntitlementLineView> Limits)
{
    public static EntitlementContractView From(ResolvedEntitlements resolved) =>
        new(
            TenantId: resolved.TenantId,
            PlanId: resolved.PlanId,
            PlanVersion: resolved.PlanVersion,
            IsCustom: resolved.IsCustom,
            Limits: EntitlementDefaults.AllMetrics
                .Select(k =>
                {
                    var line = resolved.Get(k);
                    return new EntitlementLineView(
                        MetricKey: k.ToMetricString(),
                        LimitValue: line.LimitValue,
                        Period: line.Period,
                        OverageMode: line.OverageMode);
                })
                .ToArray());
}

/// <summary>
/// Story 34-10 (AC4, AC6) — list-priced usage line returned by
/// <see cref="IPricingContract.PriceUsageAsync"/>.
/// </summary>
public sealed record PricedUsageView(
    decimal CostBasisUsd,
    decimal MarginUsd,
    decimal SellPriceUsd,
    string PricingMode)
{
    public static PricedUsageView From(PricedUsage priced) =>
        new(
            CostBasisUsd: priced.CostBasisUsd,
            MarginUsd: priced.MarginUsd,
            SellPriceUsd: priced.SellPriceUsd,
            PricingMode: priced.PricingMode == Tamma.Core.Enums.PricingMode.Byok ? "byok" : "platform_provided");
}

/// <summary>
/// Story 34-10 (AC4, AC6) — credit-aware net price returned by
/// <see cref="IPricingContract.PriceNetAsync"/>, satisfying the 34-7 invariant
/// <c>NetPriceUsd == SellPriceUsd - PromoDiscountUsd - CreditsAppliedUsd</c>
/// (or <c>0</c> when <c>TrialWaived == true</c>).
/// </summary>
public sealed record NetPriceView(
    decimal SellPriceUsd,
    decimal PromoDiscountUsd,
    decimal CreditsAppliedUsd,
    decimal NetPriceUsd,
    bool TrialWaived)
{
    public static NetPriceView From(NetPriceResult net) =>
        new(
            SellPriceUsd: net.SellPriceUsd,
            PromoDiscountUsd: net.PromoDiscountUsd,
            CreditsAppliedUsd: net.CreditsAppliedUsd,
            NetPriceUsd: net.NetPriceUsd,
            TrialWaived: net.TrialWaived);
}
