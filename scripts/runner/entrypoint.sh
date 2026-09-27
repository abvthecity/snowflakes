#!/usr/bin/env bash
#
# Register one ephemeral runner, take one job, exit. Docker's restart policy
# brings the container straight back, and this registers it afresh: every job
# starts from a runner nobody has run anything in.
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN is unset; start the runners with scripts/runner/runner.sh}"
: "${RUNNER_REPO:?}"

cd /home/runner
# A restarted container keeps its filesystem; the last job's registration and
# work tree go before the next one is made.
rm -rf _work .runner .credentials .credentials_rsaparams

token="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${RUNNER_REPO}/actions/runners/registration-token" | jq -r .token)"

./config.sh --unattended --ephemeral --replace \
  --url "https://github.com/${RUNNER_REPO}" \
  --token "$token" \
  --name "${RUNNER_NAME_PREFIX:-snowflakes}-$(hostname)" \
  --labels "${RUNNER_LABELS:-snowflakes}" \
  --work _work

# The owner's token registers the runner and nothing else: a job never sees it.
unset GH_TOKEN token
exec ./run.sh
