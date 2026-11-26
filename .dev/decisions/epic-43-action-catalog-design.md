# Epic 43 — Action Catalog: design decisions

**Date**: 2026-07-25
**Status**: Accepted
**Deciders**: product owner (D1–D3), Claude (S1–S6, mechanism choices)

## Context

The autonomy dial (`AcceptanceRules.AutonomyLevel`, 70–100) is stored, validated, defaulted and
displayed, and nothing reads it to decide anything. `AcceptanceGuardrails.TryPreGate` — the component
that would consume it — has zero production call sites. The consuming layer was never built; Epic 43
is that layer.

The product requirement is a permissions-list-style catalog of every action the system can take,
grouped, where an admin sets per group or per action what the system may do by itself at a given
autonomy level and what a person decides — with actions already automated at the current floor still
listed (greyed) so a future lower floor needs no redesign.

## Decisions

### D1 — v1 enforces, with behaviour-preserving defaults

The gate is **live in v1**. Every action ships assigned exactly as it behaves today, so nothing
changes on day one; admins opt into gating and it takes effect immediately.

**Rejected: declarative v1** (catalog + admin + audit, enforcement later). It leaves the dial gating
nothing, which is the problem being solved. The design that came out of the judged panel proposed
this shape in disguise — enforcement present but switched off per-target, with the flip gated on a
30-day observation soak. Under it an admin who sets deploy to human-only gets nothing until the flip.
Overridden.

**Rejected: enforce with pre-gated safe defaults** (ship deploy/rollback/MCP already gated). Two
behaviour changes in one release — the first thing in the codebase able to block a running workflow,
*and* a set of newly-gated actions.

The observation soak survives as advice about tightening *defaults*, not as a precondition for the
gate existing.

**One permanent exception:** the llm-call seam is observe-only in every version. A requires-human
returned there reaches a dispatch whose calling workflow has no human route in 44 of 45 cases —
escalation into a void — and it would double-gate deploy against the Elsa-graph seam. Enforcement for
agent-actions lives only where a real human wait exists.

### D2 — Unclassified is allowed at runtime, unmergeable in CI

A capability that performs an action with no catalog entry **fails CI**. If one reaches runtime
anyway it is **allowed**, not blocked: strictness where it is cheap, tolerance where it is expensive
(a live workflow stalling on a catalog gap).

**Rejected: fail-closed at runtime.** Any gap becomes a production stall, and the existing tool path
is fail-open (a null allowlist permits every tool), so this would be a large silent behaviour change.

**Rejected: a Roslyn analyzer**, which is how "blocked at build" was originally specified. Rejected on
measurement, not preference:

- **79 of the 200 mutating `Map*` calls in `Program.cs` terminate `);` on the same line** with no
  fluent chain to inspect — a ~40% structural miss rate for any rule keyed on "the chain contains X".
- `app.MapControllers()`, `app.MapHub<…>` and Elsa's `UseWorkflowsApi()` are invisible to syntax
  analysis; the last runs in a different process.
- A "body must call the gate" rule cannot apply to interface *declarations*, and is satisfiable by any
  dead or unreached call.

An analyzer with a 40% blind spot is worse than none: a completeness guarantee that is not complete is
the precise failure this epic exists to prevent. CI blocks the merge either way; what is lost is
local-build feedback. The one good analyzer idea — flagging an activity that carries no `[Activity]`
attribute — is taken as a reflection test instead, which is cheaper and equally effective.

### D3 — No lower bound in the model; `[70,100]` as one named constant

The catalog and policy model carry no lower bound. The validated range stays `[70,100]`, expressed
once in `AutonomyDial`, so widening downward later is a single edit.

Consequences:
- No story may hardcode 70 or 100 a second time. Two unlanded specs currently would — Story 39-23's
  `minAutonomyLevel` and Story 42-1's `AutonomyFloor`. Both are corrected or superseded here.
- No DB CHECK on the threshold column: a CHECK lives in a migration snapshot and is a permanent second
  hardcoding.
- When the range is eventually widened to include 0, the corrupt-row test vector that uses `5` becomes
  legal and needs replacing.
- `AlwaysHuman = Max + 1` is derived from `Max`, so "one edit" holds **downward only**. Raising `Max`
  would silently reinterpret every stored sentinel as an ordinary threshold. Only the downward case
  was asked for; the claim is not unconditional.

