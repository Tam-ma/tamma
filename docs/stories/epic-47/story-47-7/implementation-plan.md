# Implementation Plan — Story 47-7: Remove Null Billing and Quota Shims

## Scope & Deliverable

Delete `NullBillingProvider`, `NullBillingModeTagger`, `NullQuotaService` and billing-only mode short-circuits. Make real Stripe, quota, usage and webhook composition explicit while preserving the billing and entitlement contracts. Completion evidence is mapped to the [story acceptance criteria](./47-7-remove-null-billing-and-quota-shims.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/BillingServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/BillingServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/BillingModeServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/BillingModeServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/QuotaServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/QuotaServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/BillingWebhookServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/BillingWebhookServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/BillingUsageServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/BillingUsageServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/InvoiceEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/InvoiceEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/SubscriptionEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/SubscriptionEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/QuotaEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/QuotaEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/BillingUsageEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/Billing/BillingUsageEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/StripeBillingProvider.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/StripeBillingProvider.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingModeTagger.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingModeTagger.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/QuotaService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/QuotaService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/NullBillingProvider.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/NullBillingProvider.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/NullBillingModeTagger.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/NullBillingModeTagger.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/NullQuotaService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/NullQuotaService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/MeterEventFlushTaskHandler.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/MeterEventFlushTaskHandler.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookDcbEvents.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookDcbEvents.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Billing/QuotaEvents.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Billing/QuotaEvents.cs)
- [apps/tamma-elsa/src/Tamma.Api/Program.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Program.cs)

## Design Decisions

- **D1 — Required dependencies.** Resolve real billing, metering and quota services with their existing lifetimes. Validate composition on boot and surface explicit prerequisite errors for operations that require Stripe credentials or tenant provisioning.
- **D2 — Route and permission parity.** Retain SaaS routes and filters, `PlatformOwnerAccess` on admin/replay, and signature verification at the Stripe webhook boundary. Make `IInvoiceService` a required handler dependency.
- **D3 — Preserve billing attribution.** Keep `BillingMode.PlatformProvided` and `Byok`, quota enforcement, spend ownership and idempotency. These values describe the payer and remain part of production metering.

## Implementation Steps

1. Record actual billing service bindings and route policies from the composition root and extensions. Confirm the SaaS-only selector change from 47-3 and enumerate optional lookups and `billing_saas_only` returns.
2. Delete all three shims and update real service wiring. Remove obsolete optional DI and classify missing credentials, price configuration, or tenant provision as explicit errors on affected operations.
3. Update invoice and quota/usage routes and verify subscription plus webhook maps and signing. Protect existing tenant route data access and admin permissions.
4. Convert null-shim and dual-mode tests to SaaS positive/negative cases using scoped Stripe fakes in the test assemblies. Run quota, meter flush, replay and tenant lifecycle scenarios.

## Data & Migrations

No schema change. Preserve Stripe IDs, billing/usage rollups, idempotency keys and subscription state. Verify rollout resumes existing queued meter events and dunning work exactly once logically.

## Events

Preserve `BillingWebhookDcbEvents`, `BillingMeterEventTypes`, and `QuotaEvents` contracts. Retain audit attribution and safe logs when a webhook or meter retry fails.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Extend `AddTammaBillingTests.cs` and `AddBillingWebhookIngestionTests.cs` for real DI and absent shim classes. Replace `NullBillingProviderTests.cs` assertions with failure-contract coverage.
- Extend `InvoiceEndpointsIntegrationTests.cs`, `QuotaEndpointsAndIntegrationTests.cs`, `BillingUsageEndpointsTests.cs` and `BillingWebhookRoutesTests.cs` with role, tenant boundary, spent limit and invalid signing fixtures.
- `BillingTenantCreateHookTests.cs` and `MeterEventFlushTaskHandlerTests.cs` exercise provisioning, duplicate/retry cases, both billing modes and missing prerequisites.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 1–2, 4 | Production DI and assembly inventory |
| AC 2 | 1–4 | Billing route integration and signature tests |
| AC 3–4 | 2–4 | Quota, meter flush, lifecycle and replay tests |

## Risks & Mitigations

- **Billing disappears behind optional DI.** Require the handler/service binding and exercise route discovery and host composition.
- **Missing or invalid configuration allows spend.** Assert that missing prerequisites cannot use a production null service or succeed as an allowed quota decision.
- **Changing billing attribution duplicates charges.** Replay existing idempotency keys and verify data transitions and Stripe call counts.
