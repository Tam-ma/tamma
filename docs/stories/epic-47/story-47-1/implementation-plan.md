# Implementation Plan — Story 47-1: SaaS Worker Runner CLI Decoupling

## Scope & Deliverable

Extract the headless service and `process-issue` entry points used by `docker/Dockerfile.ts` and `.github/workflows/tamma-worker.yml`. Preserve the SaaS dispatch contract while both entry points coexist during S1. Completion evidence is mapped to the [story acceptance criteria](./47-1-saas-worker-runner-cli-decoupling.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [docker/Dockerfile.ts](../../../../docker/Dockerfile.ts)
- [.github/workflows/tamma-worker.yml](../../../../.github/workflows/tamma-worker.yml)
- [packages/cli/src/index.tsx](../../../../packages/cli/src/index.tsx)
- [packages/cli/src/commands/start.tsx](../../../../packages/cli/src/commands/start.tsx)
- [packages/cli/src/commands/process-issue.ts](../../../../packages/cli/src/commands/process-issue.ts)
- [packages/cli/src/worker/result-callback.ts](../../../../packages/cli/src/worker/result-callback.ts)
- [apps/tamma-engine/src/index.ts](../../../../apps/tamma-engine/src/index.ts)
- [packages/orchestrator/src/saas-coordinator.ts](../../../../packages/orchestrator/src/saas-coordinator.ts)
- [apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/LocalExecutor.cs](../../../../apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/LocalExecutor.cs)
- [apps/tamma-elsa/src/Tamma.Api/Endpoints/SaaSEndpoints.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Endpoints/SaaSEndpoints.cs)
- [apps/tamma-elsa/tests/Tamma.Api.Tests/SaaS/SaaSEndpointsIntegrationTests.cs](../../../../apps/tamma-elsa/tests/Tamma.Api.Tests/SaaS/SaaSEndpointsIntegrationTests.cs)

## Design Decisions

- **D1 — Two headless entry points.** Create `packages/worker-runner` with service and `process-issue` entry points. Reuse shared config, platform, provider and orchestration packages. Keep interactive setup and local auth discovery with the CLI. `apps/tamma-engine/src/index.ts` configures a standalone PAT engine and is a separate caller to classify.
- **D2 — One terminal result owner.** Let the runner report terminal status for started jobs. Translate legacy `success`/`failure`/`skipped` outcomes to the receiver's `completed`/`failed`/`cancelled` contract. Preserve issue and installation correlation using the DTO fields and its `Result` payload. If pre-launch failures need a workflow fallback, scope it to that case and test duplicate delivery at the receiver. Keep the dispatch input contract through S1 and send authenticated callbacks to the configured trusted API origin.
- **D3 — Compatible image contract.** Retain the image target, non-root user, `tini`, and health sentinel where Compose needs them. Clear stale readiness on startup and shutdown. Write the sentinel after successful initialization.

## Implementation Steps

1. Trace dispatch inputs and the `SaaSEndpoints.UpdateWorkflowStatus` and `PostWorkflowResult` receivers. Capture fixture payloads, exit codes, timeout and missing-config behavior. Inventory `LocalExecutorOptions.DefaultCliEntryPoint`, `execute-agent`, and publishing/install paths for 47-8 and 47-9.
2. Create the package manifest, TypeScript build and lockfile entry. Move the headless execution and reporting seams. Keep the CLI registry compatible while 47-2 ships.
3. Replace the CLI manifest copy, build filter, runtime files and command in `docker/Dockerfile.ts`. Build with frozen dependencies and verify final stage contents exclude CLI source, links and bundles.
4. Switch `tamma-worker.yml` to the checked-out runner build or an immutable version. Verify the minted App token and repository belong to the dispatched installation before processing the issue. Pass credentials and IDs explicitly and apply D2 result ownership.
5. Exercise both launch paths from clean builds and record before/after results. Retain the prior image digest and workflow revision for S1 rollback.

## Data & Migrations

No database migration. Keep dispatch arguments and workflow IDs stable. Validate callback JSON against the live receiver's DTO and retain the existing callback format for any public CLI compatibility path that still needs it. Update the workspace lockfile together with the package manifest.

## Events

Keep `WorkerResultCallback` progress and terminal reporting through `/api/v1/workflows/{workflowId}/status` and `/api/v1/workflows/{workflowId}/result`. Preserve correlation and failing exit codes.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Port `packages/cli/src/commands/start-service-mode.test.ts` for valid startup, missing config, sentinel lifecycle and SIGTERM.
- Port `packages/cli/src/commands/process-issue.test.ts` and `packages/cli/src/worker/result-callback.test.ts` with fake App/API endpoints. Assert destination, installation mismatch denial, terminal ownership and absent workflow ID. Add an API receiver contract test using `SaaSEndpointsIntegrationTests.cs` to prove each new result is accepted.
- Run a clean image build and fixture worker dispatch. Verify final image contents, valid and invalid configurations, and CLI compatibility.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 2–3, 5 | Clean image and lifecycle smoke |
| AC 2–3 | 1, 4–5 | Dispatch, callback and failure fixtures |
| AC 4 | 1–2, 5 | CLI smoke and consumer inventory |

## Risks & Mitigations

- **Image and workflow drift.** Exercise both launch paths against the same runner revision before switching production.
- **Duplicate or misrouted results.** Assert trusted destination and one logical terminal result per workflow run, including pre-launch failures.
- **Elsa still launches the CLI.** Complete the `LocalExecutor` handoff in 47-8 and require a CLI-free build in 47-9.
