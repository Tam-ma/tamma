#!/usr/bin/env bash
# Runs one slice of the C# test suite for the CI matrix (.github/workflows/ci.yml).
#
#   dotnet-test-run.sh other          every test project EXCEPT Tamma.Api.Tests and
#                                     Tamma.Platforms.IntegrationTests
#   dotnet-test-run.sh api <I> <N>    shard I of N of Tamma.Api.Tests
#   dotnet-test-run.sh workflow-exec  the full-runtime Elsa workflow suites in
#                                     Tamma.Activities.Tests (NUnit category
#                                     WorkflowExecution, ~1.5 min); `other` skips them
#
# Run from apps/tamma-elsa, after a Release build. Kept from the old single job:
#   * --blame-hang: a test host that will not exit is named and its threads
#     dumped instead of the job dying silently;
#   * a per-project loop with a PROJECT-FAILED marker and a final recap, so the
#     failing project is never pushed out of the retrievable log window;
#   * failed test names pulled from the .trx (each WebApplicationFactory start
#     floods stdout, so the "Failed <test>" console line is easy to lose).
#
# COVERAGE=1 also collects line/branch coverage (coverlet, settings in
# coverage.runsettings). Each project writes
# tests/<project>/TestResults/<guid>/coverage.cobertura.xml; the CI
# `coverage-report` job merges every slice's files. Adds ~25-40% to test time on
# the 2-core CI runners (see the dotnet-tests-slice comment in ci.yml).
#
# No `set -e`: a failing project must not stop the loop or the recap. Steps
# whose failure must fail the job check their exit status explicitly.
set -uo pipefail

mode="${1:?usage: dotnet-test-run.sh other | workflow-exec | api <shard> <total>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
logs=/tmp/test-logs
mkdir -p "$logs"

rc=0
failed=""

coverage_args=()
if [ "${COVERAGE:-0}" = "1" ]; then
  coverage_args=(--collect "XPlat Code Coverage" --settings coverage.runsettings)
fi

run_project() {
  # $1 = project dir, remaining args = extra `dotnet test` arguments
  local proj="$1"; shift
  local name; name="$(basename "$proj")"
  echo "::group::$name"
  if dotnet test "$proj" --no-build -c Release --verbosity minimal --logger trx \
       --blame-hang --blame-hang-timeout 8m ${coverage_args[@]+"${coverage_args[@]}"} "$@" > "$logs/$name.log" 2>&1; then
    tail -4 "$logs/$name.log"
  else
    echo "PROJECT-FAILED: $name"
    failed="$failed $name"
    rc=1
  fi
  echo "::endgroup::"
}

case "$mode" in
  other)
    for proj in tests/*/; do
      case "$(basename "$proj")" in
        # Sharded separately (the `api` mode).
        Tamma.Api.Tests) continue ;;
        # Owned by git-platform-integration-tests.yml (per-PR on platform paths,
        # nightly, and the run-gitea-e2e / run-gitlab-integration labels). The old
        # single CI job only ever SKIPPED it: its docker probe timed out on a
        # runner busy with 16 minutes of API-test containers. On an idle slice
        # docker answers, the full engine E2E starts, and it hung the job.
        Tamma.Platforms.IntegrationTests) continue ;;
        # Its full-runtime workflow suites run in the `workflow-exec` slice.
        Tamma.Activities.Tests)
          run_project "$proj" --filter "TestCategory!=WorkflowExecution"
          continue ;;
      esac
      run_project "$proj"
    done
    ;;
  workflow-exec)
    run_project tests/Tamma.Activities.Tests/ --filter "TestCategory=WorkflowExecution"
    ;;
  api)
    shard="${2:?shard index required}"
    total="${3:?shard total required}"
    dll=tests/Tamma.Api.Tests/bin/Release/net8.0/Tamma.Api.Tests.dll
    list="$logs/api-tests.txt"
    if ! dotnet vstest "$dll" --ListFullyQualifiedTests --ListTestsTargetPath:"$list" > "$logs/api-list.log" 2>&1; then
      echo "::error::listing Tamma.Api.Tests failed"
      tail -50 "$logs/api-list.log"
      exit 1
    fi
    # Prove the partition before running anything: every listed test is matched
    # by exactly one shard's real --filter string.
    if ! python3 "$script_dir/dotnet-test-shard.py" check --tests "$list" --total "$total"; then
      echo "::error::shard partition check failed"
      exit 1
    fi
    if ! filter="$(python3 "$script_dir/dotnet-test-shard.py" filter --tests "$list" --shard "$shard" --total "$total")"; then
      echo "::error::computing the filter for shard $shard/$total failed"
      exit 1
    fi
    # `dotnet test --filter ""` would run the whole project in every shard.
    if [ -z "$filter" ]; then
      echo "::error::empty filter for shard $shard/$total"
      exit 1
    fi
    run_project tests/Tamma.Api.Tests/ --filter "$filter"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac

echo "==== TEST RECAP ===="
if [ "$rc" -ne 0 ]; then
  echo "FAILED PROJECTS:$failed"
  for n in $failed; do
    echo "---- FAILED TESTS IN $n (from .trx) ----"
    trx=$(find "tests/$n/TestResults" -maxdepth 1 -name '*.trx' -printf '%T@ %p\n' \
      2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [ -n "$trx" ]; then
      tr '<' '\n' < "$trx" \
        | grep 'UnitTestResult ' \
        | grep 'outcome="Failed"' \
        | grep -oE 'testName="[^"]*"' \
        | sed 's/^/  FAILED: /' \
        || echo "  (no Failed results in .trx — likely a host/hang exit)"
    else
      echo "  (no .trx found)"
    fi
    echo "---- OUTPUT OF FAILED PROJECT $n (tail 200) ----"
    tail -200 "$logs/$n.log"
  done
else
  echo "ALL PROJECTS PASSED"
fi
exit "$rc"
