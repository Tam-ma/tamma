# Story 40-3: Durable Agent-Run Signal Plane + Resume Endpoint (cross-pod, restart-safe)

Status: review

## MANDATORY: Before You Code

**ALL contributors MUST read and follow the comprehensive development process:**

[BEFORE_YOU_CODE.md](../../../guides/BEFORE_YOU_CODE.md)

Then, before writing any code, check the knowledge base:

- `.dev/spikes/` — existing research
- `.dev/bugs/` — known bugs
- `.dev/findings/` — pitfalls and best practices
- `.dev/decisions/` — architecture decisions

## User Story

As a **platform operator running Tamma on more than one pod** (and across deploys),
I want the `workflow_run.completed` webhook that signals a finished coding run to **resume the
suspended workflow reliably — even when the webhook lands on a different pod than the one that
dispatched, and even after a restart**,
So that agent-run completion delivery is not a single-process, in-memory race that silently
degrades to polling (or fails) whenever the topology is not a single box.

## Priority

P0 — 40-2 makes the coding step suspend on a durable bookmark; this story is what *resumes* it
from the real webhook. Without it, 40-2's suspend has no production wake-up path other than the
poll fallback, and the multi-instance correctness gap the whole epic calls out stays open.

## Architectural Context (READ FIRST)

**Today the signal plane is in-memory and single-process.** `WebhookSignalRegistry`
(`apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/WebhookSignalRegistry.cs`) is a
`ConcurrentDictionary<string, TaskCompletionSource<AgentWebhookSignal>>`. The waiting
`AgentMonitorService.WaitForWebhookAsync` (`AgentMonitorService.cs:97`) parks a TCS; the
webhook handler `InstallationRouterService.HandleWorkflowRunEvent`
(`apps/tamma-elsa/src/Tamma.Api/Services/GitHub/InstallationRouterService.cs:377`) calls
`PublishSignal` on `workflow_run.completed`. The registry's own XML doc is explicit about the
limit:

> *Scope: single process. … For distributed deployments where the ElsaServer process runs the
> activity, webhook mode falls back to poll (Auto) or fails (explicit Webhook).*

So on multi-pod deployments (or after a restart) the waiter's TCS and the webhook's publish can
live in **different processes** and never meet. The signal key is scoped by GitHub App
installation id (`AgentWebhookSignalKey`, review-finding-5) to prevent cross-tenant wakeups, but
it remains a process-local dictionary.

**40-2 changes the substrate — and that is the fix.** Once the coding step suspends on a real
**DB-persisted Elsa bookmark** (40-2) instead of an in-memory TCS, **any pod can resume it
through Elsa's bookmark store** — Elsa's persistence *is* the cross-pod backplane. What the
webhook still lacks is the Tamma **session id / bookmark name**: the `workflow_run.completed`
payload carries repo, head branch, run id, and installation id, but not the Tamma session id
that `LifecycleBookmarks.ForAgentRun(tenant, repo, branch, session)` needs. A small **persisted
signal/dispatch row**, written at dispatch time and matched by the webhook, bridges that gap
durably. *Where that row lives and who writes it is not free — see below; the first draft of
this story got both wrong.*

**The resume-endpoint precedent is 39-8, and it has shipped.**
`Tamma.ElsaServer/Endpoints/DocumentDecisionResumeEndpoint.cs` exists on disk alongside
`DesignResumeEndpoint.cs`, `ClarifyResumeEndpoint.cs`, `DocumentInputResumeEndpoint.cs`,
`MergeApprovalResumeEndpoint.cs`, `BlockerResumeEndpoint.cs` and
`DeploymentApprovalResumeEndpoint.cs`. *Corrected: earlier drafts listed it as NOT FOUND and
budgeted a fallback onto `DesignResumeEndpoint`.* The shape to mirror: recompute the bookmark
name from the request, resume via Elsa's bookmark runtime, 404 on no-bookmark, 409 on
collision, principal-fold so one principal cannot resume another's run.

