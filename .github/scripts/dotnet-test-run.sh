#!/usr/bin/env bash
# Runs one slice of the C# test suite for the CI matrix (.github/workflows/ci.yml).
#
#   dotnet-test-run.sh other          every test project EXCEPT Tamma.Api.Tests and
#                                     Tamma.Platforms.IntegrationTests
#   dotnet-test-run.sh api <I> <N>    shard I of N of Tamma.Api.Tests
#
# Run from apps/tamma-elsa, after a Release build. Kept from the old single job:
#   * --blame-hang: a test host that will not exit is named and its threads
#     dumped instead of the job dying silently;
#   * a per-project loop with a PROJECT-FAILED marker and a final recap, so the
#     failing project is never pushed out of the retrievable log window;
#   * failed test names pulled from the .trx (each WebApplicationFactory start
#     floods stdout, so the "Failed <test>" console line is easy to lose).
set -uo pipefail

mode="${1:?usage: dotnet-test-run.sh other | api <shard> <total>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
logs=/tmp/test-logs
mkdir -p "$logs"

rc=0
failed=""

run_project() {
  # $1 = project dir, remaining args = extra `dotnet test` arguments
  local proj="$1"; shift
  local name; name="$(basename "$proj")"
  echo "::group::$name"
  if dotnet test "$proj" --no-build -c Release --verbosity minimal --logger trx \
       --blame-hang --blame-hang-timeout 8m "$@" > "$logs/$name.log" 2>&1; then
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
      esac
      run_project "$proj"
    done
    ;;
  api)
    shard="${2:?shard index required}"
    total="${3:?shard total required}"
    dll=tests/Tamma.Api.Tests/bin/Release/net8.0/Tamma.Api.Tests.dll
    list="$logs/api-tests.txt"
    dotnet vstest "$dll" --ListFullyQualifiedTests --ListTestsTargetPath:"$list" > /dev/null
    # Prove the partition before running anything: every class in exactly one shard.
    python3 "$script_dir/dotnet-test-shard.py" check --tests "$list" --total "$total"
    filter="$(python3 "$script_dir/dotnet-test-shard.py" filter --tests "$list" --shard "$shard" --total "$total")"
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
