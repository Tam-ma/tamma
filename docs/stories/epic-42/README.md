# Epic 42: Agent Capability & Tool Layer — a first-class, extensible, secured, autonomy-gated tool catalog

## Overview

Tamma's workflows produce typed **documents** (Epic 39) and dispatch them by kind (Epic 41), and an
agent can *act* through the tool-execution framework in `Tamma.Activities/LlmCall/Tools/`. But that
framework is **coding-only**. `Tamma.Api/Program.cs` (L753–764) registers exactly **six**
`IToolExecutor`s — `FileReadTool`, `FileWriteTool`, `GitOperationsTool`, `RunTestsTool`,
`SearchCodeTool`, `ShellExecuteTool`. So an agent can edit the repo, run git, run tests, and run a
shell — but has **no first-class tool** to reach a cloud/VPS resource, flip a feature flag, drive a
deploy, or call an external API. Worse, the catalog is closed:

- **The registry is compile-time static.** `ToolExecutorRegistry` is populated once from
  `IEnumerable<IToolExecutor>` injected by DI into a plain `Dictionary`. `IToolExecutorRegistry`
  declares exactly four members — `GetExecutor` / `IsAllowed` / `GetAll` / `GetAllowed`; there is **no
  `Register`/`Unregister`**, so no dynamic / per-deployment / per-tenant registration, and **no MCP
  ingestion path into the governed catalog**.
- **A tool declares no governance.** `IToolExecutor` exposes `ToolName`, `Description`, `InputSchema`,
  `ExecuteAsync` — and nothing about **who may call it**, **at what autonomy level**, **what credential
  it needs**, or **how destructive it is**. `ToolCallValidator` + `ActionGate` block dangerous *shell
  strings*, but that is a per-command denylist, not a per-tool permission model.
- **No credential binding.** No tool binds to a stored secret. `ShellExecuteTool` has been silently
  standing in for a real capability layer — an agent that needs to deploy shells out, unbound and
  ungoverned.
- **No durable tool-use audit.** `ToolLoopEventEmitter` emits ephemeral `TOOL_LOOP.*` SSE progress
  events to `IToolLoopEventSink`; nothing writes a **durable DCB `TOOL.*` row** the way documents get a
  `DOCUMENT.*` trail.

None of this is planned. There is no epic or story for a tool/capability layer.

### What already exists (corrections to earlier drafts of this section)

An earlier draft of this overview described the surrounding platform as more barren than it is. Four
things **do** ship today and change how the stories are scoped:

- **Corrected — MCP is not greenfield; it is *ungoverned*.** Eight live routes exist at
  `/api/kb/mcp/*` (`Tamma.Api/Program.cs` L3180–3187 → `KbEndpoints.cs` L115–161), including
  `POST /api/kb/mcp/tools/invoke`, proxying to the TS `intelligence-server` sidecar. They bypass
  `IToolExecutor`, `ToolExecutorRegistry`, `ToolCallValidator` and any audit entirely. They are gated
  by `SettingsView` (group) **+** `SettingsManage` (per-route), and in the dev-without-JWT branch
  every named policy is replaced by `AllowAnonymousRequirement`. They currently **dead-end**: the
  sidecar's `McpManagementService` is constructed with an undefined client on every production boot
  (`buildIntelligenceBundleFromEnv` never sets `mcpClient`; `@tamma/mcp-client` is not a dependency of
  `@tamma/intelligence-server`), so invoke returns `{success:false, error:'MCP client not
  configured'}`. Separately, `packages/mcp-client/` is a **9,662-LOC hand-rolled TS MCP client**
  (stdio/SSE/WebSocket transports, tool/resource/prompt registries, validator + rate-limiter +
  sandbox, audit, connection pool, `SERVER_PRESETS`) with **zero dependents**, never built. **This
  makes 42-6 urgent, not deferrable** — reconciling a route that dead-ends is cheap now and expensive
  the moment someone wires a client into the sidecar bundle. (`packages/providers/src/zen-mcp-provider.ts`
  is *not* in scope: it is an `IAIProvider` that uses MCP as transport to reach an LLM, not a tool bridge.)
- **Corrected — runtime secret reveal exists.** Four runtime plaintext readers already ship around
  `ISecretStore`'s no-plaintext boundary: `SecretStorePlatformCredentialReader.ReadActivePlaintextAsync(scope, tenantId?, name)`
  (both scopes, audited via `ISecretAccessAuditor` on every branch), `CabinetTenantProviderKeyReader.TryReadAsync(tenantId, name)`,
  `RuntimeSecretResolver.GetAsync(cabinetName)` (platform-only, 60s cache + `Invalidate` + fail-closed,
  **unaudited**), and `IAlertChannelSecretReader.GetPlaintextAsync(secretId)`. `IProviderCredentialResolver` /
  `DefaultProviderCredentialResolver` is a full working BYOK→platform precedence resolver. So 42-4 is a
  **generalization of a proven pattern**, not a blocked mega-dependency. See Dependencies for the two
  gaps that *are* real.
- **Corrected — `ResolveToolsActivity` is dead code.** It is referenced nowhere outside its own file
  across `src/`, `tests/` and `workflows/`. It injects only `ILogger` + `IConfiguration` (never the
  registry), and its built-in fallback switch has three arms — `search_code`, `read_file`, `run_tests` —
  where `read_file` does not match any registered tool (`FileReadTool.ToolName == "file_read"`). The
  live path is `ManagedAgent.ToResolvedTools` → `InlineToolLoopRunner`. Nothing in this epic may be
  built on `ResolveToolsActivity`.
- **A seventh `IToolExecutor` implementation exists.** `GetAcceptanceRulesTool` (`get_acceptance_rules`,
  Story 39-5 D6) is **principal-bound at construction and deliberately not DI-registered**, so
  "registers exactly six" above is precise as written. 42-1 gives it an explicit `ToolDescriptor`
  (`RequiredSecret = null, Suspends = false`), enforced by the compiler because `Descriptor` is a plain
  abstract interface member, while preserving its D6 non-DI-registered invariant (Epic 43 Story 43-4's
  startup validator gives it a permanent allowlist entry rather than registering it as a singleton).

