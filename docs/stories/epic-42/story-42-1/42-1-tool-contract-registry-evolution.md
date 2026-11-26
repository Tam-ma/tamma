# Story 42-1: Tool Contract & Registry Evolution

Status: done

## MANDATORY: Before You Code

**ALL contributors MUST read and follow the comprehensive development process:**

[BEFORE_YOU_CODE.md](../../../guides/BEFORE_YOU_CODE.md)

Then check the knowledge base: `.dev/spikes/`, `.dev/bugs/`, `.dev/findings/`, `.dev/decisions/`.

## User Story

As the **platform**, I want every tool to **declare its capability metadata** — required secret and
whether completion is owned by an engine-side wait (`Suspends`) — and I want the registry to accept
**dynamic registration**, so that external-touching tools can bind credentials and long operations
safely, and the catalog can grow per deployment and via MCP without a code change per tool. Governance
(risk classification, autonomy thresholds, per-principal overrides, and enforcement) lives in **Epic 43
(The Action Catalog)**, not on `ToolDescriptor`.

## Priority

P0 / Wave 0 — **the contract every other Epic 42 story builds on.** Secret binding (42-4), MCP dynamic
registration (42-6 Part B), and the tool families (42-7/8A/8B/9) build on a tool declaring its
`SecretRequirement` and `Suspends` flag and on the registry holding tools added at runtime. (42-5 audit
can land in parallel — `RequiredSecret` field suppression is a soft enhancement.)

## The gap (READ FIRST)

`IToolExecutor` (`Tamma.Activities/LlmCall/Tools/IToolExecutor.cs`, namespace
`Tamma.Activities.LlmCall.Tools`) is `{ ToolName, Description, InputSchema, ExecuteAsync }` and **must
never throw** (all failure is `ToolExecutionResult { Success = false }`). It carries **no capability
metadata** — nothing says what credential the tool needs or whether completion is owned by an
engine-side wait. (Per-action risk, autonomy thresholds, and enforcement are owned by Epic 43's Action
Catalog rather than by `IToolExecutor`.)

`ToolExecutorRegistry` (`ToolExecutorRegistry.cs` L14–39) is populated **once** in its constructor from
`IEnumerable<IToolExecutor>` injected by DI. `IToolExecutorRegistry` (L7–29) exposes only read paths —
`GetExecutor`, `IsAllowed`, `GetAll`, `GetAllowed`. There is **no** `Register`/`Unregister`: the catalog
is frozen at startup, and the backing store is a plain `Dictionary` (L11, L19).

**Corrected — the DI citation.** Earlier drafts cited `Tamma.Api/Program.cs` "~L753–763". The six
`AddSingleton<IToolExecutor, …>` calls are at **L753–764** (FileRead, FileWrite, SearchCode,
ShellExecute, GitOperations, RunTests); the registry `TryAddSingleton<IToolExecutorRegistry,
ToolExecutorRegistry>` is at **L765–766**. Registration lives in `Tamma.Api`, not the engine —
`Tamma.ElsaServer/Program.cs` L286–289 records that the tool catalog was removed from the engine
(Story 32-5 AC9) and "the tool executors are registered there, not here."

**Prior art you must not undo — the principal-bound tool (Story 39-5, D6).** A **seventh**
`IToolExecutor` implementation already exists outside the DI set:
`Tamma.Api/Services/AcceptanceRules/GetAcceptanceRulesTool.cs` L27 (`get_acceptance_rules`, L51). Its
own doc (L12–23) states it is *"PRINCIPAL-BOUND AT CONSTRUCTION and NOT globally DI-registered"* — the
`GetAcceptanceRulesToolFactory` (same file, L125–154; `AddScoped` at `Program.cs` L422) mints one per
principal and enforces `userId` XOR `tenantId` (L142–146). This is the in-repo answer to *"never mutate
the global set for a principal-scoped tool."*

