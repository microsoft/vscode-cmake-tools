#!/usr/bin/env bash
# Run `yarn install` with retries and exponential-ish backoff.
#
# yarn.lock points to the Azure Artifacts mirror, which can return "401 Unauthorized" in CI.
# Rewrite its resolved URLs to the public Yarn registry for the install, then restore the lockfile.
#
# Any arguments are forwarded verbatim to `yarn install` (e.g. --frozen-lockfile --ignore-scripts).
# Invoke as: bash ./.github/scripts/yarn-install.sh [yarn install args...]
set -uo pipefail

azure_registry="https://pkgs.dev.azure.com/azure-public/VisualCpp/_packaging/cpp_PublicPackages/npm/registry/"
public_registry="https://registry.yarnpkg.com/"
lockfile_backup=

restore_lockfile() {
  if [ -n "$lockfile_backup" ]; then
    cp -p "$lockfile_backup" yarn.lock
    rm -f "$lockfile_backup"
  fi
}
trap restore_lockfile EXIT

if grep -Fq "$azure_registry" yarn.lock; then
  lockfile_backup="$(mktemp)"
  cp -p yarn.lock "$lockfile_backup" || exit 1
  rewritten_lockfile="$(mktemp)"
  sed "s|${azure_registry}|${public_registry}|g" yarn.lock > "$rewritten_lockfile" || exit 1
  cat "$rewritten_lockfile" > yarn.lock || exit 1
  rm -f "$rewritten_lockfile"
fi

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
