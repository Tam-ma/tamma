# Story 47-7: Remove Null Billing and Quota Shims

Status: drafted

## User Story

As a **SaaS platform operator**, I want real billing, metering and quota services on every production deployment, so that a missing provision or configuration cannot silently allow unmetered execution.

## Priority

P0 / Phase S3

## Scope

Delete `NullBillingProvider`, `NullBillingModeTagger`, `NullQuotaService` and billing-only mode short-circuits. Make real Stripe, quota, usage and webhook composition explicit while preserving the billing and entitlement contracts.

## Acceptance Criteria

1. The production service graph resolves `StripeBillingProvider`, `BillingModeTagger`, and `QuotaService` behind their interfaces. Startup/test host checks show the three null implementations are absent from production assemblies and test fakes stay in test projects.
2. Invoice, subscription, usage, quota and Stripe webhook routes are available with their existing SaaS authorization. Missing active tenant, foreign resource, invalid signature and missing service prerequisites yield their intended error, with no `billing_saas_only` response.
3. Metering and quota fixtures cover `BillingMode.PlatformProvided` and `BillingMode.Byok`, exhausted and reset limits, and missing entitlement or billing configuration. Missing prerequisites fail explicitly and cannot produce an allow decision through a production shim.
4. Stripe customer/subscription lifecycle, dunning and webhook retries preserve idempotency, with no duplicate usage or subscription transitions in replay tests.

## Dependencies

- 47-3 removes the mode-dependent registration and route-map selectors. 47-7 owns production shim deletion and billing service/endpoint behavior. Validate against 47-6 credential-source attribution.

## Estimated Effort

5–7 days

## Dev Notes

`InvoiceEndpoints` also emits `billing_saas_only` if optional service lookup returns no `IInvoiceService`. Bind the real service and replace that lookup. Keep tenant permissions and `PlatformOwnerAccess` on billing admin operations.

[Implementation plan](./implementation-plan.md)