**Where the signal row can live — and who can write it.** Two code facts bound this story's
storage design, and the first draft got both wrong:

- **The engine cannot write a tenant row.** `WaitForAgentRunActivity` runs in the
  `Tamma.ElsaServer` host, which never registers `ITenantDbContextFactory` — `AddTammaData`
  is called from `Tamma.Api/Program.cs:249` only. That is deliberate: the engine holds no
  platform token and no tenant DB, and already mediates its dispatch over the wire
  (`AgentDispatchService.cs:8-17`, `:59` → `POST /api/v1/agent-dispatch/{owner}/{repo}/runs`,
  registered at `Tamma.Api/Program.cs:3113` under `EngineServiceOnly`). The row belongs on
  the API side of that same call.
- **A tenant-scoped table is not available in single-user mode.** `tenantId` is `Guid?`
  through the whole mediation surface (`IAgentDispatchMediationService.cs:20`;
  `AgentDispatchEndpoints.cs:41` forwards `tenantContext.TenantId`), and the inbound webhook
  path is *explicitly tenant-free* — `/api/github/webhooks` is in
  `TenantContextMiddleware.TenantFreePathPrefixes`, so no ambient tenant is bound when the
  `workflow_run.completed` handler runs. Storage must therefore work with a null tenant and
  the webhook must resolve its principal from the installation id, not from ambient state.

The landed pattern for exactly this is **dual scoping**: the same entity mapped into both
contexts, SaaS rows in the tenant schema via `ITenantDbContextFactory` and single-user rows in
`ControlPlaneDbContext`, with a `principal_xor` CHECK and no method joining both planes — see
`Tamma.Data/Repositories/AgentSelectionRepository.cs:7-18` (Story 32-2) and
`PromptRepository.cs:17-23` (Story 27-2).

## Acceptance Criteria

1. **Persisted agent-run signal row (durable, dual-scoped, written API-side).** A new
   `agent_run_waits` table records `{ tenant_id, user_id, repository, branch_name, session_id,
   installation_id, workflow_instance_id, bookmark_name, dispatched_at, status }` where
   `status ∈ { pending, received, timed_out }`, surviving process restart. One row per
   in-flight coding run; unique on the principal plus `(repository, branch_name, session_id)`;
   `principal_xor` CHECK (exactly one of `tenant_id` / `user_id`).

   *Corrected — the earlier AC said "tenant-scoped" and "written at dispatch (40-2's
   `Execute`)"; both are unbuildable (see Architectural Context).* The row is written on the
   **API** side inside `AgentDispatchMediationService`'s trigger path, where tenant id, repo,
   ref and correlation id already exist; the engine supplies the only two fields the API cannot
   derive — `bookmarkName` and `workflowInstanceId` — as new fields on
   `AgentDispatchRunApiRequest` (`TammaApiModels.cs:490-496`) and its API-side twin
   `DispatchAgentRunRequest` (`AgentDispatchRequests.cs`). It is mapped into **both**
   `TenantDbContext` (SaaS) and `ControlPlaneDbContext` (single-user), per the
   `AgentSelectionRepository` precedent.

   *Falsifiable:* the repository test runs the pending → received path twice, once per mode,
   and the **single-user case must pass with a null tenant id**. An implementation that only
   reaches `ITenantDbContextFactory` fails that case.

2. **Webhook resolves the row and resumes the bookmark, with no ambient tenant.**
   `HandleWorkflowRunEvent` (`InstallationRouterService.cs:377` — today a *synchronous*
   method; it becomes `…Async`, as does its `case` arm at `:350`) matches an incoming
   `workflow_run.completed` by `(installation_id, repository, head_branch)` to the pending
   row(s), reads the `bookmark_name` + `session_id`, and **resumes the 40-2 bookmark through
   Elsa's persistent bookmark runtime** with the completion payload (run id, conclusion,
   artifacts url). The row is marked `received`. Because `/api/github/webhooks` is a
   tenant-free path, the handler resolves the owning principal **from the installation id**
   before touching a store — it must never assume `ITenantContext.TenantId` is populated.
   *Falsifiable:* the handler test asserts a successful resume while `ITenantContext.TenantId`
   is null.

