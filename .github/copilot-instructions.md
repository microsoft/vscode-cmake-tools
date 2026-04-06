---
description: "You are an expert contributor to microsoft/vscode-cmake-tools, a TypeScript VS Code extension targeting Windows, macOS, and Linux. You are deeply familiar with CMake, CMake Presets, CTest, CPack, generator types (Ninja, Ninja Multi-Config, Visual Studio, Unix Makefiles), kit/toolchain selection, the VS Code extension API, and this repo's architecture. Match existing patterns precisely and always prefer tracing the canonical data flow over guessing or grepping."
applyTo: "**/*.ts,**/*.tsx,**/package.json,**/*.cmake,**/CMakeLists.txt,**/CMakePresets.json,**/CMakeUserPresets.json"
---

# CMake Tools — Contributor Instructions

## Domain knowledge

- **Two operating modes**: *presets mode* (`CMakePresets.json`/`CMakeUserPresets.json`) vs. *kits/variants mode*. Many bugs affect only one. Always check `CMakeProject.useCMakePresets` and handle both unless explicitly justified.
- **Kits**: Define compiler, optional toolchain file, optional Visual Studio installation, and environment. On Windows, MSVC kits require VS Developer Environment (`vcvarsall.bat`) merged via `getEffectiveSubprocessEnvironment()` in `cmakeDriver.ts`.
- **Generators**: Single-config (Ninja, Unix Makefiles) use `CMAKE_BUILD_TYPE` at configure time. Multi-config (Ninja Multi-Config, Visual Studio) use `--config` at build time. Never assume single-config.
- **Presets**: `CMakePresets.json` is project-owned (committed). `CMakeUserPresets.json` is user-owned (gitignored). Both support `include` chaining. The merged tree lives in `PresetsController` — never re-parse preset files directly. Types live in `src/presets/preset.ts`.
- **CTest / CPack / Workflow**: Separate drivers — `CTestDriver` (`src/ctest.ts`), `CPackDriver` (`src/cpack.ts`), and `WorkflowDriver` (`src/workflow.ts`) — each with their own preset type.
- **Code model**: The CMake file-API produces `CodeModelContent` (defined in `src/drivers/codeModel.ts`) after configure — the authoritative source for targets, file groups, and toolchains. Never infer targets from `CMakeLists.txt`.
- **Variable expansion**: `src/expand.ts` handles `${variable}` expansion for both kit-context and preset-context vars. Changes here need unit tests.
- **Cross-platform**: Runs on Windows, macOS, Linux. Path separators, env var casing, compiler locations, and generator availability all differ.

## Project conventions

- **Path alias**: `@cmt/*` maps to `src/*` (see `tsconfig.json`). Always use `import foo from '@cmt/foo'` — never relative paths from outside `src/`. `@test/*` maps to `test/*` (defined in both `tsconfig.json` and `test.tsconfig.json`). Use `import ... from '@test/...'` in test files.
- **Error reporting**: Use `rollbar` wrappers for top-level error boundaries around event handlers, never bare `try/catch` that silently swallows.
  - `rollbar.invoke(what, fn)` — wraps synchronous code; catches, logs, and re-throws.
  - `rollbar.invokeAsync(what, fn)` — wraps async function execution; catches promise rejections.
  - `rollbar.takePromise(what, additional, thenable)` — attaches an error handler to an **already-created** Thenable (e.g., a return value from a VS Code API call). Use this when you have a promise but didn't create it via `invokeAsync`.
- **Telemetry**: Use helpers in `src/telemetry.ts` (`logEvent`). Never call the VS Code telemetry API directly.

## Architecture

| Layer | Primary files | Responsibility |
|---|---|---|
| **CMake driver** | `src/drivers/cmakeDriver.ts` (base), `cmakeFileApiDriver.ts`, `cmakeLegacyDriver.ts`, `cmakeServerDriver.ts` | Spawning CMake, file-API replies, code model, cache, targets. `cmakeFileApiDriver` is the modern default. |
| **CMake project** | `src/cmakeProject.ts` | Per-folder state: kit/preset, configure/build/test lifecycle |
| **Build runner** | `src/cmakeBuildRunner.ts` | Build-process orchestration and output streaming |
| **Task provider** | `src/cmakeTaskProvider.ts` | VS Code task integration (`tasks.json` "cmake" type) |
| **Project controller** | `src/projectController.ts` | Multi-folder workspace, active-project routing |
| **Presets** | `src/presets/presetsController.ts`, `presetsParser.ts`, `preset.ts` | Loading, merging, expanding, watching preset files; type definitions |
| **Kits** | `src/kits/kitsController.ts`, `src/kits/kit.ts`, `src/kits/variant.ts` | Compiler scanning, toolchain environment, VS kit detection, variant handling |
| **Extension entry** | `src/extension.ts` | Activation, command registration, wiring all layers |
| **UI / tree views** | `src/ui/` (`projectStatus.ts`, `projectOutline/`, `cacheView.ts`, `pinnedCommands.ts`) | Sidebar views, status bar, context menus |
| **Diagnostics** | `src/diagnostics/` (`cmake.ts`, `build.ts`, `gcc.ts`, `msvc.ts`, `gnu-ld.ts`, etc.) | Output parsing, log-level routing, problem matchers — one file per compiler family |
| **CMake debugger** | `src/debug/cmakeDebugger/` | Debug adapter for CMake script/configure debugging |
| **Language services** | `src/languageServices/` | CMake-language hover, completion, validation |
| **Config** | `src/config.ts` | `ConfigurationReader` — canonical access to all extension settings |
| **Tests** | `test/unit-tests/`, `test/integration-tests/`, `test/end-to-end-tests/`, `test/smoke/` | Mocha suites at four levels of granularity |

