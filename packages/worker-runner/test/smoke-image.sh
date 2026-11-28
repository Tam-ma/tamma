#!/usr/bin/env bash
# Run against the built tamma-engine target, e.g. smoke-image.sh tamma-engine:local
set -euo pipefail
image=${1:?Pass the locally built tamma-engine image}
containers=()
cleanup() {
  for id in "${containers[@]}"; do docker rm -f "$id" >/dev/null; done
}
trap cleanup EXIT

check_worker() {
  local expected=$1 id state
  shift
  id=$(docker run -d --network none --health-interval=1s --health-start-period=1s \
    --health-retries=1 "$@" "$image")
  containers+=("$id")
  for ((i=0; i<50; i++)); do
    state=$(docker inspect -f '{{.State.Health.Status}}' "$id")
    [[ $state == "$expected" ]] && break
    sleep 0.2
  done
  [[ $state == "$expected" ]]
  docker exec "$id" sh -ec '
    test "$(id -u)" = 1001
    test ! -e /app/packages/cli
    test -z "$(find /app -path "*/@tamma/cli")"
    claude --version
  '
  docker stop -t 8 "$id" >/dev/null
  [[ $(docker wait "$id") == 0 ]]
  if docker cp "$id:/tmp/tamma-engine-healthy" - >/dev/null 2>&1; then
    echo "Readiness file survived shutdown" >&2
    return 1
  fi
  if docker logs "$id" 2>&1 | grep -F 'fixture-installation-secret' >/dev/null; then
    echo "Worker logged its GitHub credential" >&2
    return 1
  fi
}

check_worker unhealthy
check_worker healthy -e GITHUB_TOKEN=fixture-installation-secret \
  -e TAMMA_GITHUB_OWNER=fixture -e TAMMA_GITHUB_REPO=project
