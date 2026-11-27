# Story 47-9: Dashboard, CLI and Deployment Pure SaaS Cleanup

Status: drafted

## User Story

As a **SaaS administrator**, I want the dashboards and deployment artifacts to reflect SaaS permissions and packaging, so that people get the right controls and local installations can continue through TammaDesktop.

## Priority

P1 / Phase S4

## Scope

Remove dashboard single-user toggles and role fallbacks, remove `packages/cli` after D1 handoff, and prune single-user Docker/Compose and release/install wiring. Preserve the SaaS runner, services and platform UI.

## Acceptance Criteria

1. `dashboard` removes the single-user assignee source and copy. `dashboard-user` never offers model editing or plan changes based on an empty membership role. Existing authorized SaaS roles still receive the intended controls.
2. After D1 import verification and CLI consumer clearance, `packages/cli` and the SaaS repo's CLI build, release and installer dependencies are removed or updated to point to the supported handoff. From a clean checkout, workspace install, typecheck and artifacts succeed without a CLI package.
3. Docker/Compose removes verified single-user engine, config and volume dependencies while a supported SaaS topology builds and passes health and routed flow smoke checks. `@tamma/worker-runner` and the SaaS workflows remain usable.
4. Current repo guidance and templates communicate pure SaaS operation and the Desktop handoff. Earlier published CLI releases and the export/import instructions remain discoverable for operators following the migration runbook.

## Dependencies

- 47-1 validates both runner paths. 47-2 and TammaDesktop D1 verify export/import and own the CLI handoff. 47-8 clears live waits and CLI-bound executors.
- Coordinate Tracker response scope with 47-5 and CI cleanup with 47-10.

## Estimated Effort

5–8 days

## Dev Notes

The concrete UI cases are `AssigneePicker`, `AssignableSource`, `ModelSettingsPage` and `PlanPricingPage`. `LocalExecutorOptions.DefaultCliEntryPoint` is an independent packaging dependency that 47-8 clears.

[Implementation plan](./implementation-plan.md)
