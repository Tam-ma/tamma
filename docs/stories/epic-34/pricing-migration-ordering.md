# Epic 34 — Pricing Migration Ordering (Control-Plane vs Tenant Schemas)

Mirrors [`docs/stories/migration-ordering.md`](../migration-ordering.md) for the EF Core control-plane migration pipeline (`apps/tamma-elsa/src/Tamma.Data/Migrations/ControlPlane/`).

## Tenancy Placement Rule

**All Epic 34 pricing tables are strictly control-plane resident (`ControlPlaneDbContext`).**

There are **NO** per-tenant schema (`t_<hex>`, `TenantDbContext`) pricing tables. Plans, features, entitlements, prices, margin policies, provider cost price-books, and tenant plan assignments are global control-plane state.

## Ordered Control-Plane Pricing Migrations

| Order | Story | Migration | Tables / Effect | Dependencies |
|-------|-------|-----------|-----------------|--------------|
| 1 | 34-1 | `AddPlanCatalogVersionedTables` | Adds versioning columns to `plans`; creates `plan_features`, `plan_entitlements`, `plan_prices` | `plans` (Epic 28) |
| 2 | 34-11 | `AddProviderCostPriceBook` | Creates `providers`, `provider_model_prices` | Baseline CP |
| 3 | 34-5 | `AddMarginPolicies` | Creates `margin_policies` | `plans` (34-1) |
| 4 | 34-3 | `AddTenantProviderBilling` | Creates `tenant_provider_billing` | `tenants` (Epic 28) |
| 5 | 34-4 | `AddTenantPlanAssignment` | Creates `tenant_plan_assignments` (partial unique active index per tenant) | `tenants`, `plans` (34-1) |
| 6 | 34-10 | `PricingBackfillDataStep` | **Data-only** idempotent backfill: legacy `plans."Quotas"` JSON → `plan_entitlements` (`llmTokensPerMonth`, `seats`, `-1` → `NULL`) + one `active` `tenant_plan_assignments` row per non-deleted tenant (`NOT EXISTS` guarded) | 34-1 (`plan_entitlements`), 34-4 (`tenant_plan_assignments`) |

## Startup Backfill & Rollback Semantics

- **Defense-in-depth:** `PricingBackfillService.RunAsync(BackfillTrigger.Startup)` runs once at API startup after `PlansSeeder.SeedAsync` to heal any tenant created between migrations and to emit `PRICING.BACKFILL.STARTED` / `PRICING.BACKFILL.COMPLETED` / `PRICING.BACKFILL.SKIPPED` platform events.
- **Re-run safety:** Both the EF data migration (`NOT EXISTS` guards) and `PricingBackfillService` (insert-missing-only + prior-completion check) are strictly idempotent. Re-running produces zero duplicate rows.
- **Rollback (pre-production):** Per `CLAUDE.md`, Tamma is pre-production — rollback is drop-and-reseed rather than a reversible data down-migration. `Down()` on `PricingBackfillDataStep` deletes only rows stamped with `Reason = 'backfill: 34-10'`.