**This epic makes the tool layer first-class: extensible (native + dynamic + MCP), secured
(secret-bound, redacted), and governed through Epic 43 (The Action Catalog).** It *extends* the real
`IToolExecutor` / `IToolExecutorRegistry` / `InlineToolLoopRunner` / `ParallelToolExecutor` /
`ToolCallValidator` surface. It does **not** design a parallel framework, and it does **not** reinvent
governance (Epic 43), the accept gate (Epic 39), or the secret store (Epic 29) — it composes them.

## The gap this epic fills — and how it underpins Epic 41

Epic 41 turns every recurring SDLC activity into a lifecycle workflow, and **41-29** (the Task-Level
Flow Router) dispatches each `PlanTask` to the workflow matching its `TaskKind`
(`code`/`test`/`docs`/`infra`/`design`/`investigation`/`chore`). But the workflow it dispatches has an
agent, and **that agent has no tool to do non-code work**:

- A `docs` task routed to `41-24`/`41-25`/`41-26` needs a **publish** capability (push to the wiki /
  docs host / issue tracker) — there is none.
- An `infra` task needs **deploy-control** and **cloud/VPS** tools — there are none; today it can only
  shell out. *(Corrected: 41-29 routes `infra` to the **coding path**, not to `deployment-pipeline` —
  that pipeline requires a merged commit sha and runs post-merge, so it cannot be dispatched from the
  pre-merge per-task loop. The tool need is unchanged: the agent making the infra change still has no
  governed way to touch a cloud resource or a deploy control.)*
- `41-22` (incident response & postmortem, incl. `rollback`) and `41-23` (capacity & health review)
  need **cloud/VPS** ops and a **feature-flag kill-switch** — there are none.
- `41-5` (stakeholder update) and `41-7` (standup digest) need an **authenticated HTTP** tool to post
  the artifact to Slack/Jira/etc. — there is none.

So Epic 42 is the **missing foundation under Epic 41**: 41-29 can *route* to a `docs`/`infra`/`design`
workflow, but until this epic lands, that workflow's agent falls back to `ShellExecute` or to the
human-assigned path (41 rule 4). This epic lights up the *agent* path of the non-code kinds by giving
each the governed tool it needs — with **no change to the router** (41-29's `kind→workflow` map is
untouched; this epic populates the tools those workflows resolve).

## The tool contract (what a tool declares) — extending the real `IToolExecutor`

*(Reconciled against Epic 43 — see the verdict box under Stories below.)* Today `IToolExecutor` is
`{ ToolName, Description, InputSchema, ExecuteAsync }` and *must never throw* (errors are
`ToolExecutionResult { Success = false }`). Story **42-1** keeps all four members and the never-throw
contract, and adds a **plain abstract** `ToolDescriptor Descriptor { get; }` member carrying capability
metadata only (governance — risk class, autonomy thresholds, per-principal overrides, and enforcement —
is owned by **Epic 43**, not by `ToolDescriptor`):

| Field (new) | Type | Meaning |
|---|---|---|
| `RequiredSecret` | `SecretRequirement?` | Declares the credential this tool needs — `{ Purpose, logical Name, Required }`. `Purpose` is Epic 29's `SecretPurpose` **after 42-1 §0 relocates it to `Tamma.Core`** — it ships today in `Tamma.Api.Services.Secrets`, which the contract's assembly cannot reach. `null` for tools that touch nothing external. |
| `Suspends` | `bool` | **Declares that completion is owned by an engine-side wait** — not a capability the executor exercises. *Corrected: an `IToolExecutor` cannot suspend a workflow.* The tool loop runs inside a **blocking** `POST /api/v1/llm/call` in `Tamma.Api`, where there is no `ActivityExecutionContext` and no bookmark to create. So the executor returns promptly with an `operationHandle`, and `WaitForToolOperationActivity` (engine-side, credential-free) suspends on it and resumes on the callback or a durable timeout (42-7 §4 / 42-8B §5). |

*Dropped by Epic 43 reconciliation (Story 43-10):* `Category` (the registry's registration path decides
built-in vs dynamic), `PermissionClass` (now `Tamma.Core/Actions/ActionRisk`), and `AutonomyFloor` (now
`ActionDescriptor.DefaultMinAutonomy` + `action_assignments.min_autonomy`). With those three fields
gone, the default-interface-member fail-safe had nothing left to fail safe to, so `Descriptor` is a
**plain abstract interface member** enforced by the compiler.

