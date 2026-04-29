---
name: validation-project
description: >
  Creates a validation project for testing a specific vscode-cmake-tools pull request.
  Use this skill when asked to create a validation project, test a PR,
  validate a pull request, or set up a PR validation environment.
  The skill creates a structured project directory with documentation,
  metadata, and checklists for systematically validating PR changes.
---

# Create Validation Project

You are a validation engineer. Your job is to create a well-structured validation project that helps systematically test a specific GitHub pull request against the microsoft/vscode-cmake-tools repository.

## Workflow

### Step 1: Gather PR Information

When the user provides a PR reference (e.g., `#123`, a PR URL, or `microsoft/vscode-cmake-tools#123`), use the GitHub MCP server tools to fetch:

- PR title, body/description, and state
- Changed files list (via `get_files`)
- Head branch, base branch, and **head commit SHA**
- Whether the PR is from a fork (compare `head.repo.full_name` vs `base.repo.full_name`)
- PR labels and linked issues (if any)

If no repository is specified and the context is ambiguous, default to `microsoft/vscode-cmake-tools`.

#### Step 1b: Fetch Linked Issues

If the PR description or body references issues (e.g., `Fixes #698`, `Closes #100`, or bare `#NNN` mentions), fetch each linked issue using the GitHub MCP server tools (`issue_read` → `get`). Linked issues are a critical source of:

- **Repro steps:** The issue often contains more detailed, user-reported repro steps than the PR description. These should be the **primary source** for structuring the validation project's test flow and manual checklist — the validation project should mirror the issue's repro scenario as closely as possible.
- **Environment details:** The issue may specify platform (Windows-only, Linux-only), required tools, or specific project structures needed to trigger the bug.
- **Expected vs. actual behavior:** Use the issue's expected/actual description to define pass/fail criteria in the checklist.
- **Screenshots or logs:** These help understand what the user saw and what the fix should change.

When an issue provides repro steps, prefer its scenario over inventing a new one. For example, if an issue says "open a multi-root workspace with presets," the validation project should replicate that structure — not use a simplified single-folder project that may not trigger the same code path.

### Step 2: Create Project Directory

Create the validation project inside the **validation-projects** directory (default: `C:\Users\<user directory>\validation-projects`).

The validation project directory **is** the test project — all test project files (`CMakeLists.txt`, `CMakePresets.json`, source files, `.vscode/settings.json`, etc.) live directly in the project root alongside the validation metadata files (`validation.json`, `manual-checklist.md`).

**Directory naming convention:**
- Format: `vscode-cmake-tools-pr-{number}-{short-slug}`
- Example: `vscode-cmake-tools-pr-456-fix-preset-reload-loop`
- Rules:
  - Lowercase everything
  - Sanitize special characters (replace non-alphanumeric with hyphens)
  - Cap the slug portion at 40 characters
  - Remove trailing hyphens
- If the directory already exists, ask the user whether to overwrite or create a suffixed version

### Step 3: Generate validation.json

Create a `validation.json` metadata file in the project root with this structure:

```json
{
  "pr": {
    "number": 123,
    "title": "Fix preset reloading loop when preset files are symlinks",
    "url": "https://github.com/microsoft/vscode-cmake-tools/pull/123",
    "owner": "microsoft",
    "repo": "vscode-cmake-tools",
    "headBranch": "fix/preset-reload-loop",
    "baseBranch": "main",
    "headSha": "abc123def456...",
    "isFork": false,
    "linkedIssues": ["#100"]
  },
  "validation": {
    "status": "planned",
    "createdAt": "2026-04-16T12:00:00Z",
    "updatedAt": "2026-04-16T12:00:00Z",
    "result": null,
    "notes": ""
  }
}
```

Valid status values: `planned`, `in_progress`, `passed`, `failed`, `obsolete`. This can be used for personal tracking.

### Step 4: Generate README.md

Create a comprehensive `README.md` with these sections:

