# Story 42-8A: Feature-Flag / Config-Toggle Tool

Status: drafted

*Split from the former combined story 42-8 — see [the split index](./42-8-feature-flag-deploy-control-tools.md).*

## MANDATORY: Before You Code

**ALL contributors MUST read and follow the comprehensive development process:**

[BEFORE_YOU_CODE.md](../../../guides/BEFORE_YOU_CODE.md)

Then check the knowledge base: `.dev/spikes/`, `.dev/bugs/`, `.dev/findings/`, `.dev/decisions/`.

## User Story

As an **agent running a deploy, promotion, or incident workflow**, I want to **read and flip feature
flags / runtime config** through a governed tool — with a **prod** flip authorized against the concrete
flag by an actor and the provider credential bound — so that a `deployment-pipeline` gradual rollout or
a `41-22` kill-switch is a first-class capability instead of a shell script.

## Priority

P2 / Wave 3. Ships after 42-9 and before 42-8B: it has **no engine-side work**, so it is not gated on
the wait-activity / bookmark / callback chain 42-8B and 42-7 share.

## The gap (READ FIRST)

There is **no feature-flag code anywhere in the C# backend** — `grep -rl "FeatureFlag\|feature_flag"`
over `apps/tamma-elsa/src` returns nothing. This is greenfield: interface, driver, and binding all new.
A kill-switch today means `ShellExecute` + whatever the flag vendor's CLI is, unbound and unaudited.

## Where this code lives (binding)

**Both executors, `IFeatureFlagProvider`, and every driver live in `Tamma.Api`** — package
`Tamma.Api.Services.Tools.FeatureFlags`, registered next to the six built-ins at
`Tamma.Api/Program.cs` L753–766. Nothing here is added to `Tamma.Activities`.

Reasons, in force order: (1) **rule 1** — a workflow step never calls an external API or holds an
external credential, and these do both; (2) **runtime** — `Tamma.ElsaServer/Program.cs` L286–292
records that the tool catalog was *removed* from the engine and "the tool executors are registered
there [`Tamma.Api`], not here", so an engine-side executor would never be resolved; (3) **guardrail
backstop** — `TAMMA001` (`DiagnosticSeverity.Error`, analyzer-referenced by `Tamma.Activities` /
`Tamma.ElsaServer`) denies credential-resolver injection on the engine surface, and
`Allowlist.IsEngineSurface` deliberately excludes `Tamma.Api`. *Honest scope:* `TAMMA001`'s injection
check is a closed denylist that does not name `IFeatureFlagProvider`, and its HTTP check only fires on
a statically-literal external host — it is the backstop, not the mechanical failure. Precedent for the
split: `GetAcceptanceRulesTool` (an `IToolExecutor` in `Tamma.Api.Services.AcceptanceRules`) and
`Allowlist.cs` L57–58 on `InlineToolLoopRunner`.

Only the 42-1 contract types (`IToolExecutor`, `ToolDescriptor`, `SecretRequirement`) stay in
`Tamma.Activities.LlmCall.Tools`; a `ToolDescriptor` never carries a `SecretRef` (42-4).

## Scope

1. **Provider abstraction.** `IFeatureFlagProvider` — `GetAsync` / `ListAsync` / `SetAsync` for a flag
   or a runtime-config key, plus one reference driver and a generic seam, mirroring the Git/AI provider
   pattern. The LLM sees one read tool and one write tool; the provider is chosen by config/binding.

2. **Operation granularity — DECIDED: split the family into read and write executors.**
   *Corrected: an earlier draft said "recommend a read/write split as in 42-7" and left the choice to
   the implementer via an AC that accepted either. The split is mandatory and separately testable.*
   *(Per-call `PermissionClass` and `ToolInvocationFacts Describe(...)` were stripped under Epic 43
   reconciliation — 42-3 is deleted and Epic 43's Seam B governs tools by catalog `ActionKey` with zero
   bespoke gating code here.)*

   | Operation | Executor | Capability boundary |
   |---|---|---|
   | `get` / `list` | `feature_flag_read` | Read-only — exposes only `get`/`list` in `InputSchema`; physically cannot reach `SetAsync` |
   | `set` | `feature_flag_write` | Mutating — governed by Epic 43's Action Catalog at Seam B |

   - `feature_flag_read` exposes only `get`/`list` in its `InputSchema` and rejects any `set` attempt
     before touching `IFeatureFlagProvider`. This structural boundary holds regardless of how any
     catalog policy row is configured.
   - Governance (risk tier, autonomy threshold, and enforcement) lives in Epic 43's Action Catalog
     (`ActionNamespace.Tool`) and is enforced at Seam B.

