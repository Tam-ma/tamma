# Story 42-8B: Deploy-Control Tool

Status: drafted

*Split from the former combined story 42-8 — see [the split index](./42-8-feature-flag-deploy-control-tools.md).*

## MANDATORY: Before You Code

**ALL contributors MUST read and follow the comprehensive development process:**

[BEFORE_YOU_CODE.md](../../../guides/BEFORE_YOU_CODE.md)

Then check the knowledge base: `.dev/spikes/`, `.dev/bugs/`, `.dev/findings/`, `.dev/decisions/`.

## User Story

As an **agent running a deploy, promotion, or incident workflow**, I want to **trigger, promote, roll
back, and check a release** through a governed tool — with prod-affecting operations authorized against
the concrete target by an actor and the deploy credential bound — so that a `deployment-pipeline`
promotion or a `41-22` rollback executes an *authorized* deploy instead of a shell script.

## Priority

P2 / Wave 3, after 42-9 and 42-8A. Shares its engine-side wait machinery with **42-7**; whichever lands
first ships it.

## Where this code lives (binding)

**Both executors, `IDeployControlProvider`, and every driver live in `Tamma.Api`** — package
`Tamma.Api.Services.Tools.Deploy`, registered next to the six built-ins at `Tamma.Api/Program.cs`
L753–766.

Reasons, in force order: (1) **rule 1** — a workflow step never calls an external API or holds an
external credential, and these do both; (2) **runtime** — `Tamma.ElsaServer/Program.cs` L286–292
records the tool catalog was *removed* from the engine and "the tool executors are registered there
[`Tamma.Api`], not here", so an engine-side executor is never resolved; (3) **guardrail backstop** —
`TAMMA001` (`DiagnosticSeverity.Error`, analyzer-referenced by `Tamma.Activities`/`Tamma.ElsaServer`)
denies credential-resolver injection on the engine surface and `Allowlist.IsEngineSurface` excludes
`Tamma.Api`. *Honest scope:* `TAMMA001`'s injection check is a closed denylist not naming
`IDeployControlProvider`, and its HTTP check fires only on a statically-literal external host — it is
the backstop, not the mechanical failure. Precedent: `GetAcceptanceRulesTool` in
`Tamma.Api.Services.AcceptanceRules`; `Allowlist.cs` L57–58 on `InlineToolLoopRunner`.

The **one** engine-side artefact is `WaitForToolOperationActivity` (below), which holds no credential
and makes no vendor call. Only the 42-1 contract types stay in `Tamma.Activities.LlmCall.Tools`.

## Scope

1. **Provider abstraction.** `IDeployControlProvider` — `GetStatusAsync` / `TriggerAsync` /
   `PromoteAsync` / `RollbackAsync` — with one reference driver aligned to the platform's own deploy
   path (Docker Compose on the Hetzner VPS, per CLAUDE.md) plus a generic seam, mirroring the Git/AI
   provider pattern.

