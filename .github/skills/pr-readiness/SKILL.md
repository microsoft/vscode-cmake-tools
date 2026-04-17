---
name: pr-readiness
description: >
  Verify that a pull request into microsoft/vscode-cmake-tools meets contribution
  requirements. Use when preparing, reviewing, or finalizing a PR to check for a
  descriptive title, a meaningful description, a properly formatted CHANGELOG entry,
  code correctness, regression risks, adherence to existing patterns, and whether
  documentation updates are needed.
---

# PR Readiness

## PR Requirements Checklist

### 1. PR Title

The title must clearly and concisely describe the change from the user's perspective. It should:

- Start with a verb (e.g., "Fix", "Add", "Improve", "Remove", "Update").
- Mention the affected feature or area (e.g., presets, kits, CTest, build tasks, Project Outline).
- Be specific enough that a reader understands the change without opening the PR.

**Good examples:**

- `Fix preset reloading loop when preset files are symlinks`
- `Add "Delete Build Directory and Reconfigure" command`
- `Improve CTest test ordering to match Test Explorer display`

**Bad examples:**

- `Fix bug` (too vague)
- `Update code` (no useful information)
- `WIP` (not ready for review)

### 2. PR Description

The PR body must include:

- **What changed**: A short summary of the user-visible behavior change.
- **Why**: The motivation — link to a GitHub issue if one exists (e.g., `Fixes #1234`).
- **How** (if non-obvious): A brief explanation of the implementation approach when the change is complex.

### 3. CHANGELOG Entry

Every PR must add an entry to `CHANGELOG.md`.

#### Where to insert

Insert the entry under the **most recent (topmost) version heading** in `CHANGELOG.md`. The first version heading looks like `## <version>` (e.g., `## 1.23`). Always add the new entry at the **bottom** of the appropriate section (i.e., after all existing entries in that section).

#### Which section

Place the entry in exactly one of these three sections, creating the section if it does not already exist under the current version:

| Section | Use when… |
|---|---|
| `Features:` | A new user-visible capability is added (new command, new setting, new UI element). |
| `Improvements:` | An existing feature is enhanced, optimized, or has better UX — but no new capability is introduced. |
| `Bug Fixes:` | A defect is corrected. |

The sections appear in this fixed order: `Features:`, then `Improvements:`, then `Bug Fixes:`.

#### Entry format

Each entry follows this pattern:

```
- <Description>. [#<number>](<link>)
```

Where `<Description>` starts with a present-tense verb describing the user-visible change, and the link references either:

- The **GitHub issue** it solves: `[#<issue number>](https://github.com/microsoft/vscode-cmake-tools/issues/<issue number>)`
- Or the **PR** itself: `[#<pr number>](https://github.com/microsoft/vscode-cmake-tools/pull/<pr number>)`

An entry may optionally credit an external contributor at the end: `[@user](https://github.com/user)`.

**Examples:**

```markdown
Features:
- Add "Delete Build Directory and Reconfigure" command that removes the entire build directory before reconfiguring, ensuring a completely clean state. [#4826](https://github.com/microsoft/vscode-cmake-tools/pull/4826)

Improvements:
- Run tests sequentially in alphabetical order (matching the Test Explorer display order) when `cmake.ctest.allowParallelJobs` is disabled. [#4829](https://github.com/microsoft/vscode-cmake-tools/issues/4829)

Bug Fixes:
- Fix `cmake.revealLog` set to `"focus"` not revealing the output panel or stealing focus. [#4471](https://github.com/microsoft/vscode-cmake-tools/issues/4471)
- Fix garbled characters in the Output panel when MSVC outputs UTF-8 on non-UTF-8 Windows systems. [#4520](https://github.com/microsoft/vscode-cmake-tools/issues/4520) [@contributor](https://github.com/contributor)
```

#### What NOT to do

- Do **not** add a new version heading — use the existing topmost one.
- Do **not** place the entry under an older version.
- Do **not** use past tense (write "Fix …", not "Fixed …").
- Do **not** omit the issue or PR link.

### 4. Correctness

Review the code changes for logical correctness:

