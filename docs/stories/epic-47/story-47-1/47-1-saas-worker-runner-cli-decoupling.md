# Story 47-1: SaaS Worker Runner CLI Decoupling

Status: drafted

## User Story

As a **SaaS release engineer**, I want a dedicated headless `@tamma/worker-runner` for the worker image and GitHub Actions job, so that the public CLI can move to TammaDesktop while cloud workers continue processing jobs.

## Priority

P0 / Phase S1

## Scope

Extract the headless service and `process-issue` entry points used by `docker/Dockerfile.ts` and `.github/workflows/tamma-worker.yml`. Preserve the SaaS dispatch contract while both entry points coexist during S1.

## Acceptance Criteria

1. A clean Docker build of the `tamma-engine` target and its final image run without the CLI package. Valid configuration initializes the worker, produces the expected health signal, and shuts down cleanly on SIGTERM. Incomplete configuration yields an unhealthy or failed worker.
2. The checked-in worker workflow resolves an immutable runner artifact or builds the runner at the checked-out revision. A fixture dispatch passes installation, issue, and workflow identifiers to the runner. The current SaaS receiver accepts the status and terminal result, and the runner preserves the job's exit outcome.
3. The workflow uses the GitHub App credential for the dispatched installation and the configured Tamma API endpoint for status and result reporting. Tests cover installation mismatches, failure, absent optional workflow ID, and duplicate terminal reporting, with credentials absent from logs.
4. Public CLI commands still build and pass compatibility smoke tests during S1. Release evidence lists remaining production CLI consumers and the story that removes each.

## Dependencies

- Can run in parallel with 47-2. Coordinate edits to the CLI command registry.
- Blocks 47-9 CLI removal. Supply runner smoke evidence to 47-10.

## Estimated Effort

4–6 days

## Dev Notes

`start.tsx` writes `/tmp/tamma-engine-healthy` even when service configuration is incomplete. `process-issue.ts` and the workflow's `Report Result` step can both report terminal results. The worker sends `success`/`failure` and the shell can send `skipped`. `SaaSEndpoints.PostWorkflowResult` accepts `completed`/`failed`/`cancelled`. `callback_url` is required on dispatch, while the current result POST targets `TAMMA_API_URL`.

[Implementation plan](./implementation-plan.md)