3. **Resume endpoint (mirrors the shipped 39-8 endpoint).** An HTTP `AgentRunResumeEndpoint`
   alongside the existing resume family in
   `apps/tamma-elsa/src/Tamma.ElsaServer/Endpoints/` accepts a run-completion callback (auth
   per the existing webhook/HMAC path), recomputes the bookmark name via
   `LifecycleBookmarks.ForAgentRun`, resumes, and returns **404** when no matching bookmark/row
   exists, **409** on an ambiguous/duplicate match, principal-folded so one principal cannot
   resume another's run. It is the same resume the webhook path uses, exposed as an endpoint
   for retries/manual reconciliation.

4. **Poll fallback reconciled to be durable — with a named owner and multi-pod safety.** The
   existing poll path (`AgentMonitorService.PollAsync`, `AgentMonitorService.cs:162`) is
   repurposed as a **durable reconciler**: it reads `pending` rows past a threshold, polls
   `GET runs/{id}` via the mediated API, and if terminal resumes the bookmark the same way the
   webhook does — so a missed webhook self-heals without a live in-process poll loop. No
   `pending` row is left dangling past the row's timeout.

   *Corrected — the earlier AC said "a periodic sweep (or the 40-2 `DelayFor` wake)" and named
   no owner, which is not implementable as written.* The owner is a **`BackgroundService`
   hosted in `Tamma.Api`** (the host that has the stores and the mediated GitHub reads), with
   **Postgres advisory-lock leader election** following the landed
   `HourlyAnalyticsRollupScheduler` (`Tamma.ElsaServer/Workflows/HourlyAnalyticsRollupScheduler.cs`):
   the `IRollupSchedulerLeaderLock` / `PostgresAdvisoryLeaderLock` shape over
   `SELECT pg_try_advisory_lock(@k)`, an options section with an `Enabled` flag, and a poll
   interval. **Do not copy that scheduler's lock key**: `ComputeAdvisoryLockKey(year,
   dayOfYear, hour)` has no principal component, so one tenant's leader would suppress every
   other principal's sweep. This reconciler's key folds the principal (tenant id / user id) so
   sweeps are concurrent across principals and serialized within one.

   *Falsifiable:* a test starts two reconciler instances against the same store and asserts
   exactly one resume per row; a second test asserts two **different** principals sweep
   concurrently (both acquire their lock) — a global lock key fails the second test.
   The reconciler is registered in **both** hosts (`Tamma.Api` for SaaS, `Tamma.ElsaServer` for
   single-user), so no mode is left without a sweep. **If that dual registration is not built,
   drop AC4 and the reconciler from the story** and state plainly that a missed webhook is
   recovered only by 40-2's `DelayFor` timeout edge; a reconciler nobody hosts is worse than
   none, because AC8's "no dangling row" would silently never run.

5. **Cross-pod delivery proven.** A test simulates the split: dispatch (suspend) on
   "instance/pod A", deliver the webhook on "instance/pod B" (a *second* host/service over the
   *same* store), and assert the workflow resumes correctly on B. The in-memory registry is NOT
   consulted for correctness.

6. **In-memory registry demoted, not required.** `WebhookSignalRegistry` may remain as a
   same-process fast-path (resume immediately without a store round-trip when the waiter is
   local), but correctness no longer depends on it: with the registry unwired, the durable path
   still resumes. The `AgentMonitorService` webhook/Auto/Poll mode logic is updated so "Webhook
   mode without the in-memory registry" is no longer a hard failure.

7. **Principal-folded and installation-scoped.** The row match and the bookmark name both fold
   the principal (tenant id in SaaS; the sole user in single-user, where
   `LifecycleBookmarks.Compose` normalizes a null tenant to its `none` segment rather than
   colliding) **and** the installation id, preserving the review-finding-5 cross-tenant guard,
   so two principals sharing an `owner/repo` + branch cannot resume each other's runs.
   *Falsifiable:* a scoping test feeds principal A's completion payload against principal B's
   pending row and asserts no resume and no row mutation.

8. **Fail-loud, exactly-once resume.** A webhook matching an already-`received` row is a no-op
   (idempotent redelivery — GitHub redelivers). A resume of an already-burned bookmark is a
   logged no-op, not an error. A row with no resolvable bookmark after its timeout emits a loud
   diagnostic event and marks `timed_out` (the 40-2 `Timeout` edge handles the workflow side).

## Technical Notes

- **Elsa's bookmark store is the backplane — do not build a message bus.** The cross-pod
  delivery is achieved by resuming a persisted bookmark, which any pod can do against the shared
  DB. The signal row only supplies the missing `session_id`/`bookmark_name`; it is not a queue.
- **Keep the installation-id scoping.** `AgentWebhookSignalKey` already folds `installation_id`
  (review-finding-5); the persisted row must carry it and the match must use it, or the
  cross-tenant guard regresses.
- **Redelivery is expected.** GitHub redelivers webhooks; the `received` status + burned-bookmark
  no-op make resume idempotent (AC8).
- **The reconciler replaces the live poll loop, not the discover phase.** Discovery of the run id
  (dispatch returns 204 with no run URL) still happens; the *waiting* is durable now.
- **This story widens a documented boundary.** `IAgentDispatchMediationService`'s own XML doc
  says the inbound `workflow_run.completed` webhook + `WebhookSignalRegistry` signalling "stay
  in-process and are out of scope". That comment becomes stale here and must be updated in the
  same change, or the next reader will re-derive the in-memory design.

## Dependencies

- **Story 40-2 — HARD.** The durable bookmark this story resumes; the `ForAgentRun` name
  contract and completion payload shape are shared (lockstep). Blocking. Step "write the
  pending row" is a **cross-story edit on the API side**, not on 40-2's activity — see AC1.
- **Story 39-10 (`LifecycleBookmarks`) — LANDED.** *Corrected: previously "HARD (via 40-2)".*
  The name builder (`Compose` `LifecycleBookmarks.cs:38`) exists and is what the resume
  recomputes.
- **Story 39-8 — LANDED, mirrored not consumed.** *Corrected: previously "SOFT … can proceed
  against `DesignResumeEndpoint` if 39-8 is not yet in".*
  `Tamma.ElsaServer/Endpoints/DocumentDecisionResumeEndpoint.cs` is on disk; it is the
  404/409 + principal-fold shape to copy.
- **Existing (verified):** `InstallationRouterService.HandleWorkflowRunEvent`
  (`:377` — synchronous today, see AC2), `AgentMonitorService` (poll loop → reconciler),
  `AgentDispatchMediationService` (mediated `GET runs/{id}`; also the new row-write site),
  Elsa 3 persistent bookmark runtime + EF store, `TenantDbContext` **and**
  `ControlPlaneDbContext` (both needed — see AC1).
- **Decided (was open): the AC4 reconciler is hosted in both processes.** Its class lives in
  `Tamma.Activities`, the only assembly both hosts reach (`Tamma.ElsaServer` does not reference
  `Tamma.Api`), so SaaS sweeps from `Tamma.Api` and a self-hosted single-user install sweeps
  from `Tamma.ElsaServer` — which registers `ControlPlaneDbContext`, exactly where single-user
  rows live. See the plan's D8.

## Estimated Effort

7-9 days — *raised from 5-7 by the corrections above: two migrations instead of one
(dual-scoped storage), an API-side row-write path, and a real hosted reconciler with leader
election. If the epic's schedule cannot absorb it, split the AC4 reconciler into its own story
rather than shrinking the estimate.*

## Delivery Record (2026-11-06)

Built on Story 40-2 (`story/40-2-wait-for-agent-run`, PR #518). **GitHub Actions runs now resume
from the `workflow_run.completed` webhook** instead of always taking 40-2's ~35-min `Timeout` edge.

**Flow.** Engine `WaitForAgentRunActivity` sends `bookmarkName` + `workflowInstanceId` +
`bookmarkTenantId` on the mediated dispatch → Tamma.Api writes the `agent_run_waits` row on a
successful trigger → the webhook (any pod, no ambient tenant) resolves the principal from the
installation, finds the pending row by `(installation_id, repository, head_branch)`, and POSTs the
engine's `AgentRunResumeEndpoint`, which recomputes the name, claims the bookmark, and runs the
instance with the 40-2 `AgentRunCompletionSignal` payload → the row moves `pending → received` (CAS).

**Built**
- `Tamma.Data/Entities/AgentRunWait.cs` + `TammaModelConfiguration.ConfigureAgentRunWaits` (mapped in
  `TenantDbContext` and `ControlPlaneDbContext`): `ck_agent_run_waits_principal_xor`,
  `ck_agent_run_waits_status` (`pending|received|timed_out`), unique
  `(TenantId, UserId, Repository, BranchName, SessionId)` NULLS NOT DISTINCT, index
  `(InstallationId, Repository, BranchName, Status)`.
- **Migrations (two):** `Migrations/Tenant/20261107021946_AddAgentRunWaits` (TenantDbContext — joins
  the tenant chain after `20260729070033_AddDocumentInstanceAudience`) and
  `Migrations/ControlPlane/20261107021953_AddAgentRunWaits`. Generated with `dotnet ef migrations add`
  against the design-time factories; both snapshot diffs are additive only.
- `Tamma.Data/Repositories/IAgentRunWaitRepository` + `AgentRunWaitRepository` — parallel user/tenant
  planes, no join; the tenant plane takes the tenant id explicitly (never `ITenantContext`). Re-dispatch
  under the same session re-arms the one row; `TryMarkReceived*` is a single conditional UPDATE.
- `Tamma.Api/Services/AgentDispatch/AgentRunWaitRecorder` — the API-side writer, called by
  `AgentDispatchMediationService.TriggerRunCoreAsync` on both success arms. SaaS → tenant row (bookmark
  must be folded with the dispatching tenant); single-user → sole-user CP row (no tenant needed). A name
  that is not `ForAgentRun` of the request is refused. Never throws: a missing row degrades to `Timeout`.
- `Tamma.Api/Services/AgentDispatch/AgentRunResumer` — principal from the installation (SaaS) or the sole
  user (single-user); D2 pick (latest dispatched ≤ run `created_at`, tie ⇒ skip); stored-vs-recomputed
  name guard; engine 200/202/404 ⇒ received, 409/5xx ⇒ stays pending. Emits `AGENT_RUN.RECEIVED` /
  `AGENT_RUN.RESUME_UNRESOLVED` (local constants pinned to 40-6's `AgentRunWaitEventTypes`, same wire strings).
- `InstallationRouterService.HandleWorkflowRunEvent` → `HandleWorkflowRunEventAsync`: durable resume
  first-class, in-memory `PublishSignal` kept as a fast path; no longer skips when the registry is unwired.
- `Tamma.ElsaServer/Endpoints/AgentRunResumeEndpoint` (`POST /elsa/api/agent-runs/resume`,
  `RequireAuthorization`): 400 malformed, 409 name drift / ambiguous / instance mismatch, 202 + buffer on a
  bookmark miss, atomic claim, 404 on a lost claim, restore-on-failure. Never mutates caller input.
- `Tamma.ElsaServer/Handlers/ReconcileBufferedAgentRunHandler` — `WorkflowBookmarksPersisted` handler that
  resumes a buffered completion once the `agent-run-*` bookmark is persisted (reconcile-after-persist).
- Contract: `bookmarkName`/`workflowInstanceId`/`bookmarkTenantId` on `AgentDispatchRunApiRequest` and
  `DispatchAgentRunRequest`; `AgentExecutionRequest` carries them; `WaitForAgentRunActivity` fills them.
- AC6: `AgentMonitorService` Webhook mode without the registry now polls instead of `monitor_failed`;
  `WebhookSignalRegistry` / `IAgentDispatchMediationService` / `AgentDispatchEndpoints` docs updated.

**Deviations**
- **AC4 (hosted reconciler) split out — not built.** Per the story's own lever. Delivering it needs a
  per-principal sweep over every tenant schema plus leader election; it is a story of its own
  (proposed **40-3b — durable agent-run reconciler**). Until it lands, *a missed webhook is recovered only
  by 40-2's `DelayFor` `Timeout` edge*, and rows whose webhook never arrives stay `pending` (the
  `timed_out` status exists in the CHECK but nothing writes it yet — AC8's "mark `timed_out`" goes with 40-3b).
- **Resumer lives in Tamma.Api, not Tamma.Activities.** The webhook and both row planes are in Tamma.Api;
  the bookmark is resumed over the existing authenticated Api→engine hop (the `PrMergedWebhookHandler` →
  `PrMergedResumeEndpoint` precedent). Tamma.Api has no Elsa runtime of its own.
- **Extra column `BookmarkTenantId`.** In single-user mode the engine may fold the personal tenant id (or
  `none`) into the name while the row's principal is the user; storing the segment lets the resume side
  recompute and byte-compare the name (D3 drift guard) in both modes.
- **AC3 auth** is the Elsa admin key (`RequireAuthorization`), like every engine resume seam — the endpoint
  is engine-internal and not reachable from the public webhook path. No Tamma.Api mutating route was
  added, so the governance catalogue is unchanged.
- **202 (buffered) marks the row `received`.** The engine buffer + post-persist handler + the activity's
  reconcile timer complete it in-process; an engine restart inside that seconds-wide window falls to
  `Timeout` (40-3b would close it).
- **AC5** is proven at the API layer: the row is written through one composition ("pod A") and the webhook
  delivered through a separately composed one ("pod B", fresh DbContexts, registry unwired) over the same
  real Postgres. Elsa's cross-process bookmark resume itself is 40-7's integration test.

**Tests**
- `AgentRunWaitRepositoryTests` (Testcontainers, 10): pending→received round trip, re-arm on re-dispatch,
  installation-folded match — each on both planes (single-user with a null tenant); planes never join;
  principal-XOR enforced by Postgres; cross-pod webhook resume + idempotent redelivery on both planes.
  It caught a real bug (a stale tracked row made re-arm a no-op on the CP plane).
- `AgentRunResumerTests` (15), `AgentRunWaitRecorderTests` (8), `InstallationRouterWorkflowRunResumeTests`
  (8), `AgentDispatchMediationServiceTests` (+4).
- `AgentRunResumeEndpointTests` (13), `ReconcileBufferedAgentRunHandlerTests` (3),
  `WaitForAgentRunActivityTests` (+1), `AgentDispatchServiceTests` (+1), `AgentMonitorServiceTests` (AC6 rewrite).

## Change Log

| Date       | Version | Changes                | Author |
| ---------- | ------- | ---------------------- | ------ |
| 2026-07-23 | 1.0.0   | Initial story creation | Claude |
| 2026-07-24 | 1.1.0   | Code-verified revision: AC1 storage changed from tenant-scoped/engine-written to dual-scoped (tenant schema + control plane) and written API-side, because the engine host registers no `ITenantDbContextFactory` and single-user mode has no tenant principal; AC2 notes the webhook path is tenant-free and the handler is synchronous today; AC4 given a real owner (hosted `BackgroundService` with principal-folded advisory-lock leader election, registered in both hosts) with an explicit "drop it otherwise" clause; 39-8 and 39-10 recorded as landed; effort re-estimated 5-7 → 7-9 days | Claude |
| 2026-11-06 | 1.2.0   | Implemented (AC1-3, AC5-8; AC4 reconciler split to a follow-up); delivery record added; Status → review | Claude |
