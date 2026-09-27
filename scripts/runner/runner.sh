#!/usr/bin/env bash
#
# Run check.yml's jobs on this machine, in Linux containers:
#
#   scripts/runner/runner.sh up       # build the image, start RUNNER_COUNT runners (4)
#   scripts/runner/runner.sh down     # stop and remove them
#   scripts/runner/runner.sh status   # the containers, and what GitHub sees
#   scripts/runner/runner.sh logs     # follow the runners' output
#   scripts/runner/runner.sh hosted   # send CI back to GitHub's runners
#   scripts/runner/runner.sh local    # send CI to these runners
#
# `up` hands the containers `gh auth token`, which each one spends on a
# registration token and then drops before it takes a job.
set -euo pipefail
cd "$(dirname "$0")"
repo=abvthecity/snowflakes

case "${1:-status}" in
  up)
    GH_TOKEN="$(gh auth token)" docker compose up -d --build --remove-orphans
    ;;
  down)
    docker compose down
    ;;
  status)
    docker compose ps
    echo
    echo "CI_RUNNER=$(gh variable get CI_RUNNER --repo "$repo" 2>/dev/null || echo '(unset: ubuntu-latest)')"
    gh api "repos/$repo/actions/runners" --jq '.runners[] | "\(.name)\t\(.status)\tbusy=\(.busy)"'
    ;;
  logs)
    docker compose logs -f --tail 50
    ;;
  hosted)
    gh variable delete CI_RUNNER --repo "$repo"
    ;;
  local)
    gh variable set CI_RUNNER --repo "$repo" --body snowflakes
    ;;
  *)
    sed -n '3,12p' "$0" >&2
    exit 64
    ;;
esac
