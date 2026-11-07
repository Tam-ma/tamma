# Coverage in CI — how it works and what bit

**Date:** 2026-11-06 · PR #522

## How it works

- Every `.NET Tests (<slice>)` job runs with `COVERAGE=1`, which makes
  `.github/scripts/dotnet-test-run.sh` add
  `--collect "XPlat Code Coverage" --settings coverage.runsettings`.
  Each project writes `tests/<project>/TestResults/<guid>/coverage.cobertura.xml`,
  uploaded as artifact `coverage-<slice>`.
- `apps/tamma-elsa/coverage.runsettings` skips generated code **at instrumentation
  time** (`**/Migrations/*.cs`, `*.Designer.cs`, `*ModelSnapshot.cs`, `[GeneratedCode]`)
  and auto-properties. That makes the run faster and the cobertura file smaller
  (33 MB → 9 MB for one API shard).
- The `Coverage report` job merges all slices with ReportGenerator 5.4.1.
  `.github/scripts/coverage-summary.py` writes the job summary and a sticky PR
  comment (marker `<!-- tamma-coverage-report -->`), and runs the ratchet against
  `.github/coverage-floor.json`.
- The ratchet runs only when every slice passed **and** every slice uploaded. A
  partial merge reads low and must never fail a PR.
- `TypeScript coverage` is a separate job with `continue-on-error`. It is not part
  of `TypeScript Tests` (see the pitfalls below).

## Pitfalls

1. **Coverlet costs much more on CI than locally.** Locally (M-series Mac) one API
   shard went 123 s → 136 s (+10%). On 2-core GitHub runners the Test step went up
   25–40%, which pushed 12-shard slices to 5–5.3 min. Going to 16 shards fixed it.
   Always check per-step timings in CI before trusting a local overhead number.
2. **Don't run two coverlet collections of the same test project in parallel on one
   machine.** They corrupt each other's instrumentation: `BadImageFormatException`
   in `OneTimeSetUp`, or a shard silently writes no cobertura file. Run them one
   after another locally. In CI each shard is its own runner, so it's fine.
3. **The root `vitest.config.ts` has 80/75/85/80 coverage thresholds.** Any
   `--coverage` run from the root fails on them, because the legacy packages are
   below. For report-only runs pass `--coverage.thresholds.{lines,branches,functions,statements}=0`.
   Also pass `--coverage.reportOnFailure`; otherwise one failing test means no
   report at all.
4. **Instrumentation breaks timing-sensitive TS tests.**
   `packages/intelligence/src/indexer/__tests__/file-watcher.test.ts` waits a fixed
   300 ms for an `fs.watch` event. Under coverage on macOS it failed every time, and
   without coverage it failed now and then. That is why TS coverage does not gate CI.
5. **The root TS run lists dashboard files at 0%.** Its `coverage.include` is
   `packages/*/src/**/*.ts`, but dashboard and dashboard-user run under their own
   configs. `ts-coverage-summary.py` takes `pkg=path` arguments: a report given that
   way owns that package's rows.
6. **Dashboard is 57% (lines), not ~81%.** Under its own config (vitest 4, v8)
   coverage includes every file the tests load, `.tsx` included: 5,350 lines.
   Large areas are at 0%: knowledge-base hooks, org and tenant admin pages,
   ConventionEditor.
7. **Node 25 breaks the dashboard tests locally** (`window.localStorage.clear is not
   a function`; Node's own `localStorage` shadows jsdom's). CI uses Node 22. Run
   them locally with `npx -y node@22 node_modules/vitest/vitest.mjs run`.
8. **`find dir -maxdepth 1 -name 'coverage-*'` matches `dir` itself** when `dir` is
   `coverage-in`. Use `-mindepth 1`.
