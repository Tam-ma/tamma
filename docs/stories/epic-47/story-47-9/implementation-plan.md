# Implementation Plan — Story 47-9: Dashboard, CLI and Deployment Pure SaaS Cleanup

## Scope & Deliverable

Remove dashboard single-user toggles and role fallbacks, remove `packages/cli` after D1 handoff, and prune single-user Docker/Compose and release/install wiring. Preserve the SaaS runner, services and platform UI. Completion evidence is mapped to the [story acceptance criteria](./47-9-dashboard-cli-and-deployment-pure-saas-cleanup.md) below.

## Pre-Reading

- [docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md](../../../../docs/architecture/SAAS-PURE-EXTRACTION-DESIGN.md)
- [packages/dashboard/src/components/work/AssigneePicker.tsx](../../../../packages/dashboard/src/components/work/AssigneePicker.tsx)
- [packages/dashboard/src/services/tracker/tracker-api-client.ts](../../../../packages/dashboard/src/services/tracker/tracker-api-client.ts)
- [packages/dashboard-user/src/pages/models/ModelSettingsPage.tsx](../../../../packages/dashboard-user/src/pages/models/ModelSettingsPage.tsx)
- [packages/dashboard-user/src/pages/settings/PlanPricingPage.tsx](../../../../packages/dashboard-user/src/pages/settings/PlanPricingPage.tsx)
- [packages/cli/package.json](../../../../packages/cli/package.json)
- [apps/tamma-engine/src/index.ts](../../../../apps/tamma-engine/src/index.ts)
- [package.json](../../../../package.json)
- [pnpm-workspace.yaml](../../../../pnpm-workspace.yaml)
- [pnpm-lock.yaml](../../../../pnpm-lock.yaml)
- [install.sh](../../../../install.sh)
- [.github/workflows/release.yml](../../../../.github/workflows/release.yml)
- [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)
- [.github/workflows/tamma-worker.yml](../../../../.github/workflows/tamma-worker.yml)
- [docker/Dockerfile.ts](../../../../docker/Dockerfile.ts)
- [docker/docker-compose.yml](../../../../docker/docker-compose.yml)
- [docker/docker-compose.override.yml](../../../../docker/docker-compose.override.yml)
- [docker/docker-compose.prod.yml](../../../../docker/docker-compose.prod.yml)
- [docker/docker-compose.test.yml](../../../../docker/docker-compose.test.yml)
- [docker/.env.example](../../../../docker/.env.example)
- [CLAUDE.md](../../../../CLAUDE.md)
- [README.md](../../../../README.md)

## Design Decisions

- **D1 — UI follows verified role and scope.** Retain authorized SaaS controls and show read-only state while role information is missing or loading. Deploy compatible client readers before removing the legacy Tracker wire value from servers if old and new revisions overlap.
- **D2 — Evidence before removal.** Record the D1 import and CLI distribution handoff, current SaaS runner smoke results, and 47-8 clearance. Keep a documented legacy installer/export release pointer without republishing local tooling from the SaaS release workflow.
- **D3 — Compose by consumer.** Verify each service, volume, env and health dependency against production, development and CI. Prune local-only entries after identifying their last consumer, and preserve SaaS dependencies including worker, database and dashboard services.

## Implementation Steps

1. Remove role-empty UI authorization from the two user-dashboard pages. Remove the Tracker single-user display and type after the compatible rollout window, and update affected fixtures.
2. Search tracked workspace manifests, lockfile, TS project refs, Docker, scripts, CI and release publication for CLI and local engine references. Classify `apps/tamma-engine` as a standalone PAT entry point, inventory actual consumers and retire its local-only build wiring after handoff.
3. Confirm D1 and 47-8 evidence. Remove `packages/cli` and dependent workspace entries, regenerate the lockfile and update release/installer entry points and active guidance, including `CLAUDE.md`'s Operating Modes instructions.
4. Prune verified single-user Docker/Compose settings and stale legacy config, preserving 47-1's SaaS worker image where used. Validate rendered Compose files and the resulting build, startup, health and end-to-end routes.
5. Run the CI build/package matrix and stage dashboards against a supported SaaS revision. Re-run worker and workflow smoke checks.

## Data & Migrations

No application schema migration. Preserve existing local volumes through the export/rollback window. Prune obsolete volume declarations after consumers are removed and record ownership of retained backups.

## Events

No new events. Confirm frontend activity reads, worker callback and SaaS dispatch still use their existing event contracts.

## TDD Test Plan

Add the regression assertions against the current implementation, then run them against the cutover behavior.

- Update `ModelSettingsPage.test.tsx` and `PlanPricingPage.test.tsx` to prove empty or loading roles cannot mutate. Test retained owner/admin paths and Tracker response compatibility.
- Run clean `pnpm install --frozen-lockfile`, workspace typecheck and dashboard builds. Smoke release workflow inputs and inspect worker/image artifacts for CLI dependencies.
- Validate each supported Compose combination and run staging smoke for startup, tenant login and worker dispatch.

## Definition of Done

| Acceptance criterion | Implementation steps | Verification |
|---|---|---|
| AC 1 | 1, 5 | Dashboard permission and Tracker fixtures |
| AC 2 | 2–3, 5 | D1 handoff and clean build evidence |
| AC 3 | 2, 4–5 | Compose and SaaS worker smoke |
| AC 4 | 3 | Current docs and preserved release/export pointers |

## Risks & Mitigations

- **An installer or release step still reaches the removed package.** Audit install, publish, binary and Homebrew consumers before deletion and run clean package builds.
- **Dashboard rollout mixes incompatible responses.** Stage a reader-compatible release and verify both old and new service revisions.
- **A shared volume or worker is removed with local services.** Require a topology inventory, current backups and a staging deployment smoke.
