# Epic 34 — Published Pricing Contract (`IPricingContract`)

**Status:** Published (Story 34-10)
**Assembly / Namespace:** `Tamma.Api.Services.Pricing.IPricingContract` (`Tamma.Api.Dtos.Pricing`)

## Layering Rule (Mandatory)

`IPricingContract` is the **sole sanctioned read surface** for downstream epics — including **Epic 35 (Billing)**, **Enforcement**, and **Analytics (Epic 36)**.

No code outside `Tamma.Api.Services.Pricing` / `Tamma.Api.Endpoints.Admin` (Epic 34) may take a direct dependency on:

- Entities: `Plan`, `PlanEntitlement`, `PlanFeature`, `PlanPrice`, `TenantPlanAssignment`
- Internal services: `IPlanCatalogService`, `IPlanAssignmentService`, `IEntitlementService`, `IUsagePricingEngine`, `IMarginPolicyResolver`, `ICreditAwarePricingEngine`

All cross-epic pricing reads MUST go through `IPricingContract`.

## Operations

| Method | Delegates To | Return DTO | Failure Mode |
|--------|--------------|------------|--------------|
| `ResolvePlanAsync(Guid tenantId, CancellationToken ct)` | 34-4 `IPlanAssignmentService.GetActiveAsync` + 34-1 `IPlanCatalogService.GetByIdAsync` | `PlanContractView` | Throws `TammaError("PRICING.CONTRACT.NO_ASSIGNMENT")` or `TammaError("PRICING.CONTRACT.CATALOG_UNAVAILABLE")` — never returns empty/latest |
| `ResolveEntitlementsAsync(Guid tenantId, CancellationToken ct)` | 34-6 `IEntitlementService.ResolveAsync` | `EntitlementContractView` (closed 7-key map) | Fails loud if tenant has no active assignment |
| `PriceUsageAsync(Guid tenantId, UsageLine line, CancellationToken ct)` | 34-5 `IMarginPolicyResolver.ResolveAsync` + `IUsagePricingEngine.PriceUsage` | `PricedUsageView` | Throws `PRICING.MARGIN.NO_POLICY` / `PRICING.UNKNOWN_MODEL` |
| `PriceNetAsync(Guid tenantId, UsageLine line, CancellationToken ct)` | 34-7 `ICreditAwarePricingEngine.PriceNetAsync` | `NetPriceView` | Satisfies `NetPriceUsd == SellPriceUsd - PromoDiscountUsd - CreditsAppliedUsd` (or `0` when `TrialWaived`) |

## Wire Shapes (`Tamma.Api.Dtos.Pricing`)

```csharp
public sealed record PlanContractView(
    Guid TenantId, Guid PlanId, string Slug, string DisplayName,
    int PlanVersion, bool IsCustom, string BillingInterval, string Status);

public sealed record EntitlementContractView(
    Guid TenantId, Guid PlanId, int PlanVersion, bool IsCustom,
    IReadOnlyList<EntitlementLineView> Limits); // always all 7 EntitlementMetricKey members

public sealed record EntitlementLineView(
    string MetricKey, long? LimitValue, string Period, string OverageMode);

public sealed record PricedUsageView(
    decimal CostBasisUsd, decimal MarginUsd, decimal SellPriceUsd, string PricingMode);

public sealed record NetPriceView(
    decimal SellPriceUsd, decimal PromoDiscountUsd, decimal CreditsAppliedUsd,
    decimal NetPriceUsd, bool TrialWaived);
```

## `PricingMode` Semantics (`platform_provided` vs `byok`)

- **`platform_provided`** (`PricingMode.PlatformProvided`): Tamma supplies the upstream LLM credential. `PriceUsageAsync` computes `CostBasisUsd` from the provider price-book (34-11), applies the resolved `MarginPolicy` multiplier, and returns `SellPriceUsd` + `MarginUsd`.
- **`byok`** (`PricingMode.Byok`): Tenant supplies its own provider API key (34-3). `CostBasisUsd` is still computed for analytics, while the token sell price and markup are **zero** (`SellPriceUsd == 0m`, `MarginUsd == 0m`). BYOK tenants are billed flat/seat fees only.

## Story 34-7 Pass-Through Note

Until Story 34-7 (Trials, Credits & Promo Codes) lands its credit/promo ledger implementation, `AddPricingContract()` registers `PassThroughCreditAwarePricingEngine` via `TryAddScoped<ICreditAwarePricingEngine, PassThroughCreditAwarePricingEngine>()`. It delegates to 34-5 and returns `NetPriceUsd == SellPriceUsd`, `PromoDiscountUsd == 0`, `CreditsAppliedUsd == 0`, `TrialWaived == false`. When Story 34-7 ships, registering its real `ICreditAwarePricingEngine` before or over the default swaps `PriceNetAsync` seamlessly with zero caller changes.

## Legacy Columns Deprecation

`Plan.Quotas` (JSON string) and `Tenant.Plan` (slug string) remain on the tables for one deprecation window (Story 34-1 decision) and are kept in lockstep by `IPlanAssignmentService` and `PricingBackfillService`. No pricing path reads `Plan.Quotas` after Story 34-10.