It is also why the dynamic seam in §3 is still needed rather than superseded: the factory has **no
production call site** (only DI of the factory plus tests), and the only live tool loop resolves
executors solely through the registry — `InlineToolLoopRunner.cs` L431 `_toolRegistry.GetExecutor(...)`,
with a ctor (L45–55) that accepts no ad-hoc executor collection. The D6 pattern today has no delivery
path into a run.

**Where the types live (dependency direction).** `Tamma.Core ← Tamma.Activities ← Tamma.Api`, one-way.
`Tamma.Core.csproj` has **zero** `ProjectReference` entries (a leaf); `Tamma.Activities.csproj`
references only `Tamma.Core` + `Tamma.Data`; `Tamma.Api.csproj` references `Tamma.Activities` (L78).
Anything the `IToolExecutor` surface names must therefore live in `Tamma.Core`, `Tamma.Data`, or
`Tamma.Activities` — **never** in `Tamma.Api`. See Scope §0.

## Scope

0. **Relocate `SecretPurpose` to `Tamma.Core` (prerequisite for §1).** The Epic 29 taxonomy currently
   lives at `Tamma.Api/Services/Secrets/SecretPurpose.cs`, namespace `Tamma.Api.Services.Secrets`
   (7 members: `DbCredential`, `ApiKey`, `SigningKey`, `HmacSharedSecret`, `Webhook`, `Connection`,
   `Other`). It is **unreachable** from `Tamma.Activities`, and adding a `Tamma.Activities → Tamma.Api`
   reference is circular (see the dependency-direction note above) — a hard `CS0246`, not a suppressible
   diagnostic. Move the enum verbatim to `Tamma.Core/Enums/SecretPurpose.cs`
   (namespace `Tamma.Core.Enums`) and update the `using` in the ~16 `Tamma.Api` source files + tests
   that name it.

   *Decision — move, not mirror.* The alternative (a Core-owned `ToolSecretPurpose` mapped onto Epic
   29's in the Api layer) was rejected: it creates two taxonomies that must be kept in sync, and the
   mapping table is exactly the kind of drift the descriptor is meant to remove. The move is safe:
   `SecretRow.Purpose` is a `string` column (`Tamma.Data/Entities/SecretRow.cs` L83), so **no schema or
   data change**, and no member is added, removed, or reordered.

1. **`ToolDescriptor` on the executor surface.** Introduce `ToolDescriptor` in
   `namespace Tamma.Activities.LlmCall.Tools` (alongside `IToolExecutor`) and surface it via a new
   **plain abstract** `ToolDescriptor Descriptor { get; }` member on `IToolExecutor`.

   ```csharp
   // namespace Tamma.Activities.LlmCall.Tools
   using Tamma.Core.Enums;            // SecretPurpose, after Scope §0

   public sealed record SecretRequirement(
       SecretPurpose Purpose,   // Epic 29 taxonomy, relocated to Tamma.Core by §0
       string Name,             // logical secret name, resolved to a SecretRef per mode by 42-4
       bool Required);          // hard-fail vs. best-effort

   public sealed record ToolDescriptor(
       SecretRequirement? RequiredSecret,
       bool Suspends);                       // completion is owned by an engine-side wait
   ```

   **`Suspends` does not mean "the executor suspends the workflow" — it cannot.** *This wording is
   load-bearing; 42-7 §4 and 42-8B §6 both depend on it.* The tool loop runs server-side inside a
   **blocking** `POST /api/v1/llm/call` in `Tamma.Api` (`CallLlmInlineActivity` is a thin client over
   `TammaApiClient`), where there is no `ActivityExecutionContext` and no bookmark to create. So
   `Suspends = true` is a **declaration that this tool's completion is owned by an engine-side wait**:
   the executor returns promptly with an `operationHandle`, and the engine-side
   `WaitForToolOperationActivity` (credential-free, resumes on a callback or a durable timeout)
   carries the suspension. Put this on the property's XML doc — an implementer who reads `Suspends`
   as an executor capability will write an AC that cannot be satisfied.

   **`Descriptor` is a plain abstract interface member, not a default interface member (DIM).** An
   earlier pre-reconciliation draft used a DIM solely to return a deny-by-default governance value
   composed of `Category`, `PermissionClass`, and `AutonomyFloor`. With those three fields absorbed by
   Epic 43, the remaining fields (`SecretRequirement?` and `bool Suspends`) have no fail-safe default
   to fall back to — a tool either needs a specific secret or none, and either suspends or not. Making
   `Descriptor` a plain abstract member is strictly stronger: every `IToolExecutor` implementer must
   declare one or fail to compile, eliminating the entire DIM caveat surface (concrete-reference
   invisibility, `Mock<IToolExecutor>` returning `null`, and `Type.GetInterfaceMap` reflection checks).

   **Superseded by Epic 43 (dropped fields and where each now lives):**
   - `AutonomyFloor` → **`ActionDescriptor.DefaultMinAutonomy` + `action_assignments.min_autonomy`**
     (Epic 43 Stories 43-3 / 43-5 / 43-11), validated in one place by `AutonomyDial.IsValidThreshold`
     (Epic 43 Story 43-1; Epic 43 D3 forbids hardcoding the dial range a second time).
   - `PermissionClass` (`ToolPermissionClass` is **not introduced**) → **`Tamma.Core/Actions/ActionRisk`**
     (Epic 43 Story 43-2), member-for-member across the entire action catalog rather than tools alone.
   - `Category` (`ToolCategory` is **not introduced**) → **the registry's registration path**
     (DI-seeded built-ins vs dynamic `Register` in `ToolExecutorRegistry`).

2. **Annotate the built-ins.** Each of the six DI-registered tools **and** `GetAcceptanceRulesTool`
   declares an explicit `ToolDescriptor` via the abstract `Descriptor` property:

   | Tool | RequiredSecret | Suspends |
   |---|---|---|
   | `SearchCodeTool` (`search_code`) | `null` | `false` |
   | `FileReadTool` (`file_read`) | `null` | `false` |
   | `FileWriteTool` (`file_write`) | `null` | `false` |
   | `GitOperationsTool` (`git_operations`) | `null` (platform creds resolved elsewhere today) | `false` |
   | `RunTestsTool` (`run_tests`) | `null` | `false` |
   | `ShellExecuteTool` (`shell_execute`) | `null` (stays `ActionGate`-gated) | `false` |
   | `GetAcceptanceRulesTool` (`get_acceptance_rules`) | `null` | `false` |

   The table is intentionally trivial: the six built-ins touch only the local repo/git/shell and
   `get_acceptance_rules` reads in-process, while per-tool governance (`ActionRisk` and
   `DefaultMinAutonomy` / `action_assignments.min_autonomy`) lives in Epic 43's Action Catalog.
   `GetAcceptanceRulesTool` keeps its D6 invariant (principal-bound at construction, **not**
   DI-registered).

3. **Dynamic registration seam — platform-scoped in this story.** Extend `IToolExecutorRegistry` with
   `Register(IToolExecutor)` / `Unregister(string toolName)` and make `ToolExecutorRegistry`'s backing
   map thread-safe (`ConcurrentDictionary`, case-insensitive as today). The DI-seeded set remains the
   base layer; dynamic registrations layer on top. Duplicate-name handling keeps today's "keep first,
   warn" for the DI seed, but a dynamic `Register` of an existing name is an explicit
   **replace-or-reject** decision (default reject; MCP refresh uses `Unregister`+`Register`). Registry
   read paths (`GetAll`/`GetAllowed`) see the merged set.

   **The singleton is platform/deployment scope only.** `ToolExecutorRegistry` is a singleton, so a
   principal-scoped (per-user / per-tenant / per-run) tool registered into it leaks to every other
   principal. This story therefore ships `Register`/`Unregister` for **deployment-wide** tools only and
   **rejects a principal-bound registration outright** (see AC7) until 42-6 lands the per-principal
   registry *view*. Until then the D6 factory pattern — construct per principal, never register — is the
   only sanctioned way to mount a principal-bound tool. The 42-6 view is what finally gives that pattern
   a delivery path into `InlineToolLoopRunner`.

4. **Scope hand-offs (what this story does NOT touch).**
   - **`ResolvedTool` / `ManagedAgent.ToResolvedTools`:** Earlier drafts threaded `Descriptor` onto
     `ResolvedTool` for 42-3 (now deleted and superseded by Epic 43 Seam B). No descriptor is threaded
     onto `ResolvedTool` here. The genuine defect found in `ToResolvedTools` (`ManagedAgent.cs`
     L923–937 — advertising name-only tools) belongs to **Epic 43 Story 43-4** (tool-vocabulary
     reconciliation and startup validator), which classifies fixing it as a privilege expansion rather
     than a cleanup. No behavior change to the six built-ins' availability on either the sequential
     (`ToolLoopConfig.EnableParallelTools` defaults to `false` at `LlmCallModels.cs:500`) or parallel
     branch.
   - **`ResolveToolsActivity` (dead code):** Deleting the unreferenced `ResolveToolsActivity` (whose
     hard-coded `"read_file"` fallback disagreed with `FileReadTool.ToolName == "file_read"`) was
     handed to and completed by **Epic 43 Story 43-0**. This story treats its absence as a verified
     precondition, not as work to redo.

## Acceptance Criteria

1. `SecretPurpose` compiles at `Tamma.Core.Enums.SecretPurpose` (or lives physically in `Tamma.Core`
   with no circular reference, per plan D1) with the same **7** members in the same order (a test pins
   `Enum.GetValues<SecretPurpose>().Length == 7` and the member names); no duplicate enum exists in
   `Tamma.Api`; `Tamma.Activities.csproj` still references **only** `Tamma.Core` + `Tamma.Data` (no
   `Tamma.Api` reference is added).
2. `IToolExecutor.Descriptor` is a **plain abstract** `ToolDescriptor Descriptor { get; }` member where
   `ToolDescriptor` is `(SecretRequirement? RequiredSecret, bool Suspends)` (neither `ToolCategory` nor
   `ToolPermissionClass` is introduced). All six DI-registered built-ins **and**
   `GetAcceptanceRulesTool` declare explicit descriptors matching the §2 table (`RequiredSecret == null`,
   `Suspends == false`), and `GetAcceptanceRulesTool` remains non-DI-registered per D6.
3. `IToolExecutorRegistry.Register`/`Unregister` exist; a test registers a tool at runtime, resolves it
   via `GetExecutor`/`GetAll`, unregisters it, and asserts it is gone — with no restart. Concurrent
   `Register`/`GetAll` calls are race-free; a stress test asserts no lost/duplicated entries. A dynamic
   `Register` of a name already present rejects by default (test) and succeeds via
   `Unregister`+`Register` (test).
4. *(Formerly AC7, referenced in §3.)* `Register` **rejects a principal-scoped registration** in this
   story: a test passes a tool carrying a principal binding (or calls the principal-scoped overload) and
   asserts a loud, typed failure naming 42-6's per-principal view as the sanctioned path. No API exists
   in this story to register a tool for one user/tenant only.
5. **No behavior regression on built-ins.** An unrestricted caller still sees all six DI-registered
   built-ins on both the sequential (default) and parallel execution branches.
6. **Precondition check.** `ResolveToolsActivity` remains absent (deleted by Epic 43 Story 43-0) and
   no tool-resolution helper in the tree emits a built-in name that `IToolExecutorRegistry.GetExecutor`
   cannot resolve.

*Deleted pre-reconciliation ACs and what replaces each guarantee (Epic 43 Story 43-10 D3):*
- *Former AC2 (DIM fail-safe regression test)* → **the C# compiler** (`Descriptor` is a plain abstract
  member; an un-annotated `IToolExecutor` does not compile).
