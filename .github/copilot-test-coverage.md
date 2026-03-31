---
description: "Instructions for the Copilot coding agent when working on test-coverage issues."
applyTo: "test/unit-tests/**/*.ts"
---

# Test Coverage Agent — Self-Audit Protocol

You are improving test coverage for `microsoft/vscode-cmake-tools`.
This file contains mandatory protocol. Read all of it before writing code.

## Step 1 — Orient before writing

- Read every source file you will test in full
- Read existing tests for that module (if any) in `test/unit-tests/`
- Identify every exported function, class, and branch condition
- Do **not** write tests for private implementation details — test the public API

## Step 2 — Write real tests, not stubs

Every test must:
- Have a descriptive name: `'expandString handles undefined variable in preset context'`
- Assert exactly one logical behavior per `test()` block
- Not depend on side effects from another test
- Use `assert.strictEqual` / `assert.deepStrictEqual` over loose equality
- For async code: `await` and assert the resolved value — never `.then()`

## Step 3 — Run the full self-audit before opening the PR

```bash
# 1. Type-check test files
npx tsc -p test.tsconfig.json --noEmit

# 2. Lint
yarn lint

# 3. Run backend tests (fast — no xvfb needed)
yarn backendTests

# 4. Run unit tests
yarn unitTests

# 5. Confirm coverage improved for the specific file
npx c8 --reporter=text --src=src \
  node ./node_modules/mocha/bin/_mocha \
    -u tdd --timeout 999999 --colors \
    -r ts-node/register \
    -r tsconfig-paths/register \
    "./test/unit-tests/backend/**/*.test.ts"
```

All five steps must pass. If any fail, fix the failures before opening the PR.

## Step 4 — Coverage bar

Do **not** open the PR unless every file listed in the issue has either:
- improved by ≥ 10 percentage points from the baseline in the issue, **OR**
- reached ≥ 60% line coverage

## Test quality rules specific to this repo

| Rule | Why |
|------|-----|
| Test both `useCMakePresets` branches where the source branches on it | Most bugs affect only one mode |
| Test both single-config and multi-config generator paths where relevant | `CMAKE_BUILD_TYPE` vs `--config` are frequent bug sources |
| For `src/expand.ts` changes: test every macro type | `copilot-instructions.md` explicitly mandates this |
| For `src/diagnostics/`: test each compiler family's parser | `diagnostics.test.ts` is the largest test file — keep it comprehensive |
| Use `@cmt/` path alias for imports from `src/` | Never use relative paths from outside `src/` |
| Never use `console.log` in test files | Use the module logger or plain `assert` |

## PR requirements

- Branch name: `coverage/<module-name>-tests`
- Open as **ready for review** only after the self-audit checklist in the issue is fully checked
- PR description must use `.github/PULL_REQUEST_TEMPLATE/coverage.md`
- `CHANGELOG.md` must have one entry under `Improvements:`