## Settled without the product owner

- **S1 Union catalog** across agent-actions, tools, external effects, document types, platform tasks
  and background automation. Not agent-actions only — anything less leaves the highest-consequence
  surfaces outside the catalog.
- **S2 Single source of truth.** Epic 42's tool governance becomes a consumer. Twelve concrete
  duplications resolved; 42-2 and 42-3 deleted.
- **S3 Level-independent storage, level-parameterized display.** One integer per action, not a
  level×action matrix. A matrix is 4,743 cells per principal, admits non-monotone policy, and costs 70
  new cells per action to widen the floor where a threshold costs zero. The per-level editing
  experience is identical — the admin clicks a row, never types a number.
- **S5 Groups assignable as a whole; an individual action overrides its group** (`??`, not `max()` —
  which is what "override" means, and what the existing rules resolver already does). The consequence,
  that an admin can lower one action below its group, is a recorded risk with UI mitigation.
- **S6 Both operating modes.**

## Mechanism choices worth recording

- **Composite `ActionKey`, not a flat enum.** A flat ~153-member enum would copy all 80 agent-action
  wire strings into a second vocabulary — the exact drift the epic prevents.
- **Bidirectional drift checks.** The catalog is derived from the code, so both directions hold when
  written; if code is deleted the check says to delete the entry. The judgment call is at authoring
  time: do not catalogue a placeholder workflow as a real capability.
- **Control-plane residency, forced not preferred.** Tenant residency fails three ways: hosted
  services have no ambient tenant context, the engine plane may carry no tenant at all, and a new
  tenant migration never reaches already-provisioned tenants (the migrator runs only on the two
  tenant-creation paths; there is no startup sweep).
- **Deliberate exclusion from the destructive startup DROP list.** Every other table on it is
  operational data; these are the only thing between an agent and a production deploy, and the list
  runs on every restart. Tested.
- **`409` on denial, never `202`.** The mediation client branches solely on success status and `202`
  is already a success code on it — a 202 escalation is indistinguishable from success.
- **Named `AutonomyGate*`, never `ActionGate*`** — `Tamma.Activities.Security.ActionGate` is a shipped
  DI-registered type and the name collides inside `Tamma.Api`.
- **`AlwaysEscalate` absorbed, not deleted.** It is shipped, DTO-exposed, UI-editable and has a live
  production producer. It becomes a floor composed with `max()`, so a legacy entry cannot be lowered
  by the new surface.

## Epic 42 Reconciliation (2026-07-25; applied to specs by Story 43-10 on 2026-11-26)

Epic 42 was, structurally, a second action catalog designed in parallel before Epic 43 existed. None of
Epic 42 had landed in code, so resolving the conflict was a specification reconciliation rather than a
code migration.

### The twelve duplications resolved

1. **Duplicate risk/permission taxonomy:** `ToolPermissionClass` (`ReadOnly`/`Mutating`/`Command`/`Destructive`) vs `Tamma.Core/Actions/ActionRisk` (identical members, catalog-wide).
2. **Duplicate autonomy threshold field:** `ToolDescriptor.AutonomyFloor` vs `ActionDescriptor.DefaultMinAutonomy` + `action_assignments.min_autonomy`.
3. **Duplicate hardcoded dial bounds:** `42-1`'s `[70,100]` check on `AutonomyFloor` (and `39-23`'s `minAutonomyLevel`) vs Epic 43 D3's single `AutonomyDial` constant.
4. **Duplicate registration category:** `ToolDescriptor.Category` vs the registry's registration path + `ActionNamespace`.
5. **Duplicate per-principal override table:** `tool_bindings` (`42-2`, third `user_id XOR tenant_id` policy store) vs `action_assignments` (`43-5`).
6. **Duplicate admin surface & RBAC permission:** `tools:manage` / `ToolsManage` (`42-2`) vs `actions:manage` / `ActionsManage` (`43-6`).
7. **Duplicate live-read autonomy resolver seam:** `42-3`'s proposed live-read seam vs `IAcceptanceRulesResolver.ResolveBase*Async` (`43-5`).
8. **Duplicate tool-loop enforcement gate:** `42-3` stage 2 vs Epic 43 Seam B (`43-9`) on the exact same `InlineToolLoopRunner` call site with no stated ordering.
9. **Duplicate human escalation machinery:** `42-3`'s sibling `ToolAuthorizationRequest` + `WaitForToolAuthorizationActivity` + new bookmark prefix vs `IActionAuthorizationLedger` + Seam E over existing resume endpoints (`43-5` / `43-9`).
10. **Duplicate governance audit family:** `42-3`'s `TOOL.RESOLVED`/`DENIED`/`ESCALATED`/`AUTHORIZED` and `42-2`'s `TOOL.BINDING_*` vs `ACTION.GATE.*` (`43-5`).
11. **Duplicate durable tool-call trail:** `42-5`'s Scope §5 revival of `AGENT.TOOL_CALL.*` via always-empty `InlineToolLoopResult.ToolCalls` alongside `TOOL.*`.
12. **Double production-deploy gate:** `42-8B` Scope 4 / AC7 requiring Epic 39's `AlwaysEscalate` class to bind *independently* of both the autonomy dial and `42-3`'s grant (two gates, two audit ids, two human decisions for one deploy) vs Epic 43 absorbing `AlwaysEscalate` as a `max()` floor with one correlation-scoped grant and an OR'd business-mode predicate.

