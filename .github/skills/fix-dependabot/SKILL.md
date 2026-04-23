---
name: fix-dependabot
description: >
  Use when asked about Dependabot dependency bump PRs. This skill explains why
  Dependabot PRs break and directs to the automated workflow for fixing them.
  Triggers: "dependabot", "dependency bump", "fix dependabot PR", "rebase dependabot".
---

# Handling Dependabot PRs

## Why Dependabot PRs break

This repository resolves npm packages through an Azure DevOps Artifacts feed:

```
registry=https://pkgs.dev.azure.com/azure-public/VisualCpp/_packaging/cpp_PublicPackages/npm/registry/
```

Dependabot PRs bump versions in `package.json` and `yarn.lock`. They break when:

1. The branch falls behind `main` → rebase needed
2. `yarn.lock` has merge conflicts → must regenerate with Azure feed URLs
3. Regenerating `yarn.lock` requires Azure feed authentication

## How to fix: use the workflow

**Do NOT attempt to fix Dependabot PRs manually or with URL patching.**

Use the GitHub Actions workflow instead — it resolves packages directly from the
Azure feed with proper authentication:

1. Go to **Actions** → **Fix Dependabot PR** → **Run workflow**
2. Enter the Dependabot PR number
3. The workflow rebases, regenerates `yarn.lock` via the Azure feed, validates, and pushes

Workflow file: [`.github/workflows/fix-dependabot.yml`](../../workflows/fix-dependabot.yml)

## Security rules

- `.npmrc` must always point to the Azure DevOps feed — never modify it
- All `resolved` URLs in `yarn.lock` must point to the Azure feed
- Only the Dependabot-targeted package(s) should change in `package.json`
- Use `--ignore-scripts` when running `yarn install` on dependency updates

See [SECURITY.md](SECURITY.md) for the full threat model.

## If the workflow is unavailable

If you must fix a Dependabot PR without the workflow (e.g., locally with Azure
feed auth configured), the essential steps are:

```bash
git fetch origin main && git rebase origin/main
# If yarn.lock conflict: git checkout origin/main -- yarn.lock && git add yarn.lock && git rebase --continue
yarn install --ignore-scripts
git checkout origin/main -- .npmrc
git add package.json yarn.lock && git push --force-with-lease
```

This only works if you have Azure feed authentication configured locally
(e.g., via `npx vsts-npm-auth -config .npmrc` or a PAT).

---

*See also: [`copilot-setup-steps.yml`](../../workflows/copilot-setup-steps.yml) for Copilot agent environment setup.*