- **Both operating modes**: If the change touches shared logic (configure, build, test, targets, environment), verify it handles both *presets mode* and *kits/variants mode*. Check for `useCMakePresets` branching where appropriate.
- **Both generator types**: If the change involves build-type logic, verify it handles both single-config generators (`CMAKE_BUILD_TYPE` at configure time) and multi-config generators (`--config` at build time).
- **Edge cases**: Look for off-by-one errors, null/undefined access, missing `await` on async calls, and unhandled promise rejections.
- **Error handling**: Verify errors are not silently swallowed. Top-level event handlers should use `rollbar.invokeAsync()` / `rollbar.invoke()`. Empty `catch` blocks are a red flag.
- **Cross-platform**: Check for hardcoded path separators (`/` or `\\`), case-sensitive env var assumptions, or platform-specific APIs used without guards. Paths must use `path.join()` / `path.normalize()`.

### 5. Regression Risks

Identify areas where the change could break existing behavior:

- **Shared utilities**: Changes to `src/expand.ts`, `src/proc.ts`, `src/shlex.ts`, or `src/util.ts` affect many callers — verify all call sites still behave correctly.
- **Driver base class**: Changes to `cmakeDriver.ts` propagate to `cmakeFileApiDriver.ts`, `cmakeLegacyDriver.ts`, and `cmakeServerDriver.ts`. Check that subclass overrides are still compatible.
- **Preset merging**: Changes to `presetsController.ts` or `presetsParser.ts` can alter how presets resolve — verify with nested `include` chains and `CMakeUserPresets.json` overrides.
- **Settings**: Adding or renaming a setting in `package.json` without updating `src/config.ts` (or vice versa) causes silent failures.
- **Task provider**: Changes to `cmakeTaskProvider.ts` can break `tasks.json` definitions that users have already configured.
- **Public API / extensibility**: Changes to exports in `src/api.ts` or types in `EXTENSIBILITY.md` can break dependent extensions.
- **Test coverage**: Flag changes to critical paths that lack corresponding test updates, especially in `src/drivers/`, `src/presets/`, and `src/kits/`.

### 6. Adherence to Existing Patterns

Verify the change follows the project's established conventions:

- **Import style**: Uses `@cmt/*` path aliases (not relative paths from outside `src/`). Uses `import * as nls from 'vscode-nls'` for localization.
- **Logging**: Uses `logging.createLogger('module-name')` — never `console.log`.
- **Localization**: All user-visible strings use `localize('message.key', 'Message text')` with the `vscode-nls` boilerplate at the top of the file.
- **Settings access**: Reads settings through `ConfigurationReader` (`src/config.ts`) — never calls `vscode.workspace.getConfiguration()` directly.
- **Telemetry**: Uses helpers from `src/telemetry.ts` — never calls the VS Code telemetry API directly.
- **Data access**: Uses canonical data paths (e.g., `CMakeProject.targets` for targets, `CMakeDriver.cmakeCacheEntries` for cache) — never parses CMake files or cache directly.
- **Async patterns**: Prefers `async`/`await` over `.then()` chains (exception: fire-and-forget UI calls).
- **Naming and structure**: New files are placed in the correct layer directory (see architecture table in `.github/copilot-instructions.md`). New commands are registered in `src/extension.ts`.

### 7. Documentation Updates

Check whether the change requires documentation updates:

- **New or changed settings**: Must be reflected in all three locations — `package.json` (`contributes.configuration`), `src/config.ts` (`ConfigurationReader`), and `docs/cmake-settings.md`.
- **New commands**: Must be documented in `package.json` (`contributes.commands`) and referenced in the relevant docs page under `docs/`.
- **User-visible behavior changes**: If the change alters how a feature works (not just fixes a bug), check whether `docs/` pages describing that feature need updating.
- **Extensibility changes**: If `src/api.ts` or public types change, update `EXTENSIBILITY.md`.
- **README**: If a new major feature is added, check whether `README.md` should mention it.

## Applying This Skill

When reviewing or preparing a PR:

1. **Check the title** — rewrite it if it is vague or missing context.
2. **Check the description** — ensure it explains what, why, and (if needed) how.
3. **Check `CHANGELOG.md`** — verify an entry exists under the current version in the correct section with the correct format. If missing, add one.
4. **Check correctness** — review code for logical errors, missing mode/generator handling, cross-platform issues, and error handling gaps.
5. **Check regression risks** — identify areas where the change could break existing behavior and flag missing test coverage for critical paths.
6. **Check pattern adherence** — verify the change follows established import, logging, localization, settings access, and architectural conventions.
7. **Check documentation** — verify that new or changed settings, commands, and behavior are reflected in the appropriate docs.
