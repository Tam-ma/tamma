# Implementation Plan — Story 47-6: Unconditional SaaS Provider Gate and Credentials

## Scope & Deliverable

Remove single-user paths from `SaaSProviderGate`, `DefaultProviderCredentialResolver`, `ConfigPlatformFallbackPolicy`, `ProviderSettingsStore`, `EmailCredentialResolver` and `JiraCredentialResolver`. Verify credential administration and runtime callers. Completion evidence is mapped to the [story acceptance criteria](./47-6-unconditional-saas-provider-gate-and-credentials.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [apps/tamma-elsa/src/Tamma.Api/Services/Security/SaaSProviderGate.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Security/SaaSProviderGate.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Providers/DefaultProviderCredentialResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Providers/DefaultProviderCredentialResolver.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Providers/ConfigPlatformFallbackPolicy.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Providers/ConfigPlatformFallbackPolicy.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Providers/ProviderSettingsStore.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Providers/ProviderSettingsStore.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Integrations/EmailCredentialResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Integrations/EmailCredentialResolver.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Integrations/JiraCredentialResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Integrations/JiraCredentialResolver.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/ProviderCredentialServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/ProviderCredentialServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Extensions/ProviderSettingsServiceCollectionExtensions.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Extensions/ProviderSettingsServiceCollectionExtensions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/ProviderCredentialEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/ProviderCredentialEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/ProviderAdminEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/ProviderAdminEndpoints.cs)
- [apps/tamma-elsa/tests/Tamma.Api.Tests/Security/SaaSProviderGateMatrixTests.cs](../../../../apps/tamma-elsa/tests/Tamma.Api.Tests/Security/SaaSProviderGateMatrixTests.cs)

## Design Decisions

- **D1 — Keep eligibility authoritative.** Enforce the current SaaS catalog and plan decisions at managed execution and retain stable denial wires. Treat missing tenant scope as a failed tenant call.
- **D2 — Credential precedence and explicit platform intent.** Preserve tenant BYOK first, then allowed platform fallback through `IRuntimeSecretResolver`. Apply the existing provider/global fallback rules and prove callers intended platform scope before permitting a tenant-less credential lookup.
- **D3 — Settings and integration storage.** Operate on platform defaults and tenant-keyed settings; flush affected credential and settings entries through the existing invalidation hooks. Use cabinet-backed email and Jira for tenant traffic and remove their local config fallbacks.

## Implementation Steps

1. Trace `SaaSProviderGate` through managed execution and inventory every credential resolver caller. Identify explicit platform jobs, tenant calls and the expected error code where scoping or eligibility fails.
2. Remove remaining local gate and fallback wiring. Verify credential fetch follows eligibility, and sanitize diagnostic paths. Update credential endpoint authorization and `Program.cs` factories as required.
3. Remove user-owner reads from `ProviderSettingsStore`, including parent or default lookups. Keep platform defaults explicit and preserve update, rotation and deletion invalidation across the settings and credential services.
4. Remove local config fallback methods in the Email and Jira resolvers. Wire tenant cabinet resolution and confirm user-visible unavailable results at integration call sites.
5. Run the two-tenant and gate matrices, then smoke one managed provider and each integration with SaaS-format credentials.

## Data & Migrations

Retain encrypted cabinet and provider metadata schemas. Exclude legacy `ProviderSetting.UserId` rows from active resolution. Preserve credential versioning and re-authorization data in the D1 export contract.

## Events

Preserve existing credential resolved/denied emission through `DefaultProviderCredentialResolver` and SaaS gate diagnostics. Keep source and version attribution for downstream billing and audit.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Extend `SaaSProviderGateMatrixTests.cs` and `ProviderGateDiTests.cs` with permitted API key and BYOK cases, local provider denial, and assertions that denied cases make zero credential/dispatch calls.
- Extend `ProviderCredentialResolverTests.cs`, `ConfigPlatformFallbackPolicyTests.cs` and `ProviderSettingsStoreTests.cs` with context confusion, two tenant caches, explicit platform calls, and rotation/delete invalidation.
- `EmailCredentialResolverTests.cs` and `JiraCredentialResolverTests.cs` cover configured legacy values, absent and partial tenant bundles, foreign keys and a successful tenant lookup. Inspect logs and events for credential canaries.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1–2 | 1–2, 5 | Eligibility and credential precedence matrix |
| AC 3 | 1, 3, 5 | Cache and setting isolation fixtures |
| AC 4–5 | 2, 4–5 | Integration resolver failures and redaction checks |

## Risks & Mitigations

- **A null tenant opens a platform credential path.** Verify trusted scope in callers and assert missing tenant requests perform zero platform credential reads.
- **Credential or settings cache survives a change.** Assert rotation, delete and settings invalidation using warm cache fixtures across two tenants.
- **Local credential moves into SaaS by accident.** Validate cabinet-only tenant resolution and keep local re-authorization in D1.
