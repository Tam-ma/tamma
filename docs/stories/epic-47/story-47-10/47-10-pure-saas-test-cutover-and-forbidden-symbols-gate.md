# Story 47-10: Pure SaaS Test Cutover and Forbidden Symbols Gate

Status: drafted

## User Story

As a **SaaS maintainer**, I want CI and a rehearsed migration runbook to enforce the cutover, so that tenant isolation regressions and reintroduced single-user paths are caught before deployment.

## Priority

P0 / Phase S4

## Scope

Reconcile the 74 matched baseline test files across the API, Activities and Platforms integration suites, add pure SaaS invariants, extend the `forbidden-symbols` check, and publish the operator runbook.

## Acceptance Criteria

1. All 74 baseline test paths have a recorded disposition with owning story, surviving suite and coverage evidence. SaaS coverage survives retired mode tests, and affected tests are discovered in the full CI shard matrix with refreshed weights and no stale entries for removed classes.
2. Production-host tests fail startup on missing/invalid CP, JWT or KEK configuration. Two-tenant integration tests prove auth, settings, provider credentials, work data and billing cannot cross tenants. Historic audit data and surviving work resume through supported SaaS entry points.
3. The CI gate rejects reintroductions of `TammaMode`, `ITammaModeProvider`, `TammaModeProvider`, `SingleUser`, `SoleUserProvider`, `EnsurePersonalTenantMiddleware` and the null billing/quota shims in production. Tests prove detection in production code and relevant deployment settings, and prove archived event fixtures and historical docs remain usable.
4. The migration runbook documents S1–S4 gates, D1 verified import, startup settings, rollback checkpoints, wait/backlog reconciliation, CLI handoff, and sign-offs. A staging rehearsal proves the runbook from an old fixture through pure SaaS and records the restore boundary.

## Dependencies

- Stories 47-1 through 47-9 supply component validation and test dispositions. Inventory and draft runbook can begin in S1. Final enforcement and sign-off wait for S4 cleanup.

## Estimated Effort

6–9 days

## Dev Notes

The 74-file figure is the architecture audit result at `b37f1031`. Track each path's disposition and discover new callers from the delivery revision. `ci/check-forbidden-symbols.sh` currently scans `apps/` and `packages/`, with exclusions and a separate fallback path.

[Implementation plan](./implementation-plan.md)
