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

## S1 release evidence

The `tamma-engine` image runs the headless service as UID 1001 under tini. Run `packages/worker-runner/test/smoke-image.sh <image>` against a locally built target. The Docker smoke checks exercised startup with a repository binding, SIGTERM during a pending GitHub request, readiness removal, and startup without a binding. An unbound service stays idle and unhealthy. For the App-backed Compose service, set the repository variables `TAMMA_GITHUB_OWNER`, `TAMMA_GITHUB_REPO`, and `TAMMA_GITHUB_INSTALLATION_ID` alongside the existing App credentials. The default coding agent uses the `ANTHROPIC_API_KEY` secret.

The worker workflow checks out the triggering SHA in Tam-ma/tamma. Installed tenant copies check out the immutable upstream commit recorded in the template. Update that pin when distributing a new runner. The runner compares the dispatched installation ID to the token action's installation ID before selecting the issue. The checked-out issue repository supplies the working directory. A tracked job posts progress and one terminal result to the configured Tamma API. Pre-launch failures remain visible in Actions and expire through the coordinator timeout.

Verification for 47-10 includes the compiled process fixture with local GitHub and Tamma HTTP endpoints, the worker lifecycle and dispatch tests, the Postgres-backed API receiver tests for all three terminal states, and the five bundled public CLI smoke checks. The fixture uses synthetic credentials and a closed issue. No hosted tenant job or billable model invocation is required to run it.

| Remaining S1 consumer | Handoff |
| --- | --- |
| Elsa `LocalExecutorOptions.DefaultCliEntryPoint` launches `packages/cli/dist/index.js execute-agent` | 47-8 replaces the local executor path before CLI removal. |
| Public commands, `install.sh`, npm publishing, standalone binaries, and Homebrew in the release workflow | 47-9 removes SaaS-side distribution after the desktop handoff. |
| CLI bundle and compatibility checks in CI | 47-9 retires these checks with the package. |
| `apps/tamma-engine` directly constructs a standalone PAT engine | A separate local-engine caller for the 47-8 / 47-9 cleanup. |

For S1 rollback, restore the worker workflow from `f3a1c8ff1ee93afcdf4fe89bd83e8c7643d032a9` and select the corresponding published image `ghcr.io/tam-ma/tamma-engine@sha256:4de1abdb7b0a029fb866486910f7a6654288327768d64d4b0293220645f0a26c`. [Pre-cutover image build](https://github.com/Tam-ma/tamma/actions/runs/45914803138/job/140231343205)