## Mandatory rules — apply to every task

### Before touching any code, orient first

Identify the affected layer(s) from the architecture table above. Read the relevant files before writing anything. Never guess at call sites, data flow, or configuration keys.

### Use canonical data paths — never ad-hoc reads or grep

| Need | Use — not grep or direct file reads |
|---|---|
| Targets / target types | `CMakeProject.targets`, `.executableTargets`, or `codeModelContent` |
| Active preset | `CMakeProject.configurePreset` / `.buildPreset` / `.testPreset` / `.packagePreset` / `.workflowPreset` |
| Active kit | `CMakeProject.activeKit` |
| Merged preset list | `PresetsController` |
| Cache entries | `CMakeDriver.cmakeCacheEntries` |
| Extension settings | `ConfigurationReader` (`src/config.ts`) — never `vscode.workspace.getConfiguration()` directly |

### Reactive configuration subscriptions

Use `ConfigurationReader.onChange()` for typed, per-setting change notifications:

```typescript
const disposable = config.onChange('settingName', (newValue) => {
    // Respond to change
});
// Store disposable in a field or push to a disposables array for cleanup
```

Do **not** use `vscode.workspace.onDidChangeConfiguration` directly — the `onChange()` API is type-safe, fires only for the specific setting, and integrates with the extension's promise tracking.

### Always handle both operating modes

When a code path touches shared logic (configure, build, test, targets, environment), check `CMakeProject.useCMakePresets` and ensure it works correctly in both presets mode and kits/variants mode. Omitting the check for one mode in shared code is a bug waiting to happen. Features that are inherently mode-specific (e.g., kit scanning, preset expansion) are fine to scope to one mode.

### `SpecialKits` sentinel values

Kit names may be sentinel values, not real compiler paths. Always check before treating `kit.name` as a file path:

- `SpecialKits.Unspecified` (`'__unspec__'`) — no kit selected
- `SpecialKits.ScanForKits` (`'__scanforkits__'`) — triggers kit scanning
- `SpecialKits.ScanSpecificDir` (`'__scan_specific_dir__'`) — scan a specific directory

### Kit trust model

Kits have an `isTrusted: boolean` property. Auto-scanned kits from untrusted paths are filtered out before selection and use. This prevents untrusted kits from executing `environmentSetupScript`. Do not bypass this trust filtering when adding kit-related code.

### Always handle both generator types

Single-config uses `CMAKE_BUILD_TYPE`; multi-config uses `--config` at build time. Check the active generator before any build-type logic.

Call `util.isMultiConfGeneratorFast(generator)` before any build-type logic. Multi-config generators include Visual Studio, Xcode, and Ninja Multi-Config. Note: the `cmake.setBuildTypeOnMultiConfig` setting can override multi-config behavior — check it before assuming.

### Localize all user-visible strings

Every file with user-visible text needs the `vscode-nls` boilerplate:

```typescript
import * as nls from 'vscode-nls';
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// ✅ localize('my.message.key', 'Human-readable message')
// ❌ bare strings in user-visible output
```

### NLS key naming and `package.nls.json`

Settings: `cmake-tools.configuration.cmake.<settingName>.description` (or `.markdownDescription`)
Commands: `cmake-tools.command.cmake.<commandName>.title`

- Update `package.nls.json` for English strings — **never** modify files under `i18n/` (translations are updated separately).
- When a setting uses `markdownDescription` in `package.json`, the NLS key suffix must be `.markdownDescription`, not `.description`.

### Use the module-scoped logger — never `console.log`

```typescript
import * as logging from '@cmt/logging';
const log = logging.createLogger('my-module');
```

### `async`/`await` — never swallow errors

Prefer `async`/`await` over `.then()` chains and never use empty `catch` blocks. Wrap top-level event handlers in `rollbar.invokeAsync()`. Exception: fire-and-forget UI calls (e.g., `vscode.window.showInformationMessage(...).then(...)`) where `.then()` is idiomatic.

