# Implementation Plan — Story 47-8: Remove Deployment Mode and Local PAT Fallbacks

## Scope & Deliverable

Remove `DeploymentMode`, `SingleUserPlatformOptions`, legacy routing inputs and local config PAT fallback. Reconcile existing `agent_run_waits` and Elsa bookmarks before removing their routing or executable dependencies. Completion evidence is mapped to the [story acceptance criteria](./47-8-remove-deployment-mode-and-local-pat-fallbacks.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [apps/tamma-elsa/src/Tamma.Core/Deployment/DeploymentMode.cs](../../../../apps/tamma-elsa/src/Tamma.Core/Deployment/DeploymentMode.cs)
- [apps/tamma-elsa/src/Tamma.Platforms/PlatformResolver.cs](../../../../apps/tamma-elsa/src/Tamma.Platforms/PlatformResolver.cs)
- [apps/tamma-elsa/src/Tamma.Platforms/SingleUserPlatformOptions.cs](../../../../apps/tamma-elsa/src/Tamma.Platforms/SingleUserPlatformOptions.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Webhooks/Registration/WebhookRegistrationStartupService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Webhooks/Registration/WebhookRegistrationStartupService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/Runner/RunnerScaffoldService.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/Runner/RunnerScaffoldService.cs)
- [apps/tamma-elsa/src/Tamma.Api/Program.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Program.cs)
- [apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/DeploymentPipelineWorkflow.cs](../../../../apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/DeploymentPipelineWorkflow.cs)
- [apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/SingleIssueCycleWorkflow.cs](../../../../apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/SingleIssueCycleWorkflow.cs)
- [apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/AdlOrchestratorWorkflow.cs](../../../../apps/tamma-elsa/src/Tamma.ElsaServer/Workflows/AdlOrchestratorWorkflow.cs)
- [apps/tamma-elsa/src/Tamma.Activities/ADL/DispatchCycleActivity.cs](../../../../apps/tamma-elsa/src/Tamma.Activities/ADL/DispatchCycleActivity.cs)
- [apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentExecutorFactory.cs](../../../../apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentExecutorFactory.cs)
- [apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/LocalExecutor.cs](../../../../apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/LocalExecutor.cs)
- [apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/WaitForAgentRunActivity.cs](../../../../apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/WaitForAgentRunActivity.cs)
- [apps/tamma-elsa/src/Tamma.Data/Entities/AgentRunWait.cs](../../../../apps/tamma-elsa/src/Tamma.Data/Entities/AgentRunWait.cs)
- [apps/tamma-elsa/src/Tamma.Data/Repositories/AgentRunWaitRepository.cs](../../../../apps/tamma-elsa/src/Tamma.Data/Repositories/AgentRunWaitRepository.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/AgentDispatch/AgentRunResumer.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/AgentDispatch/AgentRunResumer.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/AgentDispatch/AgentRunWaitReconciler.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/AgentDispatch/AgentRunWaitReconciler.cs)
- [apps/tamma-elsa/src/Tamma.Api/Services/AgentDispatch/AgentRunWaitRecorder.cs](../../../../apps/tamma-elsa/src/Tamma.Api/Services/AgentDispatch/AgentRunWaitRecorder.cs)
- [.github/workflows/tamma-agent.yml](../../../../.github/workflows/tamma-agent.yml)

## Design Decisions

- **D1 — Installation-backed routing.** Use verified tenant, installation and repository scopes and the landed App drivers. Remove local config synthesis from `PlatformResolver` and local-option startup webhook registration. Preserve authorized tenant credential and webhook verification paths.
- **D2 — Deployment and executor authority.** Carry tenant, correlation and repository scope through `DispatchCycleActivity` and workflow inputs. Keep the `effect:deploy.prod` policy decision and explicit approval input. Preserve `ProductionGateAutomates` behavior for enforced denials, human-required and unavailable decisions, and explicitly configured observe-only decisions. Remove `LocalExecutor` cloud wiring when its dependencies have moved to TammaDesktop.
- **D3 — Drain before removal.** Stop admission only for legacy-bound runs. Keep compatible workers for existing bookmarks or deliberately resolve them using supported cancel/timeout/re-entry operations. Reconcile both PostgreSQL planes and Elsa state by persisted run ID, workflow version, bookmark name, tenant and routing key. Preserve tenant-scoped in-flight work and historic events.

## Implementation Steps

1. Inventory CP and tenant wait rows plus actual Elsa bookmarks. Match executor, workflow version, routing keys, installation and pending states. Compare row/bookmark inventories in both directions and surface unmatched or ambiguous state for operator resolution.
2. Stop new legacy dispatches. Let compatible workers drain or apply supported terminal/re-entry operations with a documented outcome for each outstanding run. Capture backups and a zero unresolved legacy-waits checkpoint before symbol and routing removal. Verify the checkpoint again immediately before switching traffic.
3. Remove `DeploymentMode` and legacy input forwarding from ADL, issue cycle and deployment workflows. Coordinate workflow versions with active instances. Verify the production effect decision controls the same deploy and approval boundaries.
4. Delete `SingleUserPlatformOptions`, local config PAT synthesis and dependent wiring, including startup webhook registration that relied on these options. Confirm installation-backed webhook and runner-scaffolding flows.
5. Remove remaining CLI-bound executor/config dependencies from production dispatch. Rehearse a rolling upgrade with webhook/poller races on a supported tenant wait and verify historical audit/final workflow state.

## Data & Migrations

Retain wait and bookmark history. Reconcile `AgentRunWait.BookmarkName`, `BookmarkTenantId` and `WorkflowFile` with actual Elsa instances before retirement. Use supported workflows to close or replay work. Directly renaming bookmarks or rewriting archived mode tags would break correlation and is excluded.

## Events

Preserve `AgentRunWaitEventTypes` wake and timeout tracking and existing `DEPLOY.*` semantics and correlations. Historic mode metadata is interpreted only as audit data.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Extend `PlatformResolverTests.cs` with missing installation plus legacy config, wrong-tenant installation and healthy App routes.
- Exercise ADL/cycle inputs, production effect decisions, approval signals and the explicit observe-only case. Verify no cloud executor resolves the CLI entry point.
- Build on `AgentRunWaitRecorderTests.cs`, `AgentRunWaitReconcilerTests.cs` and `AgentRunResumerTests.cs`. Seed matched and unmatched legacy waits/bookmarks, supported tenant waits, duplicate webhook/poll results and restart/timeout cases.
- Rehearse rolling upgrade with historic `mode` metadata and prove audit reads and existing scoped runs still work.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 1, 4–5 | Installation fixtures and production symbol sweep |
| AC 2 | 3, 5 | Workflow routing and deploy decision matrix |
| AC 3 | 1–3, 5 | Drain checkpoint and mixed-version resume tests |
| AC 4 | 4–5 | Executor independence, webhook and historic read smoke |

## Risks & Mitigations

- **A wait is missed because only one store was queried.** Inventory both database planes and Elsa bookmark storage. Make unmatched entries a stop condition.
- **Replay duplicates a deployment.** Complete or re-enter at supported workflow boundaries and test duplicate webhook/poll delivery.
- **An older definition still needs deleted inputs.** Keep compatible workflow workers until all affected instances reach a supported boundary.