- *Former AC4 (`Type.GetInterfaceMap` startup drift test)* → **the C# compiler** for declaration
  presence, plus **Epic 43 Story 43-4's startup validator** (`ActionCatalogStartupValidator`), which
  enforces catalog binding at boot.
- *Former AC5 (`AutonomyFloor` `[70,100]` range validation)* → **`AutonomyDial.IsValidThreshold`** in
  one place (Epic 43 Story 43-1; Epic 43 D3 forbids hardcoding the dial range a second time).
- *Former AC8 (`Mock<IToolExecutor>` DIM returns-null hazard)* → **nonexistent** — a mock of an
  interface with an abstract member has no inherited DIM implementation to silently return `default`
  from.

## Events

None new in this story (the `TOOL.*` DCB family is 42-5; governance decisions are Epic 43's
`ACTION.GATE.*`). Registry `Register`/`Unregister` log at INFO with the tool name (never secrets).

## Single-user vs SaaS

No principal-scoped behavior here — the descriptor is a **static property of the tool**, identical in
both modes, and §3 explicitly forbids principal-scoped registration until 42-6. Per-principal policy
overrides and per-mode governance resolution live in **Epic 43 Story 43-5** (`action_assignments` +
`IGovernancePrincipalResolver`; 42-2 and 42-3 were superseded and deleted). This story is
mode-agnostic by construction.

