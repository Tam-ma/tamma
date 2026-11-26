# Implementation Plan — Story 47-10: Pure SaaS Test Cutover and Forbidden Symbols Gate

## Scope & Deliverable

Reconcile the 74 matched baseline test files across the API, Activities and Platforms integration suites, add pure SaaS invariants, extend the `forbidden-symbols` check, and publish the operator runbook. Completion evidence is mapped to the [story acceptance criteria](./47-10-pure-saas-test-cutover-and-forbidden-symbols-gate.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [.github/workflows/forbidden-symbols.yml](../../../../.github/workflows/forbidden-symbols.yml)
- [ci/check-forbidden-symbols.sh](../../../../ci/check-forbidden-symbols.sh)
- [ci/forbidden-symbols.txt](../../../../ci/forbidden-symbols.txt)
- [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)
- [.github/scripts/dotnet-test-shard.py](../../../../.github/scripts/dotnet-test-shard.py)
- [.github/scripts/dotnet-test-weights.json](../../../../.github/scripts/dotnet-test-weights.json)
- [apps/tamma-elsa/Tamma.sln](../../../../apps/tamma-elsa/Tamma.sln)
- [apps/tamma-elsa/tests/Tamma.Api.Tests/Middleware/TenantContextMiddlewareTests.cs](../../../../apps/tamma-elsa/tests/Tamma.Api.Tests/Middleware/TenantContextMiddlewareTests.cs)
- [apps/tamma-elsa/tests/Tamma.Api.Tests/AgentDispatch/AgentRunWaitReconcilerTests.cs](../../../../apps/tamma-elsa/tests/Tamma.Api.Tests/AgentDispatch/AgentRunWaitReconcilerTests.cs)
- [apps/tamma-elsa/tests/Tamma.Platforms.IntegrationTests/Fixtures/EngineFullStackFixture.cs](../../../../apps/tamma-elsa/tests/Tamma.Platforms.IntegrationTests/Fixtures/EngineFullStackFixture.cs)
- [apps/tamma-elsa/tests/Tamma.Platforms.IntegrationTests/GiteaEngineDrivenE2ETests.cs](../../../../apps/tamma-elsa/tests/Tamma.Platforms.IntegrationTests/GiteaEngineDrivenE2ETests.cs)

## Design Decisions

- **D1 — Auditable test disposition.** Freeze the baseline query and generate a manifest. Tag files as converted, superseded by named scenarios, or removed as mode-only. Record fixture-only callers as well as test classes. Compare test discovery and TRX results, and refresh shard weights after the final suite.
- **D2 — Targeted CI rules.** Match exact former symbols, selectors, and legacy literals in active production source and deployment config. Include the 47-8 `DeploymentMode` and `SingleUserPlatformOptions` symbols and old mode configuration keys. Extend scan roots where the guard misses workflow/Docker configuration. Keep existing secret rules effective. Match equivalent files in ripgrep and fallback branches and surface scanner errors. Preserve read-only archival compatibility narrowly, with explicit fixtures and no broad exemptions.
- **D3 — Operator runbook with checkpoints.** Document required inputs and expected outcomes for every phase, a pinned release/export path, staged validation for SaaS traffic, and approved rollback or backup restoration. Require D1 and legacy wait evidence before removing the applicable production paths.

## Implementation Steps

1. Run the baseline command below. Assign each path to the owner in 47-3 through 47-9 or to this suite cleanup. Reconcile changes from baseline to the release revision.
2. Port affected fixtures to embed explicit test-only SaaS settings and service fakes. Replace mode matrices with two-tenant, allowed/denied, and dependency-failure cases. Retire obsolete tests after documenting retained coverage.
3. Run `dotnet test apps/tamma-elsa/Tamma.sln`, the CI shard plan and TS/dashboard tests. Capture TRX, confirm class discovery, regenerate weights with `dotnet-test-shard.py weights --trx <run>.trx`, and verify shard coverage.
4. Update patterns and scan roots in the existing forbidden-symbols workflow. Add negative and positive scanner fixtures covering both backends, real deployment settings and historic-read exceptions. Run the GitHub check in CI.
5. Write the migration runbook under this epic when implementing the story. Cover preconditions, backups and archive trust, D1 evidence, required deployment settings, staged rollout/probes, wait reconciliation, holder sign-offs, worker distribution and rollback boundaries. Rehearse with a legacy dataset and a current SaaS deployment.

Baseline inventory command from the architecture audit

```sh
git grep -ilE 'TammaMode\.SingleUser|ITammaModeProvider|SoleUserProvider|EnsurePersonalTenantMiddleware|NullBillingProvider' b37f1031 -- apps/tamma-elsa/tests
```

## Data & Migrations

No schema changes. Rehearse backups and restore with sanitized fixtures for both database planes plus Elsa state. Keep historic DCB and audit payloads readable through migration and rehearsed recovery.

## Events

No new event family. Pin historic record deserialization and supported SaaS event attribution in regression tests. Record cutover evidence outside production streams.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Collect baseline and release test inventories, confirm coverage for all mapped cases, and check removed classes and new tests against the CI matrix.
- Run process-level config failure cases and a two-tenant matrix for governance, provider settings/credentials, billing, trackers and work data. Reuse a tenant resume fixture plus a historic audit fixture.
- Inject each forbidden identifier into a scratch production fixture and a relevant legacy selector into deployment config. Verify CI fails as intended. Historical Markdown and audit fixtures pass. Exercise both scan backends and scanner-error handling.
- Run the runbook in staging and capture D1 archive verification, drain report, healthy SaaS probes and rehearsed rollback or restore evidence.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 1–3 | 74-path disposition and complete CI/TRX discovery |
| AC 2 | 2–3, 5 | Startup, isolation, audit and resume regression runs |
| AC 3 | 4 | Forbidden-symbols self-tests and green CI |
| AC 4 | 5 | Runbook and staged sign-offs |

## Risks & Mitigations

- **Deleting the mode matrix shrinks coverage.** Diff discovered tests and link each removed path to a replacement or explicit retirement reason.
- **The scanner silently misses production paths.** Test backend parity, Docker/workflow coverage and command errors. Keep exceptions narrow.
- **Operators cross the recovery boundary without evidence.** Put backups, D1 import and zero unresolved legacy waits before their respective activation steps.
