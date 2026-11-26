# Story 47-8: Remove Deployment Mode and Local PAT Fallbacks

Status: drafted

## User Story

As a **SaaS workflow operator**, I want Git and workflow execution to require verified tenant routing, so that cutover removes local fallbacks and preserves live workflow progress.

## Priority

P0 / Phase S4

## Scope

Remove `DeploymentMode`, `SingleUserPlatformOptions`, legacy routing inputs and local config PAT fallback. Reconcile existing `agent_run_waits` and Elsa bookmarks before removing their routing or executable dependencies.

## Acceptance Criteria

1. `DeploymentMode` and `SingleUserPlatformOptions` are absent from production. Tenant Git operations resolve the correct persisted installation, an installation for another tenant is rejected, and missing installation fails even with a local PAT configured.
2. New ADL/cycle/deployment runs carry verified tenant scope and do not select execution by legacy `dev` or `business` tokens. Prod deployment tests exercise `effect:deploy.prod` allowed, human-required, denied and missing-policy decisions.
3. Before old routing is removed, an operator report reconciles pending legacy `agent_run_waits` against Elsa bookmarks and workflow state. Drained or deliberately resolved legacy waits have documented terminal outcomes, and remaining supported tenant waits resume exactly once by the correct tenant path.
4. Cloud dispatch stays on supported executors with no dependency on the public CLI. Historic event/audit records with legacy tags remain readable, and Git App installation, runner scaffolding and verified webhook flows still pass.

## Dependencies

- Requires 47-3 through 47-7 for SaaS-only service composition. Begin wait inventory and drain coordination before S2 where 47-4 removes legacy identity lookup.
- Requires 47-1 runner validation before retiring CLI-bound cloud dispatch. Blocks 47-9 deletion and 47-10 final gate.

## Estimated Effort

7–10 days

## Dev Notes

`LocalExecutorOptions.DefaultCliEntryPoint` still points into `packages/cli`. `AgentExecutorFactory` can select `LocalExecutor` separately from the GitHub Actions path. Preserve the current `effect:deploy.prod` action decision and distinguish historical workflow tags from live routing inputs.

[Implementation plan](./implementation-plan.md)
