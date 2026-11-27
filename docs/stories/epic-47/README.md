# Epic 47: Single-User Mode Extraction & Pure SaaS Cutover

## Overview

`Tam-ma/tamma` becomes a multi-tenant SaaS platform. TammaDesktop takes ownership of local execution, personal subscriptions, and the public CLI. The cutover first separates the SaaS worker from the CLI and verifies a signed local-state export with TammaDesktop Epic D1. It then hardens tenant isolation and enforcement before retiring local routing and packaging.

[Approved extraction design](../../architecture/SAAS-PURE-EXTRACTION-DESIGN.md)

## Design principles

- **Require SaaS configuration at startup.** Supply an explicit control-plane connection, JWT signing configuration and the required encryption keys before the API accepts traffic. Make tenant and platform authority explicit at the point of use.
- **Preserve local state before switching.** Export the personal-tenant schema and user-owned control-plane data, and verify the import with TammaDesktop D1. Operators re-authorize credentials in the desktop keychain. Existing SaaS tenant rows and historical event/audit records stay readable.
- **Keep SaaS traffic live and drain affected work.** Roll healthy SaaS revisions while compatible instances serve traffic. Quiesce local writers for the final cross-plane snapshot. Reconcile pending legacy `agent_run_waits` and Elsa bookmarks before removing any lookup or input needed to resume them.
- **Keep provider, billing and quota enforcement active.** Route eligible tenant and platform credentials through the production SaaS gate. Preserve payer attribution and metering, including `BillingMode.PlatformProvided` and `BillingMode.Byok`.
- **Enforce the cutover in CI.** Replace mode matrices with tenant isolation and fail-closed behavior tests. Add forbidden-symbol patterns for retired production paths and retain narrow support for historic record reads.

## Four-phase cutover

| Phase | Stories | Exit evidence |
|---|---|---|
| S1 — Pre-cutover and export | 47-1, 47-2 | Docker and Actions run without the public CLI. TammaDesktop D1 verifies the signed archive, data round trip and credential re-authorization. |
| S2 — Identity, authorization and tenant isolation | 47-3 through 47-5 | Explicit SaaS settings pass readiness. Invalid settings fail before startup side effects. Two-tenant tests pass across identity, governance and application data. |
| S3 — Provider, billing and quota enforcement | 47-6, 47-7 | Provider and integration isolation, Stripe/webhook and quota regression suites pass. |
| S4 — Workflows, packaging and CI | 47-8 through 47-10 | Legacy waits are reconciled, CLI handoff is complete, SaaS deployment passes without the CLI, and CI and runbook rehearsal are green. |

**Shared implementation.** Story 47-3 owns the buildable removal of the mode selector and the changes required to keep each caller on its existing SaaS path. Stories 47-4 through 47-8 own subsystem-specific deletions and regression tests. Coordinate changes in `Tamma.Api/Program.cs`, DI extensions and test fixtures as part of that sweep. Begin 47-8's legacy-wait inventory in S1 and clear any wait that needs the removed runtime paths before activating S2. Recheck both data planes and Elsa immediately before S4 removes the remaining inputs and bindings.

**Rollback.** Pin the previous images and workflow revisions and preserve affected databases and Elsa state through S1–S3. Roll back on failed readiness, isolation or billing checks while old revisions still have compatible config and state. Before the S4 removals, verify the archived export, drain evidence and recoverable backups. After retirement, any recovery requiring legacy services uses the retained release and the rehearsed restore procedure described by 47-10.

## Stories

| Story | Title | Priority | Status | Est. Effort | Implementation Plan |
|---|---|---|---|---|---|
| 47-1 | [SaaS Worker Runner CLI Decoupling](./story-47-1/47-1-saas-worker-runner-cli-decoupling.md) | P0 | drafted | 4–6 days | [Plan](./story-47-1/implementation-plan.md) |
| 47-2 | [Local Single-User State Exporter](./story-47-2/47-2-local-single-user-state-exporter.md) | P0 | drafted | 6–9 days | [Plan](./story-47-2/implementation-plan.md) |
| 47-3 | [Remove TammaMode and Fail Closed at SaaS Startup](./story-47-3/47-3-remove-tamma-mode-and-fail-closed-saas-startup.md) | P0 | drafted | 5–7 days | [Plan](./story-47-3/implementation-plan.md) |
| 47-4 | [Remove Sole User and Personal Tenant Bootstrap](./story-47-4/47-4-remove-sole-user-and-personal-tenant-bootstrap.md) | P0 | drafted | 4–6 days | [Plan](./story-47-4/implementation-plan.md) |
| 47-5 | [Unconditional Tenant Scope for Governance, Prompts and Analytics](./story-47-5/47-5-unconditional-tenant-scope-for-governance-prompts-analytics.md) | P0 | drafted | 8–12 days | [Plan](./story-47-5/implementation-plan.md) |
| 47-6 | [Unconditional SaaS Provider Gate and Credentials](./story-47-6/47-6-unconditional-saas-provider-gate-and-credentials.md) | P0 | drafted | 5–7 days | [Plan](./story-47-6/implementation-plan.md) |
| 47-7 | [Remove Null Billing and Quota Shims](./story-47-7/47-7-remove-null-billing-and-quota-shims.md) | P0 | drafted | 5–7 days | [Plan](./story-47-7/implementation-plan.md) |
| 47-8 | [Remove Deployment Mode and Local PAT Fallbacks](./story-47-8/47-8-remove-deployment-mode-and-local-pat-fallbacks.md) | P0 | drafted | 7–10 days | [Plan](./story-47-8/implementation-plan.md) |
| 47-9 | [Dashboard, CLI and Deployment Pure SaaS Cleanup](./story-47-9/47-9-dashboard-cli-and-deployment-pure-saas-cleanup.md) | P1 | drafted | 5–8 days | [Plan](./story-47-9/implementation-plan.md) |
| 47-10 | [Pure SaaS Test Cutover and Forbidden Symbols Gate](./story-47-10/47-10-pure-saas-test-cutover-and-forbidden-symbols-gate.md) | P0 | drafted | 6–9 days | [Plan](./story-47-10/implementation-plan.md) |

## Dependencies

- **TammaDesktop Epic D1.** Agree the archive and verification contract in S1. Confirm a successful import before activating S2 and confirm distribution ownership before removing the public CLI in S4.
- **Worker and workflow continuity.** Complete 47-1 before any CLI removal. Clear CLI-bound Elsa executors and live legacy waits under 47-8 before packaging is deleted.
- **Existing SaaS services.** Use the repository's tenant and control-plane database mappings, Git App installations, verified authentication, encrypted secret cabinet, Stripe billing, quotas and Elsa resume mechanisms.
- **Audited baseline.** The extraction design records 503 matching lines at `b37f1031`. Story 47-10 reconciles the 74 matched test files and checks for callers added after that revision.
