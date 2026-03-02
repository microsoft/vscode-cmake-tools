#!/usr/bin/env bash
# Run `yarn install` with retries and exponential-ish backoff.
#
# CI installs dependencies from the private Azure Artifacts mirror
# (pkgs.dev.azure.com/azure-public/VisualCpp/_packaging/cpp_PublicPackages). Under load that feed
# intermittently returns "429 Too Many Requests", which fails an otherwise-healthy build. This only
# happens on a node_modules cache miss (e.g. a lockfile bump), so retrying the install a few times
# with backoff lets the transient throttle clear instead of failing the whole job.
#
# Any arguments are forwarded verbatim to `yarn install` (e.g. --frozen-lockfile --ignore-scripts).
# Invoke as: bash ./.github/scripts/yarn-install.sh [yarn install args...]
set -uo pipefail

attempts="${YARN_INSTALL_ATTEMPTS:-5}"
sleep_base="${YARN_INSTALL_RETRY_SLEEP_BASE:-15}"

for attempt in $(seq 1 "$attempts"); do
  if yarn install "$@"; then
    exit 0
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::yarn install failed after ${attempt} attempts (transient Azure Artifacts feed throttling?)"
    exit 1
  fi
  wait_s=$(( attempt * sleep_base ))
  echo "::warning::yarn install failed (attempt ${attempt}/${attempts}); retrying in ${wait_s}s..."
  sleep "$wait_s"
done
