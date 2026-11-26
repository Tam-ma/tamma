# Implementation Plan — Story 47-5: Unconditional Tenant Scope for Governance, Prompts and Analytics

## Scope & Deliverable

Consolidate ActionPolicy, AcceptanceRules, PromptStore, Conventions, Analytics, Tracker, Chat and OrchestratorConfig to the existing tenant and explicitly authorized platform scopes. Cover endpoint, service, background and data wiring. Completion evidence is mapped to the [story acceptance criteria](./47-5-unconditional-tenant-scope-for-governance-prompts-analytics.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/ActionPolicyEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/ActionPolicyEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/AcceptanceRulesEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/AcceptanceRulesEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/PromptEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/PromptEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/ConventionStoreEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/ConventionStoreEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/TenantAnalyticsEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/TenantAnalyticsEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/TrackerEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/TrackerEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/ChatEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/ChatEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/OrchestratorConfigEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/OrchestratorConfigEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/TaskEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/TaskEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/LlmRunStreamEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/LlmRunStreamEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/Admin/ScheduledTriggerEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/Admin/ScheduledTriggerEndpoints.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Actions/GovernancePolicySnapshotStore.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Actions/GovernancePolicySnapshotStore.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/PromptStore/PromptStoreService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/PromptStore/PromptStoreService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Conventions/ConventionStore.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Conventions/ConventionStore.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Orchestrator/OrchestratorConfigService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Orchestrator/OrchestratorConfigService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Tracker/TrackerAssigneeResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Tracker/TrackerAssigneeResolver.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Chat/ChatHistoryProjection.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Chat/ChatHistoryProjection.cs)
- [apps/tamma-elsa/src/Tamma.Data/Repositories/ConventionRepository.cs](../../../../apps/tamma-elsa/src/Tamma.Data/Repositories/ConventionRepository.cs)
- [apps/tamma-elsa/src/Tamma.Data/DependencyInjection.cs](../../../../apps/tamma-elsa/src/Tamma.Data/DependencyInjection.cs)

## Design Decisions

- **D1 — Ownership and actor attribution.** Resolve one verified tenant identity at each endpoint or background dispatch boundary, then pass it through services and schema factories. Preserve user membership, authorship, per-user inbox/chat visibility and any additional repository-based authorization.
- **D2 — Scope map.** Tenant governance rows and authorized platform ceilings feed the current governance snapshot. Acceptance rules, prompt overrides, conventions and orchestrator configuration use their landed SaaS precedence. Analytics and tracker query tenant data. Chat projection keeps tenant and actor visibility. Explicit platform defaults retain current authorization and storage.
- **D3 — Compatibility.** Preserve public wire keys and concurrency tokens. Keep historic storage and projections readable. Exclude CP user-owned legacy rows from live scope queries with explicit key conditions, including where platform and user-owned rows share a table.

## Implementation Steps

1. Produce a route/service/store ownership matrix from the pre-reading. Include tenant selection and role, platform override checks, actor filters, cache keys, writes, and background dispatch.
2. Convert ActionPolicy, governance snapshots, AcceptanceRules and OrchestratorConfig to tenant IDs for active overrides. Preserve platform precedence and the policy evaluation contract under `BackgroundActionGate`.
3. Convert PromptStore and Conventions handlers and repositories to the tenant schema path, keeping the authorized default path. Pin precedence and stale-revision outcomes.
4. Apply verified scope to Analytics, Tracker, Chat and adjoining agent, task, scheduled-trigger and LLM stream routes. Exercise all read/write and streaming projection paths. Coordinate any Tracker response change with 47-9.
5. Verify tenant DB factory and DI bindings, remove obsolete user-owner branches and check historic DCB/audit reads on an upgraded database.

## Data & Migrations

No bulk promotion of legacy user settings to tenant or platform settings. Retain legacy rows during the rollback window and keep active SaaS reads scoped. Preserve document, event and audit payloads, keys, revisions and lineage.

## Events

Keep existing governance, prompt, convention, tracker and chat event contracts. Emit tenant-scoped changes with actor attribution and preserve historical `mode: "single-user"` data in readers.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Use `AcceptanceRulesEndpointsTests.cs`, `PromptEndpointsTenantAdminTests.cs`, `PromptEndpointsUpsertConflictTests.cs`, `ConventionStoreUpsertConflictTests.cs` and `OrchestratorConfigTests.cs` as the matrix seeds.
- Extend `GovernancePolicySnapshotStoreTests.cs`, `CostAnalyticsEndpointTests.cs`, `TrackerEndpointsTests.cs` and `ChatHistoryProjectionTests.cs` for two tenants sharing issue names, keys and actor membership where supported.
- Integration tests cover two-tenant read, write and cache isolation, conflicting writes, platform-owner defaults, missing tenant, and historic event/audit compatibility.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 1–2, 5 | Policy, precedence and background fixtures |
| AC 2 | 1, 3, 5 | Prompt/conventions isolation and conflict fixtures |
| AC 3 | 1, 4–5 | Analytics, tracker and chat integration matrix |
| AC 4 | 1, 4–5 | Endpoint inventory and historic reader test |

## Risks & Mitigations

- **User-keyed CP rows appear global.** Use explicit scope and ownership filters and fixture all row kinds in the same store.
- **Tenant cache survives a context switch.** Key snapshots by tenant and test immediate reads after update and switch.
- **Actor visibility is lost during the change.** Pin user/team/repository visibility separately from ownership.