2. **Operation granularity — DECIDED: split the family into read and write executors.**
   *Corrected: an earlier draft graded classes in prose and left the split to an AC that accepted either
   design. The split is mandatory and separately testable.* *(Per-call `PermissionClass` and
   `ToolInvocationFacts Describe(...)` were stripped under Epic 43 reconciliation — 42-3 is deleted and
   Epic 43's Seam B governs tools by catalog `ActionKey` with zero bespoke gating code here.)*

   | Operation | Executor | Capability boundary |
   |---|---|---|
   | `status` | `deploy_status` | Read-only — exposes only `status`; physically cannot reach mutating provider methods |
   | `trigger` / `promote` / `rollback` | `deploy_control` | Mutating / destructive — governed by Epic 43's Action Catalog at Seam B |

   - `deploy_status` exposes only `status` in its `InputSchema` and rejects any mutating operation
     before touching `IDeployControlProvider`. This structural capability boundary holds regardless of
     how any catalog policy row is configured.
   - Governance (risk tier, autonomy threshold, and enforcement) lives in Epic 43's Action Catalog
     (`ActionNamespace.Tool` and `effect:deploy.*`) rather than in bespoke tool code.

3. **Target is server-resolved, never asserted by the model.** The model picks a `targetKey` from a
   **closed, server-declared target map**; an undeclared or missing `targetKey` is **refused**
   (`Success = false`, zero provider calls), and any free-text `environment` field supplied by the model
   is ignored. *(Story 42-2 was superseded by Epic 43 and deleted; see "Configuration: open question"
   below for where the target map now lives.)*

   **How production-deploy safety is preserved (replaces former Scope 4 / AC7, deleted by Epic 43 Story
   43-10):** an earlier pre-reconciliation Scope 4 / AC7 required Epic 39's always-escalate class to
   bind *independently* of the autonomy dial and of 42-3's grant — which meant two gates, two audit ids,
   and two human decisions for a single production deploy. Both are deleted without losing any safety:
   - `effect:deploy.promote-prod` (`effect:deploy.prod` / `effect:deploy.rollback`) ships
     `AlwaysHuman`, and Epic 43 absorbs Epic 39's `AlwaysEscalate` list via `AcceptanceGuardrails.TryPreGate`
     as a monotone `max()` floor that no catalog row can lower (Epic 43 Story 43-5 / 43-9 AC16).
   - `IActionAuthorizationLedger` makes **one** human grant cover the correlation across seams (one
     gate, one audit id, one human decision).
   - The existing business-mode predicate in `DeploymentPipelineWorkflow` is **OR'd, never replaced**
     (Epic 43 Story 43-9 AC11), so business-mode production approval can never be weakened.
   - `WaitForToolOperationActivity` below is **unaffected**: it is an **operation** wait (waiting for
     the remote deploy job to finish), not an **authorization** wait.

4. **Secret binding.** `SecretRequirement(SecretPurpose.ApiKey | SecretPurpose.SigningKey,
   "deploy/<platform>", Required)` — `SecretPurpose` being the `Tamma.Core`-sited enum 42-1 §0
   relocates. Resolved by 42-4 to **`SecretRef.ForTenant(runTenantId, name)` in SaaS** and
   **`SecretRef.ForPlatform(name)` in single-user**. *Corrected: an earlier draft said "user-scoped in
   single-user" — there is no user scope; `SecretScope` has exactly `Platform` and `Tenant` and
   `SecretRef`'s constructor throws on either mismatch. The sole user's ownership is
   `SecretMetadata.OwnerUserId` metadata.* `runTenantId` comes from the run context only.

5. **Long deploys — the executor does NOT suspend; it returns a handle.**
   *Corrected: an earlier draft said "trigger the deploy, suspend the workflow". An `IToolExecutor`
   cannot suspend a workflow: the tool loop runs server-side inside a **blocking**
   `POST /api/v1/llm/call` in `Tamma.Api` (`CallLlmInlineActivity` is a thin client over
   `TammaApiClient`), where there is no `ActivityExecutionContext` and no bookmark to create. The old
   AC — "a long deploy suspends and resumes on completion" — was unverifiable against the executor.*

   The shape, mirroring the landed `WaitForCIResultsActivity`:
   - `deploy_control` **returns promptly** with `Success = true` and an `operationHandle`
     (`{ platform, deploymentId, targetKey, releaseRef }`); it holds no thread past the per-tool timeout.
   - `Suspends = true` on the descriptor is a **declaration that completion is owned by an engine-side
     wait**, not a capability the executor exercises. Read 42-1's `Suspends` that way.
   - The engine-side `WaitForToolOperationActivity` (`Tamma.Activities/ToolExecution/`, generic over
     `{ kind, operationId }`, **shared with 42-7**) suspends on
     `LifecycleBookmarks.ForToolOperation(tenantId, operationId)` with two armed resume paths exactly as
     `WaitForCIResultsActivity` does — the completion callback → `Completed`, and a durable
     scheduled-delay bookmark → `TimedOut` — so a deploy that never reports cannot hang the workflow. It
     must be registered in `LifecycleBookmarks.CanonicalSuspendActivities` or
     `ResumableStandardStructuralTests` rejects any `BookmarkSuspend` workflow that uses it.
   - Any polling of the deploy platform is a `Tamma.Api` concern (platform task / callback endpoint),
     never engine-side.

6. **Audit.** Every op emits 42-5 `TOOL.*` tagged `platform` / `operation` / `targetKey` / `releaseRef`
   / `deploymentId` / terminal `status`. Governance decisions and human approvals are audited separately
   by Epic 43's `ACTION.GATE.*` event family.

## Configuration: open question

- **What configuration this story needs:** the declared **target map** (mapping closed `targetKey`
  values to concrete deployment targets).
- **Why it has no store today:** Story 42-2 (`tool_bindings` / `ConfigJson`) was superseded by Epic 43
  and deleted. Epic 43's `action_assignments` absorbs policy only (thresholds and flags) — deliberately,
  because it is a governance table and not a settings store.
- **Interim resolution:** deployment configuration via `IOptions` (platform-scoped, validated fail-loud
  at startup), which is sufficient for single-user mode and for a single-tenant deployment.
- **Unresolved product gap (SaaS):** **per-tenant tool configuration in SaaS is genuinely lost and
  unresolved.** `IOptions` is process-wide, so two tenants cannot configure different deploy targets.
  Restoring per-tenant configuration requires an explicit product decision before this story is
  implemented: either introduce a narrow `tool_configuration` table (config only, no policy —
  explicitly *not* a second governance store) or accept that tool configuration is deployment-scoped in
  v1. `IOptions` is an interim workaround, **not** a closed answer.

## Acceptance Criteria

1. Two executors are registered declaring 42-1's abstract `ToolDescriptor`: `deploy_status`
   (`Suspends = false`) and `deploy_control` (`Suspends = true`), both with
   `SecretRequirement(ApiKey | SigningKey, "deploy/<platform>", Required)`.
2. `deploy_status` cannot mutate: its `InputSchema` enumerates only `status`, and an argument object
   naming `trigger`/`promote`/`rollback` returns `Success = false` with **zero** calls on a spy
   `IDeployControlProvider`.
3. **Containment.** `deploy_control` accepts only a `targetKey` declared in the closed server target
   map; an undeclared or missing `targetKey` returns `Success = false` with **zero** provider calls. A
   test supplies a free-text `"environment": "staging"` field alongside a `targetKey` mapped to prod and
   asserts the resolved target derives from the server map alone.
4. Provider abstraction holds: a stub `IDeployControlProvider` drives `trigger → status → rollback`
   with the reference driver **not registered**; the executors name no concrete platform type.
5. Credential scoping: SaaS resolves `SecretRef.ForTenant(runTenantId, name)`, single-user resolves
   `SecretRef.ForPlatform(name)`; constructing a `Tenant`-scoped ref with a null tenant id throws; a
   grep-for-value test asserts the credential appears in no `ToolExecutionResult.Output`, no `TOOL.*`
   payload, and no captured log line.
6. Long-op round trip: against a stub slow provider, `trigger` returns inside the per-tool timeout with
   `Success = true` and a non-empty `operationHandle`, and **no** suspend occurs inside
   `POST /api/v1/llm/call`. `WaitForToolOperationActivity` then (a) resumes to `Completed` on the
   callback, (b) resumes to `TimedOut` on its durable delay with no callback, and (c) resumes from the
   **persisted** bookmark after the workflow host is restarted mid-wait. A test asserts the activity
   type is present in `LifecycleBookmarks.CanonicalSuspendActivities`.
7. A driver that throws yields `Success = false` + `TOOL.FAILED`; the test asserts `ExecuteAsync`
   **returns** rather than propagating (never-throw contract).
8. Every op emits 42-5 `TOOL.INVOKED` + `TOOL.SUCCEEDED`/`TOOL.FAILED` carrying `platform` /
   `operation` / `targetKey` / `releaseRef` / `deploymentId` / terminal `status` tags (never the
   credential).

*(Former AC3 `Describe`, AC5 `ToolAuthorizationRequired`, AC6 42-3 target-bound auth, and AC7
independently-binding Epic 39 always-escalate gate were deleted under Epic 43 Story 43-10 — see §3
above for how production-deploy safety is preserved through Epic 43's `AlwaysHuman` floor,
`IActionAuthorizationLedger`, and OR'd business-mode predicate.)*

## Events

Reuses 42-5 `TOOL.INVOKED/SUCCEEDED/FAILED` with `platform` / `targetKey` / `releaseRef` /
`deploymentId` / `status` tags (governance decisions emit Epic 43's `ACTION.GATE.*`). The engine-side
wait activity emits its request/completion pair through `TammaEventEmitter` — it *is* an Elsa activity
with a context, the one place in this story where that emitter applies. No new family.

## Single-user vs SaaS

- **single-user:** the sole user's deploy credential as a **platform-scoped** secret
  (`SecretRef.ForPlatform`) owned via `SecretMetadata.OwnerUserId`; gating resolves against the user's
  Epic 43 `action_assignments` rows.
- **SaaS:** tenant-scoped credential (`SecretRef.ForTenant(runTenantId, …)`); gating resolves against
  the tenant's Epic 43 `action_assignments` rows and platform ceiling, and the operation bookmark is
  tenant-folded, so a cross-tenant resume cannot resolve another tenant's deploy. *(Per-tenant target
  maps are currently lost with 42-2's `ConfigJson` — see "Configuration: open question" above.)*

## Epic 41 consumers

`deployment-pipeline` (promotion + rollback for infra tasks via 41-29), **41-22** (incident rollback),
**41-24** (release-notes trigger keyed off a promote), 41-29 `infra` `TaskKind`.

## Dependencies

- **Product decision (blocking before implementation):** resolve the `ConfigJson` open question above
  (narrow `tool_configuration` table vs deployment-scoped `IOptions` in v1).
- **42-1** — `ToolDescriptor(RequiredSecret, Suspends)`; the `Tamma.Core`-sited `SecretPurpose` (§0).
- **Epic 43 (Action Catalog + Seam B + Seam E + Authorization Ledger)** — owns risk classification,
  `AlwaysHuman` prod-deploy/rollback floors, absorbed Epic 39 `AlwaysEscalate` precedence, one-grant
  correlation coverage, and OR'd business-mode preservation. *(42-2 and 42-3 were superseded by Epic 43
  and deleted; 42-3's siting analysis and effective-ceiling insight were transplanted into Epic 43
  Story 43-9.)*
- **42-4** — credential binding. *Corrected: an earlier draft called this "hard-blocked on the Epic 29
  reveal path". It is not — four runtime plaintext readers already ship and 42-4 generalizes them. The
  residual dependency is a non-null `ISecretAccessAuditor`; only `NullSecretAccessAuditor` is registered
  today.*
- **42-5** — `TOOL.*` audit.
- **42-7 (shared)** — `WaitForToolOperationActivity`, its bookmark prefix, its
  `CanonicalSuspendActivities` registration, and its authenticated callback endpoint. Land once,
  whichever story is first.
- **`Tamma.Activities` holds no external credential** and carries the `TAMMA001` analyzer; no
  credential-holding code from this story may be added to it.
- **Epic 41 / 41-29** consumers.

## Risks

- **Prod blast radius.** A wrongly-authorized prod deploy is the highest-impact action in the epic.
  Mitigation: `deploy_status` cannot mutate (AC2), closed server-declared target map containment (AC3),
  Epic 43's `AlwaysHuman` prod/rollback defaults + absorbed `AlwaysEscalate` floor + OR'd business-mode
  predicate (§3), and full `TOOL.*` + `ACTION.GATE.*` audit lineage (AC8).
- **Handle forgery.** The `operationHandle` crosses from the tool result into an engine-side bookmark
  name. It must be minted server-side and tenant-folded; a model-supplied handle must never select a
  bookmark. Pinned in the AC6 round trip.
- **Callback endpoint is external surface.** The completion callback that resumes the wait is a new
  seam and must be authenticated and tenant-scoped like `DocumentDecisionResumeEndpoint` (keyed
  tenant + operation), not deployment-id-only — otherwise anyone who learns a deployment id can resume
  a suspended workflow.

## Estimated Effort

Large. ~5–6 days standalone; **~4 days if 42-7 lands first** and
`WaitForToolOperationActivity` + bookmark + callback endpoint are already in place. Provider
abstraction + reference driver + read/write split + closed target-map containment + shared wait
machinery. The pair (42-8B + 42-7) pays for that machinery **once**.