### Paths — always `path.join()` / `path.normalize()`

Never concatenate path strings with `/` or `\\`. No exceptions.

### New or changed settings: update all three locations

`package.json` (`contributes.configuration`), `src/config.ts` (`ConfigurationReader`), and `docs/cmake-settings.md`.

### Setting `scope` in `package.json`

Every setting in `contributes.configuration` must have an explicit `scope`:
- `"resource"` — per-folder; use for anything CMake project-specific (paths, build args, generator, environment).
- `"window"` — global; use for extension-wide UI/behavior settings.

Examples: `cmake.buildDirectory` → `"resource"` (project-specific path), `cmake.autoSelectActiveFolder` → `"window"` (global UI behavior).

### Every PR needs a CHANGELOG entry

One entry under the current version in `CHANGELOG.md`, in the appropriate section (`Features:`, `Improvements:`, or `Bug Fixes:`), describing user-visible behavior in the repo's existing tense and category style.

### Adding a new diagnostic parser

1. Create `src/diagnostics/<name>.ts` — extend `RawDiagnosticParser`, implement `handleLine()`
2. Add an instance to the `Compilers` class in `src/diagnostics/build.ts`
3. Add the parser name to `cmake.enabledOutputParsers` enum array **and** default array in `package.json`
4. Add English strings to `package.nls.json` if descriptions change

Currently registered: gcc, gnuld, ghs, diab, msvc, iar, iwyu. Default-enabled: cmake, gcc, gnuld, msvc, ghs, diab.

### Copilot CI environment

In the Copilot agent CI environment, `.npmrc` is renamed to `.npmrc.bak` and `yarn.lock` registry URLs are patched to use the public npm registry. These are environment artifacts:
- **Never commit** `.npmrc.bak` or the patched `yarn.lock`
- If `git status` shows these as modified, run `git checkout -- .npmrc yarn.lock` before committing

## Testing checklist

- [ ] `yarn unitTests` passes
- [ ] If `src/diagnostics/`, `src/presets/`, or `src/expand.ts` changed — affected unit tests updated
- [ ] If `src/kits/` changed — update `test/unit-tests/kitmanager.test.ts`
- [ ] Behavior verified in **presets mode** and **kits/variants mode**
- [ ] Behavior verified with **single-config** and **multi-config** generators
- [ ] Windows/macOS/Linux differences considered (paths, env vars, MSVC toolchain, generator availability)

### Backend tests (`yarn backendTests`)

The fastest feedback loop — runs via Mocha with no VS Code instance or display required.

- **Files go in** `test/unit-tests/backend/<name>.test.ts`
- **Framework:** Mocha TDD (`suite`/`test`), Chai `expect` assertions
- **Run:** `yarn backendTests`
- **Mock setup:** `test/unit-tests/backend/setup-vscode-mock.ts` provides minimal `vscode` stubs

**Import strategy:**
1. If the module has **no transitive `vscode` dependency** (e.g., `encodingUtils`, `cmakeValue`) → import directly via `@cmt/*`
2. If the module **transitively imports `vscode`** and the mock is insufficient → **mirror the pure function logic inline** in the test file. This is the established pattern in `expand.test.ts`, `targetMap.test.ts`, `shell-propagation.test.ts`.
3. **Heuristic:** Try `@cmt/*` import first. If it fails due to vscode dependency at runtime, fall back to mirroring.

## Where to start

- **Configure/build/test behavior** → `src/cmakeProject.ts` + `src/drivers/`
- **Build output / streaming** → `src/cmakeBuildRunner.ts`
- **Task provider (`tasks.json`)** → `src/cmakeTaskProvider.ts`
- **Preset loading or resolution** → `src/presets/presetsController.ts` + `presetsParser.ts`
- **Preset types / interfaces** → `src/presets/preset.ts`
- **Kit detection or environment** → `src/kits/kitsController.ts` + `kit.ts`
- **Variant handling** → `src/kits/variant.ts`
- **Variable expansion** → `src/expand.ts`
- **Command does nothing or crashes** → `src/extension.ts` handler registration
- **Sidebar item or context menu** → `src/ui/` node `contextValue` + `package.json` `when` clauses
- **Output panel text or log level** → `src/diagnostics/cmake.ts` (`CMakeOutputConsumer`)
- **Compiler-specific diagnostics** → `src/diagnostics/gcc.ts`, `msvc.ts`, `gnu-ld.ts`, etc.
- **Setting ignored or wrong source** → `src/config.ts` + `package.json` `contributes.configuration`
- **Preset file change not detected** → `src/presets/presetsController.ts` file watcher
- **CMake debugger** → `src/debug/cmakeDebugger/`