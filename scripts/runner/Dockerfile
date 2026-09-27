# The self-hosted CI runner: GitHub's own runner image (Ubuntu 24.04), plus
# what `ubuntu-latest` ships that check.yml leans on and this image does not.
# Copied from abvthecity/linklater's scripts/runner, so both repos run CI the
# same way.
# Built and run by `scripts/runner/runner.sh`.
FROM ghcr.io/actions/actions-runner:2.337.0

# The Playwright the lockfile pins. Only its `install-deps` is used here, for
# the shared libraries Chromium needs; the browser itself is still downloaded
# by check.yml's own step, into the job's cache, as it is on a hosted runner.
ARG PLAYWRIGHT_VERSION=1.63.0

USER root

# shellcheck: actionlint lints `run:` scripts with it when it is on PATH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends shellcheck xz-utils zstd \
  && rm -rf /var/lib/apt/lists/*

# Chromium's shared libraries, through a throwaway Node that is deleted in the
# same layer. check.yml's setup-node installs the Node the jobs actually use.
RUN set -eu; \
  arch="$(dpkg --print-architecture)"; case "$arch" in amd64) arch=x64 ;; esac; \
  v="$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v24."))][0].version')"; \
  curl -fsSL "https://nodejs.org/dist/$v/node-$v-linux-$arch.tar.xz" | tar -xJ -C /tmp; \
  PATH="/tmp/node-$v-linux-$arch/bin:$PATH" npx -y "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium; \
  rm -rf /tmp/node-* /root/.npm; \
  rm -rf /var/lib/apt/lists/*

# setup-node's downloads land here, on a volume every runner shares, so an
# ephemeral container does not fetch Node again for every job.
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache
RUN mkdir -p /opt/hostedtoolcache && chown runner:runner /opt/hostedtoolcache

COPY --chown=runner:runner --chmod=755 entrypoint.sh /home/runner/entrypoint.sh
USER runner
ENTRYPOINT ["/home/runner/entrypoint.sh"]