### Per-story verdicts

| Story | Verdict |
|---|---|
| **42-1** | **Rewritten** — `ToolDescriptor(SecretRequirement? RequiredSecret, bool Suspends)`; `ToolCategory`, `ToolPermissionClass`, `AutonomyFloor`, the DIM default and its three caveats, and former ACs 2/4/5/8 deleted (replaced by the compiler, 43-4 boot validation, and `AutonomyDial.IsValidThreshold`). `SecretPurpose` relocation (§0), `Register`/`Unregister` platform-only seam (§3), and `Suspends` wording preserved verbatim. |
| **42-2** | **Deleted** (superseded by Epic 43 Story 43-5). |
| **42-3** | **Deleted** (superseded by Epic 43 Story 43-9). |
| **42-4** | **Unchanged** in core scope; carries the `ConfigJson` open question (secret-name override) and invocation-time fail-closed AC6. |
| **42-5** | **Narrowed** — keeps `TOOL.INVOKED`/`SUCCEEDED`/`FAILED`; drops `permissionClass`/`autonomyAtCall` and governance events (pointing at `ACTION.GATE.*`); deletes Scope §5's `InlineToolLoopResult.ToolCalls` population and AC8; downgrades 42-1 to a soft enhancement. |
| **42-6** | **Part A unchanged.** **Part B** gains the catalog-binding prerequisite (unclassified ⇒ rejected at registration; answers PO Q1 as *deny*) **and is marked blocked on the MCP catalog-binding fork below**. |
| **42-7 / 42-8A / 42-8B / 42-9** | **Gating sections stripped** (`AutonomyFloor`, `PermissionClass`, `ToolInvocationFacts Describe(...)`, 42-3 references removed). Read/write capability splits, provider abstractions, secret binding, `TOOL.*` audit, never-throw, and Epic 41 consumer maps preserved. 42-8A's server-resolved environment rule re-expressed as server-sourced `AutonomyQuery.Target`. 42-8A/8B/9 carry the `ConfigJson` open question. |
| **42-8B (Scope 4 / AC7)** | **Deleted** (along with AC7-dependent risk text); safety preserved via `AlwaysHuman` prod/rollback defaults, absorbed `AlwaysEscalate` floor, `IActionAuthorizationLedger`, and OR'd business-mode predicate (43-9 AC11); `WaitForToolOperationActivity` unaffected (operation wait, not authorization wait). |
| **39-23** | **Superseded** by Epic 43 (banner on story file + `sprint-status.yaml`). |

### The four transplants (valuable analysis preserved with attribution)

