#!/usr/bin/env bash
# Run `yarn install` with retries and exponential-ish backoff.
#
# Keep dependency restores on Azure Artifacts; retries allow transient feed throttling to clear.
# Authentication failures require fixing feed access, not switching to a public registry.
#
# Any arguments are forwarded verbatim to `yarn install` (e.g. --frozen-lockfile --ignore-scripts).
# Invoke as: bash ./.github/scripts/yarn-install.sh [yarn install args...]
set -uo pipefail

azure_registry="https://pkgs.dev.azure.com/azure-public/VisualCpp/_packaging/cpp_PublicPackages/npm/registry/"

attempts="${YARN_INSTALL_ATTEMPTS:-5}"
sleep_base="${YARN_INSTALL_RETRY_SLEEP_BASE:-15}"

for attempt in $(seq 1 "$attempts"); do
  if yarn install "$@" --registry "$azure_registry"; then
    exit 0
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::yarn install failed after ${attempts} attempts; check the errors above for Azure Artifacts feed access or availability issues."
    exit 1
  fi
  wait_s=$(( attempt * sleep_base ))
  echo "::warning::yarn install failed (attempt ${attempt}/${attempts}); retrying in ${wait_s}s..."
  sleep "$wait_s"
done