3. **Environment is server-resolved, never asserted by the model.** The model selects an
   `environmentKey` from a **closed, server-declared set**; an undeclared or missing `environmentKey` is
   **refused** (`Success = false`, zero provider calls), and any free-text `environment` field supplied
   by the model is ignored. The pre-reconciliation security rule ("prod-vs-non-prod class resolved from
   the binding, never asserted by the model") **survives**, re-expressed as a **server-sourced
   `AutonomyQuery.Target`** (`<resolvedEnvironment>:<flagKey>`, audit input only — never a policy key,
   per Epic 43 Story 43-9 AC1). *(Story 42-2 was superseded by Epic 43 and deleted; see "Configuration:
   open question" below for where the environment map, `kill_switch` list, and `sensitive` key list now
   live.)*

4. **Secret binding.** `SecretRequirement(SecretPurpose.ApiKey, "flags/<provider>", Required)` —
   `SecretPurpose` being the `Tamma.Core`-sited enum 42-1 §0 relocates. Resolved by 42-4 to
   **`SecretRef.ForTenant(runTenantId, name)` in SaaS** and **`SecretRef.ForPlatform(name)` in
   single-user**. *Corrected: an earlier draft said "user-scoped in single-user" — there is no user
   scope. `SecretScope` has exactly `Platform` and `Tenant`, `SecretRef`'s constructor throws on either
   mismatch, and the sole user's ownership is `SecretMetadata.OwnerUserId` metadata.* `runTenantId`
   comes from the run context, never from tool config, arguments, or the model.

5. **No suspend.** `Suspends = false`. A flag flip is synchronous at every provider worth supporting; if
   a future driver is async it adopts 42-8B/42-7's `WaitForToolOperationActivity` rather than pretending
   the executor can suspend. *Corrected: the combined draft carried `Suspends = true` for "long deploys"
   — that belonged to the deploy half only.*

6. **Audit.** Every op emits 42-5 `TOOL.*` tagged `provider` / `flagKey` / `environment` / `operation`
   and, for a `set`, the **previous and new value** (both redacted through the same envelope) so a
   rollout is reconstructible. Never the credential. Governance decisions are audited separately by
   Epic 43's `ACTION.GATE.*` family.

## Configuration: open question

- **What configuration this story needs:** the declared **environment map** (mapping closed
  `environmentKey` values to prod/non-prod environments), plus the `kill_switch` and `sensitive` flag
  key lists.
- **Why it has no store today:** Story 42-2 (`tool_bindings` / `ConfigJson`) was superseded by Epic 43
  and deleted. Epic 43's `action_assignments` absorbs policy only (thresholds and flags) — deliberately,
  because it is a governance table and not a settings store.
- **Interim resolution:** deployment configuration via `IOptions` (platform-scoped, validated fail-loud
  at startup), which is sufficient for single-user mode and for a single-tenant deployment.
- **Unresolved product gap (SaaS):** **per-tenant tool configuration in SaaS is genuinely lost and
  unresolved.** `IOptions` is process-wide, so two tenants cannot configure different flag environments
  or `sensitive` key lists. Restoring per-tenant configuration requires an explicit product decision
  before this story is implemented: either introduce a narrow `tool_configuration` table (config only,
  no policy — explicitly *not* a second governance store) or accept that tool configuration is
  deployment-scoped in v1. `IOptions` is an interim workaround, **not** a closed answer.

## Acceptance Criteria

1. Two executors are registered declaring 42-1's abstract `ToolDescriptor`: `feature_flag_read`
   (`Suspends = false`) and `feature_flag_write` (`Suspends = false`), both with
   `SecretRequirement(ApiKey, "flags/<provider>", Required)`.
2. `feature_flag_read` cannot mutate: its `InputSchema` enumerates only `get`/`list`, and an argument
   object naming `set` returns `Success = false` with **zero** calls on a spy `IFeatureFlagProvider`.
3. **Containment and server-sourced target.** `feature_flag_write` accepts only an `environmentKey`
   declared in the closed server configuration; a missing, unknown, or undeclared `environmentKey`
   returns `Success = false` with **zero** provider calls. A test supplies a free-text
   `"environment": "staging"` alongside an `environmentKey` mapped to production and asserts the
   resolved environment and server-sourced `AutonomyQuery.Target` (`<resolvedEnvironment>:<flagKey>`)
   derive from the server mapping alone (the free-text field is never read).
4. Provider abstraction holds: a stub `IFeatureFlagProvider` drives `get → set → get` with the
   reference driver **not registered**, and the executors name no concrete vendor type.
5. Credential scoping: SaaS resolves `SecretRef.ForTenant(runTenantId, name)`, single-user resolves
   `SecretRef.ForPlatform(name)`; constructing a `Tenant`-scoped ref with a null tenant id throws; a
   grep-for-value test asserts the credential appears in no `ToolExecutionResult.Output`, no `TOOL.*`
   payload, and no captured log line.
6. A driver that throws yields `Success = false` + `TOOL.FAILED`; the test asserts `ExecuteAsync`
   **returns** rather than propagating (never-throw contract).
7. A `set`'s `TOOL.*` row carries `provider` / `flagKey` / `environment` / `operation` and the
   previous/new value pair in every case (with wholesale replacement for values over the length cap or
   matching the configured `sensitive` key list).

## Events

Reuses 42-5 `TOOL.INVOKED/SUCCEEDED/FAILED` with `flagKey` / `environment` / `operation` tags
(governance decisions emit Epic 43's `ACTION.GATE.*`). No new family, and no engine-side emission —
everything here runs in `Tamma.Api`, which appends directly to `IEventRepository`.

## Single-user vs SaaS

- **single-user:** the sole user's flag credential as a **platform-scoped** secret
  (`SecretRef.ForPlatform`) owned via `SecretMetadata.OwnerUserId`; gating resolves against the user's
  Epic 43 `action_assignments` rows.
- **SaaS:** tenant-scoped credential (`SecretRef.ForTenant(runTenantId, …)`); gating resolves against
  the tenant's Epic 43 `action_assignments` rows and platform ceiling. *(Per-tenant environment maps
  are currently lost with 42-2's `ConfigJson` — see "Configuration: open question" above.)*

## Epic 41 consumers

`deployment-pipeline` (gradual rollout during promotion), **41-22** (incident kill-switch), 41-29
`infra` `TaskKind`.

## Dependencies

- **Product decision (blocking before implementation):** resolve the `ConfigJson` open question above
  (narrow `tool_configuration` table vs deployment-scoped `IOptions` in v1).
- **42-1** — `ToolDescriptor(RequiredSecret, Suspends)`; the `Tamma.Core`-sited `SecretPurpose` (§0).
- **Epic 43 (Action Catalog + Seam B)** — owns risk classification, autonomy thresholds, per-principal
  assignments, and enforcement for `feature_flag_read` / `feature_flag_write`. *(42-2 and 42-3 were
  superseded by Epic 43 and deleted; 42-3's siting analysis and effective-ceiling insight were
  transplanted into Epic 43 Story 43-9.)*
- **42-4** — credential binding. *Corrected: an earlier draft called this "hard-blocked on the Epic 29
  reveal path". It is not — four runtime plaintext readers already ship and 42-4 generalizes them. The
  residual dependency is a non-null `ISecretAccessAuditor`; only `NullSecretAccessAuditor` is
  registered today.*
- **42-5** — `TOOL.*` audit.
- **`Tamma.Activities` holds no external credential** and carries the `TAMMA001` analyzer; no code from
  this story is added to it. This story adds **nothing** engine-side.
- **Epic 41 / 41-29** consumers.

## Risks

- **Environment mislabelling.** A flag whose configuration maps it to the wrong environment escapes
  operator intent. Mitigation: undeclared/missing keys are refused before any provider call (§3, AC3),
  and the environment map is server-configured, never model-supplied.
- **Flag values can carry secrets.** A config-toggle provider stores arbitrary strings; the
  previous/new value pair in AC7 can therefore contain a credential. It must ride the 42-4/42-5
  redaction envelope, and note honestly that `ToolOutputHelper.RedactSecrets` is **pattern-based**
  (`sk-`, `AKIA`, `gh?_`, `glpat-`, `xox?-`, JWT, PEM, `Password=`) — an arbitrary value is not matched.
  Values above a configured length, or on the configured `sensitive` key list, must be replaced
  wholesale rather than pattern-scrubbed.

## Estimated Effort

Medium. ~4 days — one provider abstraction + reference driver, the read/write split, closed
environment-map containment, and the redaction/audit test matrix. No engine-side work.
