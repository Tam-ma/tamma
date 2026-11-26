# Tamma Pure SaaS — Single-User Mode Extraction & Decommission Design

**Version:** 1.0.0
**Date:** 2026-11-26
**Status:** Architecture Plan (Paired with Epic 47 & `TammaDesktop`)
**Audited Baseline:** `Tam-ma/tamma` commit `b37f1031` (`main`)

---

## 1. Purpose & Scope

This document specifies the safe, staged extraction and complete removal of **single-user mode** (`TammaMode.SingleUser`) from `Tam-ma/tamma`, turning `Tam-ma/tamma` into a **pure multi-tenant cloud SaaS platform** while handing off all single-machine personal-subscription, CLI, desktop, and local-engine capabilities to **`TammaDesktop`**.

### Why Remove Single-User Mode from `Tam-ma/tamma`?
1. **Eliminate 503-line dual-mode complexity & security hazard:** `TammaMode` currently defaults to `SingleUser` when SaaS config signals are absent (`TammaMode.cs:67`). A misconfigured production deployment could silently disable multi-tenant isolation, billing, quotas, and `SaaSProviderGate`.
2. **Eliminate architectural split-brain:** Personal CLI/IDE subscriptions (Claude Max, Codex Pro, Kimi Code, GLM Agent, Antigravity) belong strictly on a user's local machine (`TammaDesktop`), while `Tam-ma/tamma` enforces strict tenant isolation, API-key/BYOK eligibility, Stripe billing, plan entitlements, and cloud execution.
3. **Shrink maintenance & test surface:** 249 of the 503 mode references live in dual-mode test matrices that must test both SaaS and single-user branches for every endpoint, service, and middleware.

---

## 2. Exact Single-User Footprint Audit (`Tam-ma/tamma`)

Reproducible inventory (`git grep -inE 'TammaMode\.SingleUser|ITammaModeProvider|SoleUserProvider|EnsurePersonalTenantMiddleware|NullBillingProvider' -- apps/tamma-elsa/src apps/tamma-elsa/tests .github`): **503 matching lines across 151 tracked files**.

| Subsystem | Files | Lines | Key Symbols & Paths | Disposition |
|---|---:|---:|---|---|
| **1. Startup, Identity & Auth** | 4 | 23 | `Tamma.Api/Program.cs`, `Services/PromptStore/TammaMode.cs`, `Auth/PermissionHandler.cs`, `Middleware/{EnsurePersonalTenant,TenantContext}Middleware.cs`, `Services/Actions/{SoleUserProvider,GovernancePrincipalResolver,BackgroundActionGate,GovernancePolicySnapshotStore}.cs` | **DELETE** mode detection, sole-user owner inference, personal-tenant auto-bootstrap, and single-user permission bypasses. **KEEP** verified JWT/API-key auth, `ITenantContext`, `PlatformOwnerAccess`, and tenant-scoped governance. |
| **2. Tenant Data, Endpoints & Services** | 64 | 219 | 20 endpoint files, 33 service files, 11 DI extensions across acceptance rules, action policy, admin/scheduled triggers, agents, auth/orgs, billing, chat, conventions, LLM streams, orchestrator config, pricing, prompts, provider admin/credentials, tasks, analytics, tracker; `Tamma.Data/DependencyInjection.cs` | **DELETE** single-user owner fallbacks, user-keyed CP settings overrides, and single-user response branches. **KEEP** tenant-scoped and platform-scoped paths, historic DCB event/audit readers. |
| **3. Provider Credentials & Eligibility Gate** | ~15 | ~45 | `SaaSProviderGate.cs`, `DefaultProviderCredentialResolver.cs`, `ProviderSettingsStore.cs`, `ConfigPlatformFallbackPolicy.cs`, `Services/Integrations/{Email,Jira}CredentialResolver.cs` | **DELETE** `SaaSProviderGate` single-user no-op bypass and sole-user secret fallback branches. **KEEP** strict SaaS API-key/BYOK gate, tenant `ProviderCredential`, cache invalidation, and explicit platform-scoped credentials. |
| **4. Billing, Pricing & Quotas** | ~12 | ~38 | `BillingServiceCollectionExtensions.cs`, `QuotaServiceCollectionExtensions.cs`, `NullBillingProvider.cs`, `NullBillingModeTagger.cs`, `NullQuotaService.cs`, `InvoiceEndpoints.cs`, `QuotaEndpoints.cs`, `SubscriptionEndpoints.cs` | **DELETE** `NullBillingProvider`, `NullBillingModeTagger`, `NullQuotaService` production bindings and "Billing is SaaS-only" short-circuits. **KEEP** Stripe provider, `BillingMode.PlatformProvided`/`Byok`, metering, quotas, dunning, and test fakes strictly inside test assemblies. |
| **5. Elsa Workflows, Git & Runners** | 8 | 10 | `Tamma.Core/Deployment/DeploymentMode.cs`, `Tamma.Platforms/{PlatformResolver,SingleUserPlatformOptions}.cs`, `DeploymentPipelineWorkflow.cs`, `SingleIssueCycleWorkflow.cs`, `AdlOrchestratorWorkflow.cs`, `Tamma.Activities/{ADL,Security,TenantLifecycle}` | **DELETE** `DeploymentMode` inference, `SingleUserPlatformOptions`, and local config-PAT fallback for tenant traffic. **KEEP** GitHub/GitLab/Gitea App installations, webhook verification, runner scaffolding, and `effect:deploy.prod` governance. |
| **6. TypeScript CLI & CI Runner Packaging** | ~20 | — | `packages/cli/`, `docker/Dockerfile.ts:43`, `.github/workflows/tamma-worker.yml:53`, `apps/tamma-engine/`, `packages/orchestrator/src/saas-coordinator.ts` | **CRITICAL PRECONDITION:** `docker/Dockerfile.ts` and `.github/workflows/tamma-worker.yml` invoke `packages/cli` directly! Extract a dedicated **`@tamma/worker-runner`** (SaaS CI runner executable) BEFORE deprecating/removing `packages/cli` from `Tam-ma/tamma`. |
| **7. Dashboards & Tests** | 76+ | 251+ | `packages/dashboard/`, `packages/dashboard-user/`, 74 test files in `Tamma.Api.Tests`, `Tamma.Activities.Tests`, `Tamma.Platforms.IntegrationTests`, `.github/scripts/dotnet-test-weights.json` | Remove single-user mode branches/toggles in UI; remove single-user test branches and add **pure-SaaS invariant tests** (fail-closed startup if required SaaS config is missing, zero single-user symbols via `forbidden-symbols` CI gate). |