## Dependencies

- **Epic 29 `SecretPurpose`** — exists, but **not where this story needs it**. It is at
  `Tamma.Api/Services/Secrets/SecretPurpose.cs`, namespace `Tamma.Api.Services.Secrets`, and is
  unreachable from `Tamma.Activities` (which references only `Tamma.Core` + `Tamma.Data`); adding a
  `Tamma.Activities → Tamma.Api` reference is circular because `Tamma.Api.csproj` L78 already references
  `Tamma.Activities`. Scope §0 relocates it to `Tamma.Core`. *(Corrected: earlier drafts said only
  "exists", which read as "usable here". It is not.)* The same reachability note applies to 42-4, which
  names `SecretRequirement`/`SecretRef` throughout.
- **Story 39-5 D6** (`GetAcceptanceRulesTool` + factory) — exists; this story annotates the tool and
  preserves the not-DI-registered invariant.
- **Epic 43 Stories 43-0 and 43-4** — 43-0 deleted `ResolveToolsActivity`; 43-4 owns catalog binding
  validation and tool-vocabulary reconciliation.
- **Unblocks:** 42-4 (`RequiredSecret`), 42-5 (soft enhancement — `RequiredSecret` field suppression),
  42-6 Part B (`Register`/`Unregister` + per-principal view), 42-7/8A/8B/9 (`ToolDescriptor` and
  `Suspends`). *(42-2 and 42-3 are superseded by Epic 43 and deleted.)*

## Risks

- **Registry mutability across principals.** The singleton makes any principal-scoped registration a
  cross-tenant leak. Converted from prose to a testable constraint in AC4 (formerly AC7): Wave 0 ships
  platform/deployment scope only; principal scope waits for 42-6's per-principal view.
- **Parallel vs sequential branch coverage.** `EnableParallelTools` defaults to `false`
  (`LlmCallModels.cs:500`), so a change tested only on one branch can pass while the default path is
  unchanged. AC5 requires both branches.
- **Confusing `Suspends = true` with an executor-side suspend.** An executor runs inside a blocking
  HTTP call and cannot suspend a workflow; keep the load-bearing XML doc wording from §1 intact so
  42-7 and 42-8B implementers never attempt an engine bookmark inside `ExecuteAsync`.

## Estimated Effort

Small–Medium — contract + dynamic registry seam + `SecretPurpose` relocation (no DIM caveats, no
`ResolvedTool` plumbing, no `ResolveToolsActivity` work). ~2–3 days.
