# ADR: Story 39-17 — Orchestrator Agent Hosting, Scoping & Context Architecture

- **Status:** Accepted
- **Date:** 2026-11-26
- **Story:** `docs/stories/epic-39/story-39-17/39-17-orchestrator-agent-long-running-llm-process-platform-context-tools.md`

## Context

Story 39-17 introduces a long-running, stateful **Orchestrator Agent** — one persistent LLM session per tenant (or for the sole user in single-user mode) — that consumes `AcceptanceRequest`, `EscalationRaised`, `GuidanceQuery`, and user conversation turns, invokes a closed audited toolset over the tenant's data, and makes routing/acceptance decisions.

We evaluated two candidate hosting seams in the existing codebase:

1. **Option A — Host on the `AgentDispatch` executor stack** (`apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/IAgentExecutor.cs`, `LocalExecutor`, `GitHubActionsExecutor`, `AgentMonitorService`, `WebhookSignalRegistry`).
2. **Option B — Host in `Tamma.Api` as a `BackgroundService` (`OrchestratorAgentHost`) managing per-tenant `OrchestratorAgentInstance` loops on top of `IInlineToolLoopRunner`**.

## Decision

**Choose Option B: Host the orchestrator agent in `Tamma.Api` as an opt-in hosted service (`OrchestratorAgentHost`, `Enabled` default `false`) managing per-tenant `OrchestratorAgentInstance` instances riding `IInlineToolLoopRunner.RunConversationAsync`.**

### Why Option A (`AgentDispatch`) was rejected

- **Wrong process shape:** `AgentDispatch` spawns short-lived external coding CLI processes (Claude Code / GitHub Actions runner jobs) per task with workspace artifacts and webhook completion signals. A resident decision-making orchestrator needs low-latency, stateful, database-coupled access to the tenant's DCB event stream, document store, acceptance rules, access model, and workflow resume surface.
- **Epic 32 mediation boundary:** The Epic 32 pivot moved all LLM provider credentials (`IProviderCredentialResolver`), gating (`ISaaSProviderGate`), budget guards (`IBudgetGuard`), pricing (`IProviderPricingService`), and the single agentic tool loop (`IInlineToolLoopRunner`) into `Tamma.Api`. `Tamma.Activities` and `Tamma.ElsaServer` are guarded by `ActivitiesGuardrailTests` and Roslyn analyzer `TAMMA001` (`EngineExternalCallAnalyzerTests`) to forbid direct provider access in the engine.
- **Credential & DB fan-out:** Running external processes per tenant would require a separate credential relay, per-tenant database/API token minting, and process supervision for idle tenants.

### Consequences

1. **Single tool-loop copy (D3):** `IInlineToolLoopRunner` gains `RunConversationAsync`, accepting a caller-owned `List<ConversationMessage>` and an optional `IToolExecutorRegistry` override. Legacy `RunAsync` stays byte-identical.
2. **Narrow mediation allowlist (D2):** Engine guardrails (`ActivitiesGuardrailTests`, `EngineExternalCallAnalyzerTests`) require zero weakening. A new reflection pin (`OrchestratorMediationPinTests`) in `Tamma.Api.Tests` asserts that ONLY `ManagedAgent` and `ToolLoopTurnRunner` consume `IInlineToolLoopRunner`, citing Story 39-17 as authority.
3. **Strict per-tenant isolation (AC1 / AC6):**
   - **SaaS mode:** One `OrchestratorAgentInstance` per `tenantId`, keyed in `OrchestratorAgentRegistry`, with its own `OrchestratorSession`, daily spend tracker, inbox subscription, and principal-bound `AuditedToolRegistry`. Config rows in `orchestrator_agent_configs` are keyed by `tenant_id` (`user_id IS NULL`), editable by tenant `admin`/`owner` (`orchestrator:manage`), readable by members.
   - **Single-user mode:** One `OrchestratorAgentInstance` owned by the sole user; config rows keyed by `user_id` (`tenant_id IS NULL`), editable by the sole user.
4. **Statefulness & restart recovery (D9 / D10):**
   - The in-memory `OrchestratorSession` is a bounded cache (deterministic compaction after `CompactAfterTurns` or `MaxSessionTokens`).
   - The DCB stream + document store are the memory of record. On restart, the instance re-hydrates a bootstrap context block from `IEventRepository.QueryEventsAsync` (recent `ORCHESTRATOR.*`, `APPROVAL.*`, `ESCALATION.*`, `DOCUMENT.*`) and emits `ORCHESTRATOR.SESSION.REHYDRATED`.
   - Pending work lives in `IOrchestratorInbox` (backed by Story 39-18's persisted `channel_outbox` in production; `InMemoryOrchestratorInbox` in development/tests). Decisions land exclusively through Story 39-8's idempotent `ResumeDocumentDecisionAsync` (a 404/409 `GateNotFound` acks and drops without double-answering).
5. **Known interim gaps (tracked explicitly, never silently papered over):**
   - **`kb_search` / `rag_query`:** Fail-closed until Story 39-21's tenant-isolated C# RAG seam lands; the interim `/api/kb/*` sidecar is tenant-blind and is deliberately NOT exposed to the orchestrator.
   - **`log_search`:** Backed by the tenant's DCB stream (`QueryEventsAsync`) plus `ProviderDiagnostic` rows (`IDiagnosticsService`), since application logs currently emit to stdout with no persisted log store.
   - **Real-LLM judgment:** Verified only when a real LLM provider is configured (same posture as Story 39-9). The deterministic test suite uses `ScriptedTurnRunner` driving the real `AuditedToolRegistry`, guardrails, routing, and resume surfaces.

## Revisit Triggers

Re-evaluate out-of-process per-tenant hosting only if enterprise compliance requires OS-process memory isolation per tenant or if tenant concurrency exceeds single-host `Tamma.Api` capacity.
