---
name: pr-readiness
description: >
  Verify that a pull request into microsoft/vscode-cmake-tools meets contribution
  requirements. Use when preparing, reviewing, or finalizing a PR to check for a
  descriptive title, a meaningful description, and a properly formatted CHANGELOG entry.
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

Insert the entry under the **most recent (topmost) version heading** in `CHANGELOG.md`. The first version heading looks like `## <version>` (e.g., `## 1.23`).

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

## Applying This Skill

When reviewing or preparing a PR:

1. **Check the title** — rewrite it if it is vague or missing context.
2. **Check the description** — ensure it explains what, why, and (if needed) how.
3. **Check `CHANGELOG.md`** — verify an entry exists under the current version in the correct section with the correct format. If missing, add one.