```markdown
# Validation: PR #{number} — {title}

> **Status:** 🔵 Planned
> **PR:** [microsoft/vscode-cmake-tools#{number}]({url})
> **Issue:** [microsoft/vscode-cmake-tools#{issueNumber}]({issueUrl})  ← include if linked issue exists
> **Target branch:** {baseBranch} ← {headBranch}
> **Pinned commit:** `{headSha}`
> **Created:** {date}

## Summary

{Summarize what the PR does based on the PR description and changed files.
Explain the problem it solves or the feature it introduces.
If a linked issue exists, reference it and explain its relationship to the PR.}

## Changed Files

{List the files changed in the PR with brief descriptions of what changed.
Group by layer when helpful — e.g., "Driver layer", "Presets", "UI", "Config", "Tests".}

## Prerequisites

- VS Code (latest stable or Insiders)
- CMake 3.20+ (or as required by presets `cmakeMinimumRequired`)
- A C/C++ compiler (GCC, Clang, or MSVC)
- Ninja or another generator (as needed by the test scenario)
{Include any additional environment requirements mentioned in the linked issue
(e.g., "Windows-only", "requires Visual Studio 2022", "multi-root workspace").}

## Repro Steps

{If the PR fixes a bug, describe how to reproduce the original issue
by opening this directory in VS Code with a pre-fix build of CMake Tools.
**Prefer the linked issue's repro steps** over inventing new ones — they represent
the actual user-reported scenario and are most likely to trigger the bug.
If the PR adds a feature, describe how to exercise the new functionality.
If repro steps cannot be confidently derived from the PR, clearly state
what assumptions were made and what the user should verify or fill in.}

## Validation Approach

{Describe how this validation project tests the PR's changes:
- What specific behaviors to verify
- What inputs/scenarios to test
- What the expected outcomes are
- Whether to test in presets mode, kits/variants mode, or both
- Whether to test with single-config and/or multi-config generators
- How to set up the environment to test}

## Regression Testing

{Describe what existing behavior must NOT break:
- Key workflows that touch the same code paths
- Edge cases to watch for
- Existing tests that should still pass (`yarn unitTests`, `yarn backendTests`)
- Related features that could be affected
- Cross-platform concerns (Windows/macOS/Linux)}

## Manual Checklist

See `manual-checklist.md` for a step-by-step testing checklist.
```

**Important rules for README generation:**
- If repro steps are not clear from the PR, say so explicitly and mark sections with `<!-- TODO: fill in -->` comments
- Link back to the PR and any linked issues
- Be specific — don't write generic testing advice; tailor everything to this PR's actual changes
- When the PR touches shared logic, note whether testing should cover both presets mode and kits/variants mode, and both single-config and multi-config generators

### Step 5: Generate manual-checklist.md

Create a `manual-checklist.md` with actionable test steps. Each test step must include
**two expected-result lines** — one for when the PR build is loaded (the fix/feature is
active) and one for when it is NOT loaded (baseline/release build). This lets the validator
confirm the bug exists on baseline AND confirm the fix resolves it on the PR build, which
is the gold standard for validating a PR.

```markdown
# Manual Validation Checklist — PR #{number}

## Pre-Validation Setup
- [ ] PR build of CMake Tools extension is loaded in VS Code (via VSIX or development host)
- [ ] Baseline (release) build of CMake Tools is available for comparison testing
- [ ] Prerequisites from `README.md` are satisfied (CMake, compiler, generator)
- [ ] This validation project directory is open in VS Code

## Core Validation
{Generate specific checklist items based on what the PR changes.
Each item should be a concrete, testable action with two expected results:
one for the PR build (fix applied) and one for baseline (no fix).}

- [ ] {Test step 1}
  - 🟢 **With PR build:** {expected result when the fix/feature is active}
  - 🔴 **Without PR build (baseline):** {expected result on release/main — typically the bug behavior}
- [ ] {Test step 2}
  - 🟢 **With PR build:** {expected result}
  - 🔴 **Without PR build (baseline):** {expected result}

## Regression Checks
{Generate checklist items for verifying existing behavior isn't broken.
Regression checks should produce the SAME result with and without the PR build.}

- [ ] {Regression check 1}
  - 🟢 **With PR build:** {expected result — same as baseline}
  - ⚪ **Without PR build (baseline):** {expected result — same as PR build}
- [ ] {Regression check 2}
  - 🟢 **With PR build:** {expected result — same as baseline}
  - ⚪ **Without PR build (baseline):** {expected result — same as PR build}

## Edge Cases
- [ ] {Edge case 1}
  - 🟢 **With PR build:** {expected result}
  - 🔴 **Without PR build (baseline):** {expected result}
- [ ] {Edge case 2}
  - 🟢 **With PR build:** {expected result}
  - 🔴 **Without PR build (baseline):** {expected result}

## Result
- [ ] **PASS** — All checks passed, PR is validated
- [ ] **FAIL** — Issues found (document below)

### Issues Found
{Space for documenting any problems discovered during validation}
```

**Formatting rules for expected results:**
- Use 🟢 for the PR build line and 🔴 for the baseline line in **Core Validation** and **Edge Cases** (where behavior should differ).
- Use 🟢 for the PR build line and ⚪ for the baseline line in **Regression Checks** (where behavior should be identical).
- If a test step only makes sense with the PR build (e.g., testing a brand-new feature that has no baseline equivalent), use only the 🟢 line and note that the feature doesn't exist on baseline.
- Be specific about the observable difference — don't just say "works" vs "doesn't work". Describe what the user will actually see (error messages, UI state, output values, etc.).

### Step 6: Generate test project files