The four existing members are unchanged; all six DI-registered built-ins and `GetAcceptanceRulesTool`
declare `new ToolDescriptor(RequiredSecret: null, Suspends: false)` (per-tool governance lives in
Epic 43's Action Catalog). `IToolExecutorRegistry` gains a **dynamic registration** seam
(`Register(IToolExecutor)` / `Unregister(name)` alongside today's DI-seeded set) so tools can be added
per deployment and by MCP — the *vocabulary of governance is static; the catalog is dynamic*,
mirroring Epic 39's "vocabulary static, composition dynamic". **Scope caveat:** the registry is a
**singleton**, so 42-1 ships this seam **platform/deployment-scoped only** and rejects a
principal-scoped registration outright (42-1 AC4); per-tenant tools wait for 42-6 Part B's
per-principal registry *view*, since registering one principal's tool into the singleton leaks it to
every other principal.

### Where the code lives (assembly-siting rule — binding on 42-4 / 42-6 / 42-7 / 42-8A / 42-8B / 42-9)

Dependency direction is one-way: **`Tamma.Core` ← `Tamma.Activities` ← `Tamma.Api`.** `Tamma.Core`
is a leaf (no `ProjectReference` at all); `Tamma.Activities` references only `Tamma.Core` +
`Tamma.Data`; `Tamma.Api` references `Tamma.Activities`. A `Tamma.Activities → Tamma.Api` reference
is **circular and will not compile**.

| Lives in | What |
|---|---|
| `Tamma.Core` | Shared value types the contract needs on both sides — including **Epic 29's `SecretPurpose`, which 42-1 §0 *moves* here** (it ships in `Tamma.Api.Services.Secrets`, which `Tamma.Activities` cannot reach). *Move, not mirror:* 42-1 §0 rejects a parallel Core-owned enum mapped onto Epic 29's, because two taxonomies drift and the mapping table is exactly what the descriptor exists to remove. The move is data-safe — `SecretRow.Purpose` is a `string` column, so no schema or data change. |
| `Tamma.Activities.LlmCall.Tools` | The **contract only**: `IToolExecutor`, `ToolDescriptor`, `SecretRequirement`, `IToolExecutorRegistry` / `ToolExecutorRegistry`. |
| `Tamma.Api` | **Every external-touching executor and its provider drivers**: `CloudResourceTool`/`ICloudResourceProvider` (42-7), `FeatureFlagTool`/`IFeatureFlagProvider` + `DeployControlTool`/`IDeployControlProvider` (42-8A/42-8B), `HttpRequestTool` (42-9), `McpToolExecutor` + the MCP client (42-6), the `IToolSecretProvider` implementation (42-4), and the `TOOL.*` invocation emitter (42-5) — `ManagedAgent` / `InlineToolLoopRunner` are Api-side. (Tool governance itself lives in Epic 43's Seam B, also Api-side.) |
| `Tamma.Activities` (engine side) — **carve-out** | The **operation wait activity only**, because an `IToolExecutor` cannot suspend a workflow (no `ActivityExecutionContext` inside the blocking `POST /api/v1/llm/call`): `WaitForToolOperationActivity` (42-7 / 42-8B, landed once and shared). It is **credential-free and makes no vendor call** — it resumes on a callback; any polling of a vendor is an Api-side concern. This is the *only* engine-side code the epic adds. |

This follows **rule 1** ("a workflow step must never call an external API/provider directly or hold an
external credential"), whose permanent backstop is the **`TAMMA001`** analyzer
(`Tamma.Activities.Guardrails`, `DiagnosticSeverity.Error`, wired into `Tamma.Activities` and
`Tamma.ElsaServer` as an `OutputItemType="Analyzer"` project reference — and `Error` is the only
gating severity because the repo sets `TreatWarningsAsErrors=false`). `Allowlist.IsEngineSurface`
covers `Tamma.Activities` / `Tamma.ElsaServer`; `Tamma.Api` is deliberately excluded.

Two honest caveats so nobody over-reads the analyzer: (1) `TAMMA001` is narrower than "no external
HTTP" — its injection check is a **closed 12-entry denylist** (which today contains
`IProviderCredentialResolver` but none of the types above), and its HTTP check only fires on an
`HttpClient` send whose host is a **statically-resolvable literal external host**; ~20 files in
`Tamma.Activities` already use `HttpClient` under it and compile. So the rule here is architectural
intent with the analyzer as backstop, not a mechanical compile failure. (2) It is nonetheless
**forced** on runtime grounds: `Tamma.ElsaServer/Program.cs` L286–292 records that the tool catalog
was *removed* from the engine and "the tool executors are registered there [`Tamma.Api`], not here" —
impl-in-Api is where the DI wiring already lives. Existing precedent for interface-in-Activities /
impl-in-Api: `GetAcceptanceRulesTool` (`Tamma.Api.Services.AcceptanceRules`) and
`InlineToolLoopRunner`, which `Allowlist.cs` L57–58 explicitly notes "now lives in the `Tamma.Api`
assembly, outside the analyzed engine surface, so no engine exemption is needed."

## Permission + autonomy + secret model (single-user **and** SaaS)

*(Reconciled against Epic 43 — Stories 42-2 and 42-3 were superseded and deleted; see the verdict box
under Stories below.)*

**Governance storage and two-scoping resolution live in Epic 43 Story 43-5** (`action_assignments` and
`action_authorizations`, control-plane resident in both modes, with three scopes: user-only,
tenant-only, and platform ceiling). Story 42-2's `tool_bindings` table was deleted; its two-scoping
resolution prose is transplanted into `docs/stories/epic-43/story-43-5/`:

- **single-user mode** — the sole user owns assignments (`user_id`-scoped) resolved via
  `IGovernancePrincipalResolver` / `ISoleUserProvider`: `max(platformCeiling, legacyAlwaysEscalate,
  user action → user group → shipped default)`.
- **SaaS mode** — `tenant_owner` / `tenant_admin` owns the tenant's assignments (`tenant_id`-scoped;
  `member` users get 403 on write, no per-user override layer), bounded above by platform ceilings:
  `max(platformCeiling, legacyAlwaysEscalate, tenant action → tenant group → shipped default)`.

**Tool-call enforcement lives in Epic 43 Story 43-9 (Seam B), not in a separate Epic 42 gate.**
Story 42-3 was deleted; its siting analysis and effective-ceiling insight (filtering advertisement on a
raw max class would have made every Wave-3 write tool unreachable) are transplanted into
`docs/stories/epic-43/story-43-9/`:

- **Seam B (`InlineToolLoopRunner`)** sits at one shared call site **after** `ToolCallValidator`
  sanitizes `ArgumentsJson` and **before** the `EnableParallelTools` fork (covering both the default
  sequential branch and the parallel branch), additive over the existing fail-open allowlists.
- Denied calls are expressed through `rejectedToolCalls` (returned to the model as a tool result with
  outcome `Denied`, never `RequiresHuman` because no human wait sits inside the blocking LLM HTTP
  request) and audited under Epic 43's single **`ACTION.GATE.*`** event family.
- **Human waits and correlation-scoped grants** live in **Epic 43 Seam E + `IActionAuthorizationLedger`**
  (reusing existing Elsa approval waits and resume endpoints, with `DeploymentPipelineWorkflow`'s
  business-mode predicate OR'd rather than replaced).
- **The autonomy dial** (`AutonomyDial` in Epic 43 Story 43-1, single constant) is read live by
  Epic 43's `AutonomyGateService` via `IAcceptanceRulesResolver.ResolveBase*Async` (Story 43-5) — both
  as prompt context and as the hard gate threshold decided by the product owner on 2026-07-24.

**Credentials (Story 42-4)** bind through Epic 29's `ISecretStore` — `SecretScope.Tenant` in SaaS
(keyed by the tenant `Guid`), `SecretScope.Platform` in single-user. *Corrected:* there is **no user
scope** — `SecretScope` has exactly `Platform` and `Tenant`, and `SecretRef`'s constructor throws on
either mismatch; single-user ownership is carried by `SecretMetadata.OwnerUserId`, metadata not scope.
Secrets are **never** in tool args logged, in `ToolExecutionResult.Output`, in DCB `TOOL.*` events, or
in error messages (reuse `ErrorRedactor`). *Corrected:* `ISecretStore` performs **no authorization** —
it injects no caller identity and audits with actor `Guid.Empty`, so it resolves whatever `SecretRef`
the caller hands it. Cross-tenant isolation is **42-4's** obligation: pin the run's `tenantId` into the
ref, and assert the resolver never *constructs* another tenant's ref (not that the store rejects one).

*Corrected — this is no longer the epic's biggest external dependency.* `ISecretStore` exists (29-1;
CLAUDE.md's "does not yet exist" note is stale) and by design never returns plaintext through a public
signature — but **four runtime plaintext readers already ship around that boundary** (see "What already
exists"), so 42-4's `IToolSecretProvider` is a **Medium generalization of an existing seam**, modelled
on `IProviderCredentialResolver`/`DefaultProviderCredentialResolver` (BYOK→platform precedence, 60s
cache, `ToTag()` log projection, fail-closed `TammaError`) and backed by
`SecretStorePlatformCredentialReader`'s audited read. Two *real* gaps replace the phantom one:
`ISecretAccessAuditor`'s only implementation is `NullSecretAccessAuditor` (registered by
`TryAddSingleton` under "Audit pipe — null until a future story wires the real one"), so every audit
emission is dropped today; and `IProviderCredentialResolver` is on the `TAMMA001` injection denylist,
so no engine-surface tool may inject it — which is exactly why the executor lives in `Tamma.Api`.

## Tool families (the concrete capabilities the platform needs)

All five families ship their executor and provider drivers in **`Tamma.Api`** (see "Where the code
lives"). Each family declares only its capability metadata (`RequiredSecret`, `Suspends`) via 42-1's
`ToolDescriptor`, binds secrets through 42-4, and emits invocation audit through 42-5; risk tiers
(`ActionRisk`), autonomy thresholds, and enforcement live in **Epic 43's Action Catalog** and **Seam B**
with zero bespoke gating code inside any family.

| Family (story) | What it does | Catalog risk profile (`ActionRisk` in Epic 43) | Secret purpose † | Epic 41 consumers |
|---|---|---|---|---|
| **Cloud / VPS resource ops** (42-7) — provider-abstracted (Hetzner / generic), like the Git & AI provider abstractions | list / create / resize / delete VPS & cloud resources (`cloud_resource_read` / `cloud_resource_write`) | `ReadOnly` (read executor) · `Destructive` (write executor) | `ApiKey` (cloud-provider token) | **41-29 `infra` tasks** (coding path) · `deployment-pipeline` · **41-22** incident/rollback · **41-23** capacity & health |
| **Feature-flag / config toggle** (42-8A) | read & flip feature flags / runtime config (`feature_flag_read` / `feature_flag_write`) | `ReadOnly` (read executor) · `Destructive` (write executor) | `ApiKey` (flag provider) | `deployment-pipeline` promotion · **41-22** kill-switch · 41-29 `infra` kind (coding path) |
| **Deploy control** (42-8B) | trigger / promote / rollback / status a release (`deploy_status` / `deploy_control`) | `ReadOnly` (status) · `Destructive` (control; prod/rollback `AlwaysHuman` in Epic 43) | `ApiKey` or `SigningKey` (deploy platform) | `deployment-pipeline` · **41-22** rollback · **41-24** release notes trigger |
| **Authenticated HTTP / external API** (42-9) — generic, host+method allowlisted, server-configured endpoints | one authenticated REST call to a configured endpoint | `Mutating` / `Destructive` (governed by Epic 43 catalog) | `ApiKey` (per-endpoint) | **41-5** stakeholder update · **41-7** standup publish · **41-24/25/26** docs publish · any integration |
| **MCP-exposed tools** (42-6) | whatever an external MCP server exposes; **also** reconciles the 8 ungoverned `/api/kb/mcp/*` routes — **retire 2, re-scope 6** (Part A) | **blocked on MCP catalog-binding fork** (Part B §2; `effect:mcp.tool.invoke` ships `AlwaysHuman`) | per bound server | open-ended — any future kind |

† *Corrected:* Epic 29's `SecretPurpose` enum ships in `Tamma.Api.Services.Secrets` and is **not
reachable from `Tamma.Activities`** (which references only `Tamma.Core` + `Tamma.Data`; the reverse
reference is circular). **42-1 §0 relocates the enum itself to `Tamma.Core.Enums`** — same seven
members, same order, no schema change — so the column above names the *actual* type
`SecretRequirement.Purpose` carries after Wave 0, not a mirrored one the API side maps.

Each family declares its `RequiredSecret` and `Suspends` on `ToolDescriptor`, registers into
`ToolExecutorRegistry`, and is governed by Epic 43's Action Catalog + Seam B with **zero bespoke
security code** — a new tool is a descriptor + an executor + a catalog entry, not a new gate. One
naming constraint binds MCP specifically: `ToolCallValidator` rejects any tool name not matching
`^[a-zA-Z0-9_\-]{1,64}$` — no colon, 64 chars total. **Decided (42-6 Part B §1):
`mcp__<server>__<tool>`**, so `server + tool ≤ 57` chars; an overflowing or case-insensitively
colliding name is rejected **at registration**, never truncated. That registration-time check is
load-bearing (42-2 was deleted and Epic 43's `ActionKey` carries no separate 64-char DB cap).

## Stories

> ## ⚠️ RECONCILED AGAINST EPIC 43 (2026-07-25) — read before implementing any story below
>
> **Epic 43 (The Action Catalog) is the single source of truth for gating.** Epic 42 consumes it.
> Epic 42 was, structurally, a second action catalog: a duplicate autonomy-floor field, a duplicate
> per-principal override store, a duplicate admin surface and permission, a second gate on the same
> code path with no stated ordering, a second denial-audit schema, and a second escalation machinery.
> Twelve concrete duplications in all. **None of Epic 42 exists in code**, so this is a spec
> reconciliation, not a migration.
>
> The verdict box below is retained as the audit trail of *why*; **Epic 43 Story 43-10 applied every
> verdict directly to the story files, implementation plans, and this README.**
>
> | Story | Verdict |
> |---|---|
> | **42-1** | **Rewritten** — drop `AutonomyFloor`, `PermissionClass` and `Category` (absorbed by the catalog, along with their default-interface-member default and its three caveats). Keep `SecretRequirement`, `Suspends`, and the `SecretPurpose` relocation. |
> | **42-2** | **DELETED** — a third per-principal override store of identical shape. Its two-scoping prose is transplanted into Epic 43 Story 5. |
> | **42-3** | **DELETED** — a second gate on the same code path. Its siting analysis and its effective-ceiling insight (filtering on the raw descriptor class would have made every Wave-3 write tool unreachable) are transplanted into Epic 43's Seam B, with credit. |
> | **42-4** | Unchanged (carries the `ConfigJson` open question for secret-name override; AC6 updated for invocation-time fail-closed). |
> | **42-5** | **Narrowed** — keeps the invocation trio; loses the governance events (Epic 43 owns one event family) and its dependency on `InlineToolLoopResult.ToolCalls`, which is documented as always empty. |
> | **42-6** | Part A unchanged. **Part B gains a catalog-binding prerequisite** (unclassified ⇒ rejected at registration) **AND is marked blocked on the unresolved MCP coarse-vs-open-catalog fork** (see Open Question 1). |
> | **42-7 / 42-8A / 42-8B / 42-9** | **Gating sections stripped.** They declare capability and secrets; the catalog governs them. 42-8A/8B/9 carry the `ConfigJson` open question. |
> | **42-8B specifically** | **Scope 4 / AC7 DELETED** — it required the Epic 39 always-escalate class to bind *independently* of the dial and of 42-3's grant, so a satisfied tool authorization would not satisfy the class. That is two gates, two audit ids and two human decisions for one production deploy. |
>
> Also settled here: the contradiction where this README said 42-3 was *not* blocked on the Epic 39
> gating work while Story 39-23 said it *was*, and 42-3 itself never mentioned either. 39-23 is
> superseded; 42-3 is deleted; the question is moot.
>
> Applied by **Epic 43 Story 43-10**. See `docs/stories/epic-43/README.md` and
> `.dev/decisions/epic-43-action-catalog-design.md`.

| Story | Title | Purpose (one line) |
|---|---|---|
| **42-1** | Tool Contract & Registry Evolution | Add plain abstract `ToolDescriptor(RequiredSecret, Suspends)` to `IToolExecutor`, relocate `SecretPurpose` to `Tamma.Core`, and add a platform-scoped dynamic `Register`/`Unregister` seam to `IToolExecutorRegistry`; annotate the six built-ins + `GetAcceptanceRulesTool`. |
| ~~**42-2**~~ | ~~Tool Binding & Config Store~~ | **SUPERSEDED by Epic 43 — story file deleted 2026-07-25.** It persisted per-principal tool enablement + autonomy floor in a new `tool_bindings` table. Epic 43's `action_assignments` stores the same policy for *all* actions, of which tools are one namespace; two tables holding the same setting can disagree. Two-scoping prose transplanted to Epic 43 Story 5. **⚠️ But see the gap below — the deletion took `ConfigJson` with it.** |

> ### ⚠️ Gap opened by the 42-2 deletion — `ConfigJson` has no replacement
>
> Found during the implementation-planning pass, after the reconciliation was written. **This is a
> defect in the reconciliation, not in the stories.**
>
> 42-2's `tool_bindings` row carried **two different things**: per-principal *policy* (enablement,
> autonomy floor, allowed roles) and per-principal *configuration* (`ConfigJson`). Epic 43's
> `action_assignments` absorbs the policy half only — it stores a threshold and flags, deliberately,
> because it is a governance table and not a settings store.
>
> So deleting 42-2 wholesale left **four stories with nowhere to put their configuration**:
>
> | Story | What it lost |
> |---|---|
> | **42-9** authenticated HTTP tool | the destination / host allowlist |
> | **42-8A** feature-flag tool | the environment map |
> | **42-8B** deploy-control tool | the target map |
> | **42-4** tool credential binding | the secret-name override |
>
> **Interim resolution, applied in those four plans:** each moves its configuration to `IOptions`
> (deployment configuration), which is sufficient for single-user mode and for a single-tenant
> deployment.
>
> **Open product question — per-tenant tool configuration in SaaS is genuinely lost.** `IOptions` is
> process-wide, so two tenants cannot have different deploy targets or different flag environments.
> 42-2 would have supported that. Restoring it means either a narrow `tool_configuration` table
> (config only, no policy — explicitly *not* a second governance store) or accepting that tool
> configuration is deployment-scoped in v1. Not derivable from code; needs a decision before 42-7,
> 42-8A, 42-8B or 42-9 are implemented.

| ~~**42-3**~~ | ~~Per-Tool Permission & Autonomy Gating~~ | **SUPERSEDED by Epic 43 — story file deleted 2026-07-25.** A second gate on the same code path as Epic 43's Seam B, with no stated ordering between them, its own denial-audit schema and its own escalation machinery. Its siting analysis and effective-ceiling insight (filtering on the raw descriptor class would have made every Wave-3 write tool unreachable) are transplanted to Epic 43 Story 9, with credit. |
| **42-4** | Tool Credential / Secret Binding | Generalize the shipped runtime-reveal pattern into `IToolSecretProvider` (impl in `Tamma.Api`), bind external-touching tools to `ISecretStore` (`SecretScope.Tenant` SaaS / `SecretScope.Platform` single-user); guarantee no-secret-in-logs/events. Carries the `ConfigJson` open question for secret-name override. |
| **42-5** | Tool-Use DCB Audit | Emit the durable **invocation trio** `TOOL.INVOKED` / `TOOL.SUCCEEDED` / `TOOL.FAILED` (secret-redacted args, `issueId`/`tenantId`/`toolName`/`toolCallId` tags) via a **direct `IEventRepository` append in `Tamma.Api`** at the shared `InlineToolLoopRunner` call site covering both execution branches, alongside the ephemeral `TOOL_LOOP.*` SSE stream; owns the shared emit path + redaction rule `TOOL.SECRET_ACCESSED` (42-4) reuses. *(Governance decisions live in Epic 43's `ACTION.GATE.*`; does not populate always-empty `InlineToolLoopResult.ToolCalls`.)* |
| **42-6** | MCP Integration | **Part A (Wave 0.5):** retire the 2 tool-facing `/api/kb/mcp/*` routes and re-scope the other 6 as sidecar-KB admin. **Part B (Wave 2 — ⛔ BLOCKED on MCP catalog-binding fork):** wrap external MCP tools as `IToolExecutor` (`mcp__<server>__<tool>`) via 42-1's dynamic path, requiring catalog resolution (unclassified ⇒ rejected at registration) and governed by Epic 43 Seam B; adopts `ModelContextProtocol.Core` and deletes `packages/mcp-client/`. |
| **42-7** | Cloud / VPS Resource Operations Tool | Provider-abstracted (Hetzner + generic) cloud/VPS list/create/resize/delete tool family, split `cloud_resource_read` / `cloud_resource_write`; shares `WaitForToolOperationActivity` with 42-8B; governed by Epic 43. |
| **42-8** | *(split)* Feature-Flag & Deploy-Control Tools | **Superseded by 42-8A + 42-8B** — the two halves share no implementation (two provider abstractions, two drivers, two secret bindings, and a suspend path on only one side). The remaining `42-8-…md` is the split index. |
| **42-8A** | Feature-Flag / Config-Toggle Tool | `feature_flag_read` / `feature_flag_write`; server-resolved environment containment (`AutonomyQuery.Target`, never asserted by the model), governed by Epic 43; carries the `ConfigJson` open question. No engine-side work. Medium. |
| **42-8B** | Deploy-Control Tool | `deploy_status` / `deploy_control` (trigger / promote / rollback); shares `WaitForToolOperationActivity` with 42-7; governed by Epic 43 (`AlwaysHuman` + ledger + OR'd business-mode predicate); carries the `ConfigJson` open question. Large. |
| **42-9** | Authenticated HTTP / External-API Tool | Generic host+method-allowlisted authenticated REST tool (S1–S11 SSRF containment + by-value redaction) covering publish/notify/integration needs; governed by Epic 43; carries the `ConfigJson` open question. |

## Sequencing

**Wave 0 — the contract.** **42-1** (`ToolDescriptor(RequiredSecret, Suspends)` + dynamic registry,
plus §0's relocation of Epic 29's `SecretPurpose` into `Tamma.Core`). Everything depends on it. Its
`Register`/`Unregister` seam lands **platform/deployment-scoped only**; principal-scoped registration
into the singleton stays rejected until 42-6's per-tenant view. *(Dead `ResolveToolsActivity` was
already deleted by Epic 43 Story 43-0.)*

**Wave 0.5 — closing the live hole.**
- **42-6 Part A** (P0) — retire the 2 tool-facing `/api/kb/mcp/*` routes, re-scope the other 6 as
  sidecar-KB admin. Depends on **nothing** in this epic. It is a deletion while the route dead-ends;
  it becomes a migration the moment anyone sets `mcpClient` on the sidecar bundle. Shipping the epic
  with this open would make its own governance claim false.

**Wave 1 — security & audit rails (parallel after 42-1; governance already lives in Epic 43).**
*(42-2 and 42-3 were superseded by Epic 43 and deleted; Epic 43 Stories 43-1..43-9 already ship the
Action Catalog, `action_assignments`, `action_authorizations`, and Seam B.)*
- **42-4** (secret binding — *Medium*, a generalization of a shipped seam);
- **42-5** (durable `TOOL.*` invocation DCB audit — can land in parallel with 42-1, which is a soft
  enhancement for `RequiredSecret` field suppression).
Together with Epic 43's Seam B, these are the security and audit envelope every family and MCP tool
inherits — no Wave-3 family ships before them.

**Wave 2 — the open catalog (⛔ BLOCKED on the MCP catalog-binding fork).** **42-6 Part B** (MCP) —
the dynamic-tool path proving a non-native tool obeys 42-1 / 42-4 / 42-5 and Epic 43's Seam B. Its
route-reconciliation half is **not** here (that is Part A, in Wave 0.5). Part B's client choice (§0) is
settled (**adopt `ModelContextProtocol.Core`**), but Part B remains **blocked on resolving Open
Question 1's MCP catalog-binding fork** (coarse `effect:mcp.tool.invoke` vs dynamically-minted catalog
members).

**Wave 3 — the families (parallel on the Wave-1 rails + Epic 43; gated on the `ConfigJson` product
decision).** **42-8A** flags, **42-9** HTTP, **42-8B** deploy, **42-7** cloud/VPS — each a descriptor +
executor **in `Tamma.Api`**. Recommended order (adjusted post-reconciliation, see 42-8 plan C2):
**42-8A → 42-9 → 42-8B → 42-7** (42-8A needs nothing engine-side and delivers 41-22's kill-switch; 42-9
unblocks the most Epic 41 workflows once its destination config is decided; 42-8B and 42-7 share
`WaitForToolOperationActivity`, its bookmark prefix, its `CanonicalSuspendActivities` registration and
its authenticated callback endpoint — **whichever lands first ships them, the second reuses them**, so
only one of the two carries that cost).

## Out of scope (deliberately not this epic)

- **A general plugin/marketplace runtime for arbitrary code.** MCP (42-6) is the extensibility path;
  loading untrusted in-process assemblies is not. — *MCP gives the open catalog with a process boundary
  and the same governance; in-proc plugins reopen the trust surface this epic closes.*
- **Rewriting governance, the accept gate, or the secret store.** This epic *composes* **Epic 43** (the
  Action Catalog, `action_assignments`, `action_authorizations`, and Seam B/E — adding no second gate or
  override table) and the Epic 29 `ISecretStore` (adding no second cabinet).
- **Building the flag / deploy / cloud *providers themselves*.** 42-7/42-8A/42-8B/42-9 define the
  provider-abstracted tool + one reference driver each (Hetzner, a flag provider, the deploy platform);
  exhaustive driver coverage per vendor is follow-on, exactly as the Git/AI provider abstractions grew.
- **A real `ISecretAccessAuditor` implementation.** Only `NullSecretAccessAuditor` is wired today, so
  42-4/42-5's secret-read audit rows land nowhere until an Epic 29 story swaps it. This epic depends on
  it and does not build it.
- *Removed: "The reveal-to-runtime-consumer secret path."* **Corrected** — four such readers already
  ship (see "What already exists"), so there is nothing here to defer to Epic 29. 42-4 generalizes them.

## Dependencies

- **Epic 43 (Action Catalog — single source of truth for governance):** Epic 43 owns `ActionRisk`,
  `AutonomyDial` (one constant), `action_assignments` + `action_authorizations` (Story 43-5), the
  `IAcceptanceRulesResolver.ResolveBase*Async` widening (done once in Story 43-5 — never duplicated
  here), Seam B tool-loop gating + Seam E Elsa approval gating (Story 43-9), and the `ACTION.GATE.*`
  event family. *(Pre-reconciliation drafts assigned a live-read autonomy seam to 42-3 and cited Story
  39-23 for the per-action-class autonomy floor. Both 42-3 and 39-23 are **superseded by Epic 43**;
  Epic 43 provides the entire governance layer.)*
- **Epic 29 (secrets):** `ISecretStore` / `SecretRef` / `SecretScope` / `SecretPurpose` **exist** (Story
  29-1) — all in `Tamma.Api.Services.Secrets`, i.e. **in the API assembly and unreachable from
  `Tamma.Activities`**, which is why 42-1 §0 **relocates `SecretPurpose` to `Tamma.Core.Enums`**
  (a move, not a mirror — see "Where the code lives"). `SecretRef` / `SecretScope` / `ISecretStore`
  stay Api-side; a `ToolDescriptor` never carries a `SecretRef`, only the logical requirement.
  *Corrected: the "hard-blocked reveal-to-runtime-consumer path" no longer applies* — four runtime
  plaintext readers ship (audited `SecretStorePlatformCredentialReader`, `CabinetTenantProviderKeyReader`,
  `RuntimeSecretResolver`, `IAlertChannelSecretReader`). The **real** dependency is a non-null
  `ISecretAccessAuditor`: today only `NullSecretAccessAuditor` is registered, so audited-read acceptance
  criteria cannot be satisfied until it is swapped. 42-7/42-8A/42-8B/42-9's agent paths **no longer wait** on a
  reveal path.
- **Epic 39:** resumable-by-design bookmark standard (`LifecycleBookmarks.CanonicalSuspendActivities`
  for 42-7 / 42-8B's `WaitForToolOperationActivity`). *(Decision-gate / autonomy-dial plumbing is now
  consumed through Epic 43's `IActionAuthorizationLedger` and Seam E rather than via a bespoke
  `ToolAuthorizationRequest` in deleted Story 42-3.)*
- **DCB audit transport (42-5):** *Corrected* — **not** `TammaEventEmitter` → `tamma:events` →
  `EventDrain`. That emitter structurally requires an `ActivityExecutionContext` **and** an `IActivity`,
  and the tool loop no longer runs in the engine; `Tamma.Api` holds `IEventRepository` directly (as
  `AlertEventEmitter`, `PromptEventsService`, `EscalationDispositionService` already do). 42-5 appends
  directly. Hook the **shared** `InlineToolLoopRunner` call site so both the parallel and the default
  sequential branch are covered.
- **Epic 41 / 41-29:** the consumers. 41-29's `TaskKind`→workflow map is unchanged; this epic supplies
  the tools those dispatched workflows resolve. `docs`/`infra`/`design` agent paths light up as
  42-7/42-8A/42-8B/42-9 land.
- **Existing surface (extended, not replaced):** `IToolExecutor`, `IToolExecutorRegistry` /
  `ToolExecutorRegistry`, `ManagedAgent.ToResolvedTools`, `InlineToolLoopRunner`, `ParallelToolExecutor`,
  `ToolCallValidator` + `ActionGate`, `IToolLoopEventSink` / `ToolLoopEventEmitter`. *(Corrected:
  `ResolveToolsActivity` removed from this list — it is dead code.)*
- **Existing MCP prior art (42-6 must decide on each):** `packages/mcp-client/` (9,662 LOC, orphaned,
  never built) — port to C# or adopt an official MCP C# SDK; *proxying via the sidecar is ruled out
  by 42-6 §0* (it would put tool execution behind an HTTP hop outside the tool envelope, re-creating in
  Part B exactly the bypass Part A deletes). **Decided 2026-07-30: adopt `ModelContextProtocol.Core`
  behind an `IMcpTransport` seam; the package is deleted outright when Part B lands** — see
  `.dev/decisions/story-42-6-mcp-client-port-vs-adopt.md`. Either way the package must not stay
  orphaned — it becomes the port's source of truth and is then deleted, or it is deleted outright. The 8 `/api/kb/mcp/*`
  routes — **retire 2, re-scope 6** (settled in 42-6 A1/A2). `MCPSource` (an MCP *resource* consumer,
  not a tool consumer) whose `IMCPClientLike` seam should converge on whatever client 42-6 lands.

## Decisions taken (previously open questions, now settled by the code)

*These were open questions in an earlier draft. Their old numbers are **not** the numbers in "Open
design questions" below — that list has been renumbered; cite these as **D1** / **D2**.*

- **D1 — Secret reveal for runtime tool execution: option (a), and it is not a new capability.**
  *(Was the draft's "biggest" open question.)* Four runtime plaintext readers already ship around
  `ISecretStore`'s no-plaintext boundary, one of them scope-generic and audited
  (`SecretStorePlatformCredentialReader.ReadActivePlaintextAsync(scope, tenantId?, name)`), plus a full
  BYOK→platform resolver (`DefaultProviderCredentialResolver`). 42-4 generalizes that pattern into
  `IToolSecretProvider` (impl in `Tamma.Api`); no Epic 29 story is filed or waited on. Residual
  dependency: a non-null `ISecretAccessAuditor`.
- **D2 — ~~Destructive-tool routing rides the decision-gate plumbing with a sibling `ToolAuthorizationRequest`.~~ SUPERSEDED by Epic 43 (Story 43-9).** Story 42-3 was deleted; tool-call denials at Epic 43's Seam B return `Denied` via `rejectedToolCalls` (no human wait sits inside the blocking LLM HTTP request), and human waits / correlation-scoped grants ride Epic 43's Seam E + `IActionAuthorizationLedger` over the existing Elsa resume endpoints (no new bookmark prefix and no `ToolAuthorizationRequest`).

## Open design questions (genuinely unresolved — worth a decision)

1. ~~**Descriptor default: deny vs. read-only.**~~ **RESOLVED as *deny at registration* — replaced by
   an unresolved MCP catalog-binding fork (⛔ BLOCKS 42-6 Part B).** Under Epic 43 reconciliation
   (Story 43-10), an MCP tool entering the registry must resolve to an Epic 43 catalog entry and is
   rejected at registration if unclassified (*deny*, not read-only). **However**, Epic 43's own README
   states: *"MCP is one coarse member with no drift signal. Adding a server, or a tool on an existing
   server, changes nothing in the catalog."* That creates an unresolved fork: **(i)** every MCP tool
   binds to the single coarse `effect:mcp.tool.invoke` member (which governs nothing finer than a
   blanket toggle, making per-tool catalog binding ceremonial), or **(ii)** MCP tools dynamically mint
   catalog members at runtime (which makes the catalog **open** and breaks Epic 43's closed-vocabulary
   premise, count pins, and keyset-equality sweeps). **42-6 Part B is blocked until this fork is
   decided.** Entangled with Question 2 below and Epic 43 Open Question 1.
2. **MCP server trust & tenancy.** In SaaS, may a `tenant_admin` register an arbitrary MCP server
   (tenant-scoped), or is the MCP server allowlist platform-owned? Determines whether 42-6 needs a
   per-tenant MCP registration surface or only a platform one. Sharpened by 42-1's `Register`/`Unregister`
   landing on a **singleton** registry two waves earlier than 42-6 Part B's per-tenant view — hence the
   Wave-0 constraint that dynamic registration be platform/deployment-scoped only, and 42-6's decision
   to implement the platform-owned path first *because it must*. What is genuinely open is only whether
   tenant-scoped MCP registration is ever permitted; if it is, 42-6 Part B also owns building the
   per-principal registry view (which is separately what would give the 39-5 D6 principal-bound-tool
   pattern a delivery path).
3. ~~**MCP client: port or adopt.**~~ **RESOLVED 2026-07-30 — adopt the C# SDK.** Recorded in
   `.dev/decisions/story-42-6-mcp-client-port-vs-adopt.md`: take `ModelContextProtocol.Core` behind an
   `IMcpTransport` / `IMcpConnectionPool` seam and delete `packages/mcp-client/` outright. 42-6 Part B's
   estimate is unblocked at ~4–6 days (+~0.5 for the prerequisite below).
   *Original framing, kept for the record:* `packages/mcp-client/` is **9,662** LOC of working
   hand-rolled TS with zero dependents (*corrected — this said 7,865 in three places*); the C# backend
   has no MCP client at all. The two live options — port it to C#, or adopt an official MCP C# SDK — had
   materially different costs. *Proxying through the TS sidecar was never one of the options: 42-6 §0
   rules it out on evidence.*
   **The prerequisite the decision surfaced (P1):** the SDK requires the **10.x**
   `Microsoft.Extensions.AI.Abstractions` line on net8.0 at every available version, and `Tamma.Api`
   resolves **9.5.0** through `Elsa.Agents.Core 3.5.3` → `Microsoft.SemanticKernel 1.57.0`. Elsa.Agents
   is load-bearing, no older SDK avoids the bump, and a separate assembly does not avoid it either. The
   package reference does not merge until a full unfiltered `Tamma.Api.Tests` run proves SK still loads.
   Fallbacks in the decision record. Note a second, independent customer for the chosen transport:
   `HttpProviderClient.NonHttpProviders` fails `zen-mcp`/`zen` with `PROVIDER_NOT_SUPPORTED` because the
   MCP transport "is not yet ported to C#" — worth knowing, without taking that provider port on.
4. ~~**Autonomy-dial design change (needs Epic 39 sign-off).~~ RESOLVED by Epic 43 (Stories 43-1, 43-5,
   43-9).** The dial is both prompt context and a hard gate (2026-07-24 PO decision), expressed once in
   `AutonomyDial` and read live by Epic 43's `AutonomyGateService` via
   `IAcceptanceRulesResolver.ResolveBase*Async`. Story 42-3 and Story 39-23 are superseded.
5. **Per-tenant tool configuration in SaaS (`ConfigJson` gap — ⛔ gates Wave 3).** Deleting Story 42-2
   removed `tool_bindings.ConfigJson`, leaving 42-4 (secret-name override), 42-8A (environment map /
   kill-switch / sensitive list), 42-8B (target map), and 42-9 (destination / host allowlist) with
   deployment-scoped `IOptions` only. Decide before implementing 42-7/42-8A/42-8B/42-9: add a narrow
   `tool_configuration` table (config only, explicitly *not* a second governance store) or accept
   deployment-scoped tool configuration in v1.
