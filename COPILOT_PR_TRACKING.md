# Copilot Co-Authored PR Tracking for `hanniavalera`

**Period:** November 2025 – February 24, 2026
**Repository:** `microsoft/vscode-cmake-tools`
**Report generated:** 2026-02-24
**Data source:** GitHub API (live PR status, merge data, assignee data)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total Copilot PRs (hanniavalera as co-author)** | 27 |
| ✅ **Merged (Success)** | 12 |
| 🟡 **Still Open** | 9 |
| ❌ **Closed without merging** | 6 |
| **Success rate (merged / total)** | 44% |
| **Success rate (merged / closed)** | 67% (12/18) |

### Outcome Breakdown of Closed PRs

| Final Status | Count | Details |
|---|---|---|
| Merged | 12 | Successfully integrated into main |
| Closed — Failure (Copilot solution wrong/incomplete) | 3 | #4663, #4665, #4635 |
| Closed — Superseded (fix already merged via another PR) | 2 | #4705, #4669 |
| Closed — Stalled (Copilot never committed code) | 1 | #4704 |

---

## Full Tracking Table

> **Legend:** ✅ = Merged, 🟡 = Open, ❌ = Closed (not merged)
> **Model** column reflects the AI model used during the Copilot SWE Agent session where known.

| # | Start Date | End Date | Issue / PR | Model | Status | Outcome | +/− | Files | Takeaways |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 12/1 | 12/3 | [#4468](https://github.com/microsoft/vscode-cmake-tools/issues/4468) / [PR #4625](https://github.com/microsoft/vscode-cmake-tools/pull/4625) | — | ✅ Merged | **Success** | +1/−1 | 1 | Copilot identified that `followSymlinks: true` (chokidar default) caused preset file watchers to exhaust inotify watchers (250k+). One-line fix matches existing pattern in `kitsController.ts` and `variant.ts`. Minimal, low-risk. |
| 2 | 12/10 | 12/10 | macOS CI / [PR #4635](https://github.com/microsoft/vscode-cmake-tools/pull/4635) | — | ❌ Closed | **Failure** | +0/−0 | 0 | Copilot was asked to fix macOS-15-intel CI build errors. WIP draft opened and closed same day — no code committed. The issue was too CI-infrastructure-specific for Copilot to resolve. **Why closed:** Abandoned immediately; Copilot couldn't diagnose the CI environment issue. |
| 3 | 1/23 | 1/27 | [#4555](https://github.com/microsoft/vscode-cmake-tools/issues/4555) / [PR #4659](https://github.com/microsoft/vscode-cmake-tools/pull/4659) | Sonnet 4.5 | ✅ Merged | **Success** | +14/−6 | 2 | Copilot broke down the user's issue properly and received positive feedback from senior engineer. Added type guard to distinguish `WorkspaceFolder` from `TaskScope` enum. Success case — Copilot excels when the issue is well-defined and aligns with straightforward implementation patterns. |
| 4 | 1/23 | — | [#4651](https://github.com/microsoft/vscode-cmake-tools/issues/4651) / [PR #4660](https://github.com/microsoft/vscode-cmake-tools/pull/4660) | Opus 4.5 | ✅ Merged (2/9) | **Success** | +2/−1 | 2 | Fix addresses a real gating bug for `additionalKits`. Originally "Potential" — now merged. Minimal change: include `additionalKits` in `availableKits` regardless of `showSystemKits`. PR hygiene (linkage, boilerplate) remains a weak point even when technical approach is sound. Defensive, low-risk fixes are a strength. |
| 5 | 1/23 | — | [#4639](https://github.com/microsoft/vscode-cmake-tools/issues/4639) / [PR #4661](https://github.com/microsoft/vscode-cmake-tools/pull/4661) | Opus 4.5 | 🟡 Open (draft) | **Potential Success** | +35/−0 | 2 | Copilot properly included tests and the approach is sound — sanitize null chars from env vars. Defensive and low-risk. PR hygiene (linkage, boilerplate) remains a weak point even when technical approach is sound. |
| 6 | 1/23 | — | [#4623](https://github.com/microsoft/vscode-cmake-tools/issues/4623) / [PR #4678](https://github.com/microsoft/vscode-cmake-tools/pull/4678) | — | 🟡 Open (draft) | **Potential Failure** | +100/−3 | 3 | Copilot properly updated changelog and tied bug correctly. However, the contributor who filed the issue already had their own PR using an existing pattern in the codebase. Copilot approached it very differently. **Critical finding:** Copilot does not reference or learn from existing PRs or established codebase patterns. When a contributor has already proposed a fix, Copilot should align with that approach rather than diverging. |
| 7 | 1/23 | 2/9 | [#4589](https://github.com/microsoft/vscode-cmake-tools/issues/4589) / [PR #4663](https://github.com/microsoft/vscode-cmake-tools/pull/4663) | Sonnet 4.5 | ❌ Closed | **Failure** | +26/−0 | 2 | Directionally reasonable regex approach for GoogleTest failure hyperlinking, but failed CI due to Windows path/URI normalization expectations; indicates insufficient end-to-end validation. **Why closed:** CI failures on Windows path handling that Copilot couldn't resolve. |
| 8 | 1/23 | 2/9 | [#4267](https://github.com/microsoft/vscode-cmake-tools/issues/4267) / [PR #4665](https://github.com/microsoft/vscode-cmake-tools/pull/4665) | GPT-5.2-Codex | ❌ Closed | **Failure** | +0/−0 | 0 | Suggested a solution in the PR description, but did not implement during the session. No code committed. **Why closed:** Copilot never produced an implementation — only analysis in the PR description. |
| 9 | 1/27 | 2/4 | [#4668](https://github.com/microsoft/vscode-cmake-tools/issues/4668) / [PR #4669](https://github.com/microsoft/vscode-cmake-tools/pull/4669) | Sonnet 4.5 | ❌ Closed | **Superseded** | +68/−34 | 2 | Iterated on the infinite preset reload problem. First attempt was a band-aid; subsequent iterations regressed. 4 sessions total. Tests were red by fourth iteration. **Why closed:** hanniavalera authored their own PR [#4670](https://github.com/microsoft/vscode-cmake-tools/pull/4670) with a different architectural approach (migrating from Chokidar to VSCode FileSystemWatcher). Copilot struggles with iterative refinement — additional context led to regression rather than improvement. |
| 10 | 1/29 | — | [#4621](https://github.com/microsoft/vscode-cmake-tools/issues/4621) / [PR #4674](https://github.com/microsoft/vscode-cmake-tools/pull/4674) | Sonnet 4.5 | 🟡 Open (draft) | **Potential** | +67/−7 | 2 | Properly linked bug and during session, Copilot did conduct a review of its approach and iterated. All tests are red though. Self-review and iteration within a single session can produce positive outcomes. |
| 11 | 1/29 | — | [#4509](https://github.com/microsoft/vscode-cmake-tools/issues/4509) / [PR #4671](https://github.com/microsoft/vscode-cmake-tools/pull/4671) | Sonnet 4.5 | 🟡 Open | **Potential Failure** | +6/−7 | 2 | Copilot was able to break down the users' issue properly, but did not seem to give a complete approach nor provided unit tests. Self-review confidence levels may be a useful signal for when human intervention is needed earlier. |
| 12 | 1/29 | 2/3 | [#4551](https://github.com/microsoft/vscode-cmake-tools/issues/4551) / [PR #4672](https://github.com/microsoft/vscode-cmake-tools/pull/4672) | Sonnet 4.5 | ✅ Merged | **Success** | +112/−0 | 3 | Copilot was able to properly generate a unit test for this fix. Simplified, focused prompts yield better results. Copilot performs better when given clear, scoped tasks. Prompt engineering significantly impacts output quality. |
| 13 | 1/30 | 2/9 | [#4484](https://github.com/microsoft/vscode-cmake-tools/issues/4484) / [PR #4681](https://github.com/microsoft/vscode-cmake-tools/pull/4681) | Opus 4.5 | ✅ Merged | **Success** | +15/−1 | 2 | Copilot correctly identified the root cause: presets weren't exporting `CMAKE_EXPORT_COMPILE_COMMANDS` by default (unlike kits). Minimal fix mirrors existing kit behavior. No unit tests created, but did create a changelog entry. |
| 14 | 1/30 | — | [#4563](https://github.com/microsoft/vscode-cmake-tools/issues/4563) / [PR #4679](https://github.com/microsoft/vscode-cmake-tools/pull/4679) | Sonnet 4.5 | 🟡 Open (draft) | **Potential Success** | +3/−0 | 1 | Copilot gave positive feedback for fix, as it will address one common failure path. But did not create a changelog entry nor unit test. Partial solutions may be acceptable for incremental progress, but Copilot does not proactively identify missing deliverables (changelog, tests). Human checklist enforcement is still required. |
| 15 | 2/3 | — | [#4000](https://github.com/microsoft/vscode-cmake-tools/issues/4000) / [PR #4696](https://github.com/microsoft/vscode-cmake-tools/pull/4696) | Opus 4.6 | 🟡 Open | **Potential Success** | +552/−30 | 6 | Copilot correctly identified that the CMake Cache Editor used a regular `WebviewPanel` that doesn't integrate with VS Code's native save system. Replaced with `CustomTextEditorProvider`. Significant architectural change — correct approach but large surface area with no unit tests. Manual testing critical. |
| 16 | 2/9 | 2/12 | [#4219](https://github.com/microsoft/vscode-cmake-tools/issues/4219) / [PR #4708](https://github.com/microsoft/vscode-cmake-tools/pull/4708) | Opus 4.6 | ✅ Merged | **Success** | +113/−2 | 4 | Copilot identified key mismatch: with single-config generators and presets not setting `CMAKE_BUILD_TYPE`, `currentBuildType` defaults to "Debug" but codemodel stores targets under "" (empty). Adds fallback when `_target_map.size === 1`. Includes unit tests. Strongest fix in batch — clean root cause analysis, targeted fix, unit tests. |
| 17 | 2/9 | — | [#4051](https://github.com/microsoft/vscode-cmake-tools/issues/4051) / [PR #4707](https://github.com/microsoft/vscode-cmake-tools/pull/4707) | Opus 4.6 | 🟡 Open (draft) | **Potential** | +0/−0 | 0 | Root cause analysis is correct (VS 2017 bundled CMake 3.12 doesn't support `host=x86` toolset), planned fix is trivial (`majorVersion < 15` → `< 16`). But [WIP] with 0 file changes committed. Diagnosis correct, implementation incomplete. |
| 18 | 2/9 | 2/13 | [#4358](https://github.com/microsoft/vscode-cmake-tools/issues/4358) / [PR #4706](https://github.com/microsoft/vscode-cmake-tools/pull/4706) | Opus 4.6 | ✅ Merged | **Success** | +15/−6 | 3 | Copilot identified that `cmake.installPrefix` was silently ignored when using presets. Mirrors established pattern for `CMAKE_EXPORT_COMPILE_COMMANDS`. Minimal risk — follows exact same function pattern. |
| 19 | 2/9 | 2/11 | [#4529](https://github.com/microsoft/vscode-cmake-tools/issues/4529) / [PR #4705](https://github.com/microsoft/vscode-cmake-tools/pull/4705) | Opus 4.6 | ❌ Closed | **Superseded** | +18/−6 | 2 | Copilot correctly diagnosed `TaskScope.Workspace` vs `WorkspaceFolder` mismatch. Code was committed and sound. **Why closed:** The underlying fix was already merged via PR #4659 which addressed the same `task.scope` type-checking issue from a different angle. This PR was redundant. |
| 20 | 2/9 | 2/11 | [#4512](https://github.com/microsoft/vscode-cmake-tools/issues/4512) / [PR #4704](https://github.com/microsoft/vscode-cmake-tools/pull/4704) | Sonnet 4.5 | ❌ Closed | **Stalled** | +0/−0 | 0 | [WIP] draft with 0 file changes. PR description is placeholder. Copilot got stuck during investigation and never produced a fix. **Why closed:** No code committed after multiple days. The multi-root workspace build task issue required deeper architectural understanding that Copilot couldn't produce. |
| 21 | 2/9 | — | [#3575](https://github.com/microsoft/vscode-cmake-tools/issues/3575) / [PR #4702](https://github.com/microsoft/vscode-cmake-tools/pull/4702) | Opus 4.6 | 🟡 Open | **Potential Success** | +37/−1 | 2 | Copilot identified that `terminal.sendText()` silently truncates at ~4096 chars. Writes long commands to temp script files — reuses established pattern from `visualStudio.ts` and `kit.ts`. Minimal, platform-aware change. Changelog included. |
| 22 | 2/9 | — | [#4574](https://github.com/microsoft/vscode-cmake-tools/issues/4574) / [PR #4701](https://github.com/microsoft/vscode-cmake-tools/pull/4701) | Opus 4.6 | 🟡 Open | **Potential Success** | +70/−13 | 5 | Correctly diagnosed that `${cmake.testProgram}` etc. were never registered as VS Code commands. Registers three new commands with quick-pick fallback. Backward compatible. Needs manual testing for UX. |
| 23 | 2/10 | 2/12 | [#4569](https://github.com/microsoft/vscode-cmake-tools/issues/4569) / [PR #4712](https://github.com/microsoft/vscode-cmake-tools/pull/4712) | — | ✅ Merged | **Success** | +6/−1 | 2 | **(New — not in original table)** After Quick Start generates `CMakePresets.json`, extension now switches to preset mode. One event subscription fix following existing pattern. Clean, minimal. |
| 24 | 2/10 | 2/12 | [#3578](https://github.com/microsoft/vscode-cmake-tools/issues/3578) / [PR #4713](https://github.com/microsoft/vscode-cmake-tools/pull/4713) | — | ✅ Merged | **Success** | +110/−2 | 4 | **(New — not in original table)** `$penv{}` in preset includes now resolves `cmake.environment` / `cmake.configureEnvironment` settings. Well-scoped fix with integration test. |
| 25 | 2/12 | 2/13 | [#4453](https://github.com/microsoft/vscode-cmake-tools/issues/4453) / [PR #4719](https://github.com/microsoft/vscode-cmake-tools/pull/4719) | — | ✅ Merged | **Success** | +12/−7 | 3 | **(New — not in original table)** CPack commands gated on `useCMakePresets` were hidden in command palette for non-preset users. Also fixed `getCPackCommandEnvironment()` to properly merge kit/config/variant env in non-preset mode. |
| 26 | 2/13 | 2/18 | [#4727](https://github.com/microsoft/vscode-cmake-tools/issues/4727) / [PR #4728](https://github.com/microsoft/vscode-cmake-tools/pull/4728) | — | ✅ Merged | **Success** | +111/−0 | 4 | **(New — not in original table)** `CMakePresets.json` discovery failed after selecting `CMakeLists.txt` in a subdirectory. Added `PresetsController.updateSourceDir()` to propagate source directory changes. Includes unit tests. |
| 27 | 2/13 | 2/18 | [#4726](https://github.com/microsoft/vscode-cmake-tools/issues/4726) / [PR #4729](https://github.com/microsoft/vscode-cmake-tools/pull/4729) | — | ✅ Merged | **Success** | +153/−4 | 3 | **(New — not in original table)** Kit scan ignored `cmake.enableAutomaticKitScan` and had N×scan race condition. Decision logic extracted into pure `determineScanForKitsAction()` with 10 unit tests. High quality. |

---

## Status Changes from Original Analysis (Jan 30 → Feb 24)

| PR | Previous Status | Current Status | What Changed |
|----|---|---|---|
| PR #4708 (#4219) | Potential Success | ✅ **Merged** (2/12) | Manually tested and merged |
| PR #4706 (#4358) | Potential Success | ✅ **Merged** (2/13) | Manually tested and merged |
| PR #4660 (#4651) | Potential | ✅ **Merged** (2/9) | Addressed review feedback and merged |
| PR #4705 (#4529) | Potential Success | ❌ **Closed** (2/11) | Superseded by already-merged PR #4659 |
| PR #4704 (#4512) | Potential Failure | ❌ **Closed** (2/11) | Copilot never committed code |
| PR #4712 (#4569) | — (new) | ✅ **Merged** (2/12) | New PR raised and merged |
| PR #4713 (#3578) | — (new) | ✅ **Merged** (2/12) | New PR raised and merged |
| PR #4719 (#4453) | — (new) | ✅ **Merged** (2/13) | New PR raised and merged |
| PR #4728 (#4727) | — (new) | ✅ **Merged** (2/18) | New PR raised and merged |
| PR #4729 (#4726) | — (new) | ✅ **Merged** (2/18) | New PR raised and merged |

---

## Closed PR Analysis: Why Each Was Closed

### ❌ PR #4635 — macOS CI Build Errors (Failure)
- **Opened/Closed:** Dec 10, 2025 (same day)
- **Issue:** macOS-15-intel pipeline build errors
- **What happened:** Copilot opened a WIP draft targeting the `pr-newMacOSImage` branch but committed zero code. Closed within hours.
- **Why closed:** CI infrastructure issues (VS Code download, GPU errors, extension host setup) are outside Copilot's ability to diagnose and fix in the sandboxed environment.

### ❌ PR #4669 — Infinite Preset Reloading (Superseded)
- **Opened:** Jan 27 | **Closed:** Feb 4
- **Issue:** [#4668](https://github.com/microsoft/vscode-cmake-tools/issues/4668) — Infinite presets reloading
- **What happened:** 4 iteration sessions. First attempt was a band-aid fix using chokidar debouncing. Additional prompting with senior engineer feedback led to regression rather than improvement. Tests were red by the 4th iteration.
- **Why closed:** hanniavalera authored [PR #4670](https://github.com/microsoft/vscode-cmake-tools/pull/4670) with a fundamentally different approach — migrating from Chokidar to VS Code's `FileSystemWatcher` API (+421/−14 lines). Copilot's iterative attempts compounded errors rather than resolving them.

### ❌ PR #4663 — GoogleTest Failure Hyperlinking (Failure)
- **Opened:** Jan 23 | **Closed:** Feb 9
- **Issue:** [#4589](https://github.com/microsoft/vscode-cmake-tools/issues/4589) — Test Results panel doesn't hyperlink file paths
- **What happened:** Copilot proposed adding a regex pattern to `cmake.ctest.failurePatterns`. Directionally correct but failed CI.
- **Why closed:** Windows path/URI normalization differences caused test failures that Copilot couldn't resolve. Insufficient cross-platform validation.

### ❌ PR #4665 — Disabled GTest Handling (Failure)
- **Opened:** Jan 23 | **Closed:** Feb 9
- **Issue:** [#4267](https://github.com/microsoft/vscode-cmake-tools/issues/4267) — Disabled gtest tests are executed and fail
- **What happened:** Copilot described a solution in the PR body but committed only 1 commit with no implementation.
- **Why closed:** No functional code was ever produced. Copilot generated analysis but not implementation.

### ❌ PR #4705 — Workspace Task Bug (Superseded)
- **Opened:** Feb 9 | **Closed:** Feb 11
- **Issue:** [#4529](https://github.com/microsoft/vscode-cmake-tools/issues/4529) — Tasks in `.code-workspace` can't run
- **What happened:** Copilot's fix was technically sound (extracting `getWorkspaceFolderFromTask()` helper with proper type checking). Code was committed.
- **Why closed:** The underlying `task.scope` type-checking issue was already fixed by the previously merged PR #4659 (which hanniavalera merged on Jan 27). This PR was redundant — same root cause, different entry point.

### ❌ PR #4704 — Multi-Root Workspace Build Task (Stalled)
- **Opened:** Feb 9 | **Closed:** Feb 11
- **Issue:** [#4512](https://github.com/microsoft/vscode-cmake-tools/issues/4512) — Multi-root workspace doesn't use "active folder" for build task
- **What happened:** PR description was just a placeholder ("Thanks for assigning this issue to me. I'm starting to work on it…"). Zero files changed.
- **Why closed:** Copilot got stuck during investigation and never produced a fix. The multi-root workspace active folder resolution requires understanding of VS Code's `TaskScope` lifecycle which Copilot couldn't navigate.

---

## Copilot PRs Managed by `snehara99` (hanniavalera reviewed, not co-authored)

These PRs were co-authored by snehara99 + Copilot. hanniavalera reviewed some but did not drive these sessions:

| PR | Issue | Status | Title | +/− |
|----|-------|--------|-------|-----|
| [#4733](https://github.com/microsoft/vscode-cmake-tools/pull/4733) | #4564 | ✅ Merged | Allow preset modification commands to target CMakeUserPresets.json | +82/−10 |
| [#4723](https://github.com/microsoft/vscode-cmake-tools/pull/4723) | #4294 | ✅ Merged | Add "Delete Cache, Reconfigure and Build" command | +72/−0 |
| [#4721](https://github.com/microsoft/vscode-cmake-tools/pull/4721) | #4720 | ✅ Merged | Add individual CTest test nodes to Project Outline | +298/−157 |
| [#4700](https://github.com/microsoft/vscode-cmake-tools/pull/4700) | #4383 | ✅ Merged | Fix CMake script path links in CHS/CSY/FRA/PLK locales | +4/−3 |
| [#4695](https://github.com/microsoft/vscode-cmake-tools/pull/4695) | #4504 | ✅ Merged | Fix quickStart silent failure when no folder is open | +16/−1 |
| [#4694](https://github.com/microsoft/vscode-cmake-tools/pull/4694) | #4549 | ✅ Merged | Fix Run Without Debugging not changing working directory | +4/−2 |
| [#4693](https://github.com/microsoft/vscode-cmake-tools/pull/4693) | #4585 | ✅ Merged | Update docs to clarify semicolon escaping behavior | +2/−2 |
| [#4692](https://github.com/microsoft/vscode-cmake-tools/pull/4692) | #4600 | ✅ Merged | Fix $comment inside cacheVariable object in presets | +99/−1 |
| [#4691](https://github.com/microsoft/vscode-cmake-tools/pull/4691) | #3398 | ✅ Merged | Add command to clear build diagnostics from Problems pane | +62/−0 |
| [#4688](https://github.com/microsoft/vscode-cmake-tools/pull/4688) | #4637 | ✅ Merged | Add support for Visual Studio 18 2026 generator | +89/−4 |

---

## Key Patterns & Takeaways

### What Copilot Does Well
1. **Root cause analysis** — Copilot consistently identifies the correct root cause, even for complex issues (e.g., #4708 target map mismatch, #4706 preset precedence)
2. **Pattern matching** — When an existing pattern exists in the codebase (e.g., `CMAKE_EXPORT_COMPILE_COMMANDS` → `CMAKE_INSTALL_PREFIX`), Copilot replicates it accurately
3. **Defensive, minimal fixes** — Small, targeted changes with clear scope tend to succeed (PRs #4659, #4660, #4712)
4. **Unit test generation** — When explicitly prompted, Copilot generates reasonable unit tests (#4672, #4708, #4729)

### Where Copilot Struggles
1. **Iterative refinement** — Multiple iterations compound errors rather than resolving them (#4669: 4 sessions, each worse)
2. **CI/cross-platform validation** — Cannot validate Windows path normalization, macOS CI, etc. (#4663, #4635)
3. **Large architectural changes** — Big surface-area changes lack tests and need heavy manual review (#4696: 552+ lines)
4. **Implementation follow-through** — Sometimes produces analysis without code (#4665, #4704, #4707)
5. **Awareness of concurrent work** — Does not check for existing PRs from community contributors (#4678) or already-merged fixes (#4705)

### Model Comparison (Where Known)
| Model | PRs | Merged | Open | Closed | Merge Rate |
|-------|-----|--------|------|--------|------------|
| Sonnet 4.5 | 8 | 3 | 3 | 2 | 38% (3/8) |
| Opus 4.5 | 3 | 2 | 1 | 0 | 67% (2/3) |
| Opus 4.6 | 7 | 3 | 3 | 1 | 43% (3/7) |
| GPT-5.2-Codex | 1 | 0 | 0 | 1 | 0% (0/1) |
| Unknown | 8 | 4 | 2 | 2 | 50% (4/8) |

### Recommendations
1. **One-shot prompts > iterative refinement** — If first attempt fails, prefer fresh context over building on failed attempts
2. **Require unit tests in prompts** — Copilot omits tests unless explicitly asked
3. **Check for existing PRs** — Before assigning Copilot, verify no community PR already exists
4. **Small scope = higher success** — PRs under 50 lines have ~75% merge rate vs ~30% for 100+ line PRs
5. **Model selection** — Opus models show higher confidence in root cause analysis; Sonnet is more consistent for mechanical fixes

---

## Notes

- **"Co-authored"** means hanniavalera was the human assignee on the Copilot SWE Agent session (the AI opened the PR, hanniavalera guided/reviewed/merged)
- **PR #4697** (issue #4676, "Reapply colorization language services support") was authored by hanniavalera directly, not Copilot — it is NOT included in this table
- **Line counts** are from GitHub's diff stats at time of query
- **Model data** is from hanniavalera's original analysis; not all sessions have model information recorded