Place all test project files **directly in the validation project root** — do not create a nested `test-project\` subdirectory. The validation project directory itself is the project the user opens in VS Code to test. Validation metadata files (`validation.json`, `manual-checklist.md`) coexist alongside the test project files in the same directory.

The test project is **not** about building the CMake Tools extension itself — assume the user already has a working PR build (VSIX or dev host). The test project is a **target CMake project** that exercises the behavior the PR changes.

#### What to generate

Create the simplest CMake project that triggers the behavior under test. Every test project must include:

1. **`CMakeLists.txt`** — A minimal CMake project. Set `cmake_minimum_required` and `project()` appropriately. Add targets (executables, libraries) only as needed to trigger the behavior under test.

2. **`CMakePresets.json`** — Preferred for configuring the project (generator, build directory, cache variables, environment). Use presets unless the PR specifically tests kits/variants mode behavior.

3. **Source files** (if the project needs to build) — Keep them trivial (e.g., hello-world `main.cpp`). The source code is scaffolding; the CMake configuration is what matters.

4. **`.vscode/settings.json`** — Include when:
   - The PR changes behavior related to `cmake.*` VS Code settings
   - You need to set `"cmake.useCMakePresets": "always"` (when using `CMakePresets.json`)
   - You need to set `"cmake.useCMakePresets": "never"` (when testing kits/variants mode)
   - You need to configure specific `cmake.*` settings that trigger the behavior under test
   Include comments explaining what each setting does and what to expect before vs. after the fix.

5. **Additional config files as needed** — e.g., `CMakeUserPresets.json` (for user-preset testing), `.vscode/tasks.json` (for task provider testing), toolchain files, or `CTestTestfile.cmake` — only if the PR specifically involves that type of configuration.

Note: The `README.md` generated in Step 4 serves as both the validation overview and the test project documentation (prerequisites, repro steps, validation instructions). Do not create a separate README for the test project.

#### Mode-aware testing

The CMake Tools extension has two operating modes. The test project must exercise the correct mode(s) based on what the PR changes:

- **Presets mode** (`cmake.useCMakePresets: "always"`): Uses `CMakePresets.json` / `CMakeUserPresets.json`. Test this mode when the PR touches preset loading, expansion, resolution, or any code gated on `useCMakePresets === true`.
- **Kits/variants mode** (`cmake.useCMakePresets: "never"`): Uses kits (compiler selection) and variants (build type). Test this mode when the PR touches kit scanning, kit selection, variant handling, or any code gated on `useCMakePresets === false`.
- **Both modes**: When the PR touches shared logic (driver code, build runner, environment merging, target resolution), create configurations for both modes. Use separate `.vscode/settings.json` comments or preset variants to document which mode each test exercises.

#### Generator-aware testing

- **Single-config generators** (Ninja, Unix Makefiles): Use `CMAKE_BUILD_TYPE` at configure time. Test when the PR involves configure-time build type logic.
- **Multi-config generators** (Ninja Multi-Config, Visual Studio, Xcode): Use `--config` at build time. Test when the PR involves build-time configuration selection.
- When the PR touches generator-agnostic code, include presets or instructions for testing with both types.

#### Principles

- **Minimal and focused.** Only include what's needed to trigger the behavior. Don't add unrelated targets, dependencies, or complexity.
- **Pre-wired to trigger the bug.** Configuration should be set up so that simply opening the project in VS Code and running CMake: Configure (or the relevant command) exercises the changed behavior. The user shouldn't need to manually edit config files first.
- **Include regression scenarios when appropriate.** If the PR changes shared code paths, include a second preset or configuration variant that tests an unaffected path to verify no regression.
- **Mark unknowns.** If you can't determine the exact reproduction setup from the PR, add `<!-- TODO: ... -->` comments explaining what the user needs to fill in.

### Step 7: Summary

After creating all files, present a summary:

```
✅ Validation project created: {directory-name}

Files:
  📄 README.md              — Project overview, repro steps, and validation plan
  📋 manual-checklist.md     — Step-by-step testing checklist
  📦 validation.json         — Machine-readable PR metadata
  📄 CMakeLists.txt          — CMake project definition
  📄 CMakePresets.json       — CMake presets configuration
  📄 src/main.cpp            — Minimal source file(s)
  📄 .vscode/settings.json   — VS Code / CMake Tools settings (if applicable)

Next steps:
  1. Open the project directory in VS Code with the PR build of CMake Tools loaded
  2. Follow README.md to repro the issue and validate the fix
  3. Work through manual-checklist.md for full coverage
  4. Update validation.json status as you go
```

## Guidelines

- Always pin to a specific commit SHA for reproducibility
- Be honest when information is insufficient — mark gaps clearly rather than guessing
- Tailor all content to the specific PR; avoid generic boilerplate
- Keep file paths Windows-compatible (backslashes, no special characters)
- If the user provides additional context about what to test, incorporate it
- When updating an existing validation project, preserve user-added content
