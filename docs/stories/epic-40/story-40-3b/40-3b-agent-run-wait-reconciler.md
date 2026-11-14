# Story 40-3b: Agent-Run Wait Reconciler

Status: done

## User Story

As a **platform operator**, I want an agent run whose `workflow_run.completed` webhook never
arrives to be recovered by polling, and a wait that never completes to be closed out, so that a
dropped webhook costs a few minutes, not a timed-out task, and no `agent_run_waits` row stays
`pending` forever.

## Origin

Split out of Story 40-3 (its AC4 and AC8's "mark `timed_out`") on 2026-11-06. Until this story,
a missed webhook was recovered only by 40-2's durable `DelayFor` deadline (the task then fails
and escalates), and rows whose webhook never came stayed `pending`.

## Acceptance Criteria

1. **Polls stale waits.** A `BackgroundService` (`AgentRunWaitReconciler`, Tamma.Api) sweeps every
   `AgentRuns:Reconciler:IntervalSeconds` (120). It reads `pending` rows dispatched more than
   `StaleAfterMinutes` (10) ago and looks each run up through the mediated discover call (the
   tenant's own driver; never a platform-specific client).
2. **Recovers finished runs exactly once.** A finished run resumes the wait through the webhook's
   own `IAgentRunResumer` (same drift guard, same `pending → received` CAS, same engine claim),
   with `wakePath = poll`, which the engine records on `AGENT_RUN.RECEIVED`.
3. **Closes dead waits.** A row still pending `TimeOutAfterMinutes` (60, above the engine's 35-minute
   deadline) after dispatch is marked `timed_out` (CAS) and an `AGENT_RUN.RESUME_UNRESOLVED`
   (`detail = no_completion_before_deadline`) is recorded. A finished run is resumed even past the
   limit — late beats lost.
4. **Multi-pod safe, per principal.** Each principal's sweep runs under a Postgres session advisory
   lock whose key folds the principal (`tenant:{id}` / `user:{id}`) — two pods never sweep the same
   principal; different principals sweep concurrently. Rows are read only under the lock.
5. **Both modes.** SaaS sweeps every active tenant schema (the `ChannelOutboxRepository` fan-out;
   an unreachable schema is skipped). Single-user sweeps the control-plane user plane.
6. **Fail-soft and governed.** One failing wait or tenant never stops the sweep; every lock taken
   is released. Catalogued as `automation:agent-run-wait-reconciler` (machinery); `Enabled=false`
   turns the loop off.

## Decisions

- **Hosted in Tamma.Api only.** 40-3's AC4 asked for both hosts. The rows, the mediated reads and
  the resumer all live in Tamma.Api, which runs in both modes, so one host covers both. Hosting it
  in the engine would need a second copy of the row plane and the GitHub reads.
- **Wake path on the completion record**, not a new resumer parameter, so the existing callers and
  Moq setups are untouched.
- **Discovery filtered to the agent's run (fix, 2026-11-07).** Discovery used to take the newest run
  of *any* workflow on the branch, so the repo's CI (started by the agent's push, after the dispatch)
  could be resumed as the agent's result. `ListWorkflowRunsRequest` now takes an optional
  `WorkflowFileName` + `Event`; `DiscoverRunAsync` asks for `workflow_dispatch` runs of the wait's
  stored workflow file (GitHub: the workflow-scoped runs endpoint; Gitea: server-side event filter +
  client-side path check; GitLab: `capability_unsupported`, surfaced as a discovery failure). The
  discovered run's path and event are passed to the resumer, which now always requires them (plus the
  dispatch-time guard) and refuses when either is missing. Consequence: on GitLab the reconciler can no
  longer recover a wait (it times out instead), because a GitLab pipeline cannot be identified as the
  agent's.

## Tests

- `AgentRunWaitReconcilerTests` — the decision matrix (finished / running / not found / failed
  lookup / limit boundary; the limit outlives the engine deadline) and the sweep (resume with
  `poll`, time out + event, CAS loser records nothing, locked principal skipped while others
  sweep, one failure does not stop the rest, single-user plane, stale cutoff).
- `AgentRunWaitRepositoryTests` (real Postgres) — stale listing and `timed_out` CAS per plane,
  tenant fan-out skipping an unreachable schema, and the lock: one holder per principal, released
  on dispose, two principals at once.
- `AgentRunResumerTests` — the wake path reaches the engine (`webhook` default, `poll`, unknown → `webhook`).