---

## 3. Four-Phase Cutover Architecture (Zero-Downtime & Reversible Until Phase 4)

```text
Phase S1 (Pre-Cutover & Export)
  ├── Story 47-1: Extract dedicated SaaS @tamma/worker-runner (decouple Dockerfile.ts & tamma-worker.yml from packages/cli)
  └── Story 47-2: Ship `tamma export-local` bundle exporter (export personal-tenant + CP user-keyed state for TammaDesktop D1 import)
          │
          ▼  (TammaDesktop Epic D1 verifies lossless import of export bundle!)
Phase S2 (Identity, Auth & Tenant Isolation Hardening)
  ├── Story 47-3: Remove TammaMode / ITammaModeProvider & fail-closed SaaS startup config validation
  ├── Story 47-4: Remove SoleUserProvider, EnsurePersonalTenantMiddleware & PermissionHandler single-user bypasses
  └── Story 47-5: Consolidate Governance, ActionPolicy, Prompts, Conventions & Analytics to unconditional tenant/platform scopes
          │
          ▼
Phase S3 (Unconditional Provider, Billing & Quota Enforcement)
  ├── Story 47-6: Make SaaSProviderGate, ProviderCredentials & Integration Resolvers unconditionally SaaS-enforced
  └── Story 47-7: Remove NullBillingProvider / NullQuotaService / NullBillingModeTagger & billing single-user short-circuits
          │
          ▼
Phase S4 (Workflows, Deployment, CLI Removal & CI Guardrails)
  ├── Story 47-8: Remove DeploymentMode, SingleUserPlatformOptions & local PAT fallbacks in Elsa/Platforms
  ├── Story 47-9: Clean dashboards (`dashboard`, `dashboard-user`), remove `packages/cli` from Tam-ma/tamma & prune single-user Docker/Compose files
  └── Story 47-10: Pure-SaaS test suite cutover, `forbidden-symbols` CI regression gate & migration runbook
```

---

## 4. Data Safety & Migration Invariants

1. **No Silent Fallback on Misconfiguration:** After Story 47-3, omitting `ConnectionStrings:ControlPlane`, JWT signing config, or KEK configuration causes **immediate fail-closed startup failure** — `Tamma.Api` can never silently boot in a degraded single-user mode.
2. **Lossless Local State Export Before Removal:** Story 47-2 exports a signed JSON+SQLite archive (`tamma-local-export-v1.tar.gz`) capturing both personal-tenant schema rows (events, documents, conventions, budgets, prompt overrides, workflows) AND control-plane user-keyed rows (action policies, provider metadata — excluding raw secrets, which re-authorize cleanly in TammaDesktop's OS keychain).
3. **In-Flight Durable Waits Safe:** Before Story 47-8 removes legacy `dev`/`business` deployment tokens or single-user routing keys, existing `agent_run_waits` and Elsa bookmarks drain cleanly; historic DCB event and audit log readers remain backwards-compatible with archived `mode: "single-user"` tags in old rows.
4. **Permanent CI Ratchet:** Story 47-10 registers `TammaMode`, `SingleUser`, `SoleUserProvider`, `EnsurePersonalTenantMiddleware`, and `NullBillingProvider` in the repository's `forbidden-symbols` CI check so single-user mode can never creep back into `Tam-ma/tamma`.

---

## 5. Story Index

All 10 stories and their detailed implementation plans live under [`docs/stories/epic-47/`](../stories/epic-47/README.md).