1. **42-2's two-scoping resolution prose** → transplanted into `docs/stories/epic-43/story-43-5/43-5-storage-principal-resolution-resolver-audit.md` (single-user `user_id` vs SaaS `tenant_id` with no per-user override layer, extended with the platform-ceiling tier).
2. **42-3's Seam B siting analysis** → transplanted into `docs/stories/epic-43/story-43-9/43-9-seams-enforcement-and-authorization-ledger.md` (after `ToolCallValidator` rewrites `ArgumentsJson`, before the `EnableParallelTools` fork, outside `if (_toolCallValidator != null)`).
3. **42-3's effective-ceiling insight** → transplanted into `docs/stories/epic-43/story-43-9/43-9-seams-enforcement-and-authorization-ledger.md` (filtering advertisement on a tool's raw worst-case class would hide every Wave-3 write executor before invocation time).
4. **42-3's Api-side direct-`IEventRepository` finding** → preserved and credited in Story 43-5 / Story 43-9 D12 (`TammaEventEmitter` requires an `ActivityExecutionContext`; the tool loop runs inside a blocking HTTP request in `Tamma.Api`).

### What the reconciliation itself broke (known costs — both unresolved)

A decision record that lists only benefits is incomplete. This reconciliation introduced **two real
defects** that must be decided explicitly before the affected Epic 42 stories are implemented:

1. **Loss of `ConfigJson` — per-tenant tool configuration in SaaS is genuinely lost.** Deleting 42-2's
   `tool_bindings` table removed not only per-principal *policy* (absorbed by `action_assignments`) but
   also per-principal *configuration* (`ConfigJson`), because `action_assignments` is deliberately a
   governance table and not a settings store. Four stories lost their destination:
   - **42-9** (authenticated HTTP tool): destination / host allowlist and per-endpoint settings;
   - **42-8A** (feature-flag tool): environment map, `kill_switch` list, and `sensitive` key list;
   - **42-8B** (deploy-control tool): declared target map;
   - **42-4** (tool credential binding): per-principal `secret_binding_name` override.
   The four plans and story files record `IOptions` (deployment configuration) as an **interim**
   solution sufficient for single-user and single-tenant deployments, but `IOptions` is process-wide —
   two SaaS tenants cannot configure different deploy targets, flag environments, or HTTP allowlists.
   Restoring per-tenant tool configuration requires a product decision before Wave 3 ships: either a
   narrow `tool_configuration` table (config only, explicitly **not** a second governance store) or an
   explicit decision to ship deployment-scoped tool configuration in v1.

2. **The MCP catalog-binding fork — 42-6 Part B's prerequisite may be unimplementable as specified.**
   The reconciliation added a prerequisite to 42-6 Part B: every MCP tool entering the registry must
   resolve to an Epic 43 catalog entry (unclassified ⇒ rejected at registration). However, Epic 43's
   own README states under *Holes the mechanisms honestly cannot close*: *"MCP is one coarse member with
   no drift signal. Adding a server, or a tool on an existing server, changes nothing in the catalog."*
   Per-MCP-tool binding therefore forces an unresolved fork:
   - **(i) Coarse-member binding:** every `mcp__<server>__<tool>` binds to the single coarse
     `effect:mcp.tool.invoke` member (shipped `AlwaysHuman` in 43-5). That governs nothing finer than a
     blanket switch across all MCP servers and tools, making per-tool catalog binding ceremonial.
   - **(ii) Dynamically-minted catalog members:** MCP discovery mints catalog entries at runtime. That
     makes Epic 43's catalog **open** and breaks the closed-vocabulary premise the entire epic rests on
     (including Story 43-2's count pins and keyset-equality sweeps).
   **42-6 Part B is marked blocked on this fork**, which is entangled with Epic 42 Open Question 2
   (tenant-scoped MCP servers) and Epic 43 Open Question 1 — the same question from two directions.

## Consequences

- The reconciliation deletes two Epic 42 stories and rewrites/narrows the remaining stories, plus supersedes Story 39-23.
- Reconciling the three disagreeing tool vocabularies is a **privilege expansion, not a cleanup** —
  tools advertised under Claude-Code names currently cannot execute at all.
- Two holes stay open and are documented rather than hidden: `file_write`/`shell_execute` are
  undifferentiated members that bypass finer gates, and production deploy is an LLM tool loop rather
  than a typed activity, so gating it gates the stage transition and not the deploy.
- Two reconciliation-created gaps stay open and explicitly flagged: SaaS per-tenant tool configuration
  (`ConfigJson` loss across 42-4/42-8A/42-8B/42-9) and the MCP catalog-binding fork blocking 42-6 Part B.

## Related

- `docs/stories/epic-43/README.md`
- `docs/stories/epic-39/story-39-23/` (superseded)
- `docs/stories/epic-42/README.md` (reconciliation)
