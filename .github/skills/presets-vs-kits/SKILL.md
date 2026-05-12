---
name: presets-vs-kits
description: >
  Use when writing or reviewing code that must work in both CMake Presets and
  Kits/Variants modes. Covers configure, build, test, environment, and generator
  paths. Triggers: "presets vs kits", "useCMakePresets", "works in both modes".
---

# Presets Mode vs Kits/Variants Mode

Guide for writing code that works correctly in **both** operating modes of CMake Tools. Any shared code path (configure, build, test, environment, targets) **must** handle both modes.

---

## The two modes

CMake Tools operates in one of two mutually exclusive modes per project folder:

| | **Presets mode** | **Kits/variants mode** |
|---|---|---|
| **Source of truth** | `CMakePresets.json` / `CMakeUserPresets.json` | Kit selection + variant settings |
| **When active** | `cmake.useCMakePresets` is `'always'`, or `'auto'` and preset files exist | `cmake.useCMakePresets` is `'never'`, or `'auto'` and no preset files exist |
| **Runtime check** | `CMakeProject.useCMakePresets === true` | `CMakeProject.useCMakePresets === false` |

### How the mode is determined

```typescript
// src/config.ts
export type UseCMakePresets = 'always' | 'never' | 'auto';

// src/cmakeProject.ts — doUseCMakePresetsChange()
const usingCMakePresets =
    useCMakePresets === 'always' ? true :
    useCMakePresets === 'never'  ? false :
    await this.hasPresetsFiles();          // 'auto' — check for CMakePresets.json
```

The resolved boolean is stored in `CMakeProject._useCMakePresets` and exposed via the `useCMakePresets` getter.

---

## When you MUST handle both modes

**Any shared code path** that touches configure, build, test, environment setup, or target resolution must branch on the mode. Omitting the check for one mode is a latent bug.

### The canonical branching pattern

```typescript
// From src/cmakeProject.ts — configure validation (real code)
if (!this.useCMakePresets) {
    // Kits mode: require a kit and variant
    if (!this.activeKit) {
        await vscode.window.showErrorMessage(
            localize('cannot.configure.no.kit', 'Cannot configure: No kit is active for this CMake project')
        );
        return { exitCode: -1, resultType: ConfigureResultType.Other };
    }
    if (!this.variantManager.haveVariant) {
        await this.variantManager.selectVariant();
    }
} else if (!this.configurePreset) {
    // Presets mode: require a configure preset
    void vscode.window.showErrorMessage(
        localize('cannot.configure.no.config.preset', 'Cannot configure: No configure preset is active')
    );
    return { exitCode: -1, resultType: ConfigureResultType.Other };
}
```

### Another real example — default build targets

```typescript
// src/cmakeProject.ts — getDefaultBuildTargets()
if (this.useCMakePresets && (!defaultTarget || defaultTarget === this.targetsInPresetName)) {
    targets = this.buildPreset?.targets;
}
if (!this.useCMakePresets && !defaultTarget) {
    targets = await this.allTargetName;
}
```

---

## Canonical data access — Presets mode

### Merged preset tree

Use `PresetsController` (in `src/presets/presetsController.ts`) to access the merged, expanded preset tree. **Never** re-parse `CMakePresets.json` or `CMakeUserPresets.json` directly — the controller handles `include` chaining, expansion, and file watching.

### Active presets on `CMakeProject`

```typescript
CMakeProject.configurePreset   // ConfigurePreset | null
CMakeProject.buildPreset       // BuildPreset | null
CMakeProject.testPreset        // TestPreset | null
CMakeProject.packagePreset     // PackagePreset | null
CMakeProject.workflowPreset    // WorkflowPreset | null
```

### Preset types

All preset interfaces are defined in `src/presets/preset.ts`. Key types include `ConfigurePreset`, `BuildPreset`, `TestPreset`, `PackagePreset`, `WorkflowPreset`.

### CMake executable override

In presets mode, the configure preset can override the CMake path:

```typescript
// src/cmakeProject.ts
const overWriteCMakePathSetting = this.useCMakePresets
    ? this.configurePreset?.cmakeExecutable
    : undefined;
```

---

## Canonical data access — Kits/variants mode

### Active kit

```typescript
CMakeProject.activeKit   // Kit | null — from src/kits/kit.ts
```

### Kit environment

```typescript
import { effectiveKitEnvironment } from '@cmt/kits/kit';

// Used in src/drivers/cmakeDriver.ts:
this._kitEnvironmentVariables = await effectiveKitEnvironment(kit, this.expansionOptions);
```

This merges compiler paths, VS Developer Environment (on Windows via `vcvarsall.bat`), and any custom `environmentVariables` defined on the kit.

### SpecialKits — always check before treating a kit as a real compiler

```typescript
// src/kits/kit.ts
export enum SpecialKits {
    ScanForKits = '__scanforkits__',
    Unspecified = '__unspec__',
    ScanSpecificDir = '__scan_specific_dir__',
}
```

These sentinel values appear in the kit list as UI actions. Before using `kit.compilers`, `kit.toolchainFile`, or `kit.preferredGenerator`, check:

```typescript
if (kit.name === SpecialKits.Unspecified || kit.name === SpecialKits.ScanForKits) {
    // Not a real kit — skip compiler logic
}
```

### Kit interface

```typescript
// src/kits/kit.ts (key fields)
export interface Kit extends KitDetect {
    name: string;
    description?: string;
    preferredGenerator?: CMakeGenerator;
    cmakeSettings?: Record<string, string | string[]>;
    compilers?: Record<string, string>;
    toolchainFile?: string;
    environmentVariables?: Record<string, string>;
    environmentSetupScript?: string;
    visualStudio?: string;
    visualStudioArchitecture?: string;
}
```

### Variant handling

Variants (`src/kits/variant.ts`) provide build type and other CMake variable overrides in kits mode. The `VariantManager` is only initialized when **not** using presets:

```typescript
// src/cmakeProject.ts
if (!this.useCMakePresets) {
    await this.variantManager.initialize(this.folderName);
    await drv.setVariant(this.variantManager.activeVariantOptions, ...);
}
```

---

## Generator handling in both modes

### Multi-config vs single-config

Always check the generator before any build-type logic:

```typescript
import { isMultiConfGeneratorFast } from '@cmt/util';

// src/util.ts
export function isMultiConfGeneratorFast(gen?: string): boolean {
    return gen !== undefined
        && (gen.includes('Visual Studio') || gen.includes('Xcode') || gen.includes('Multi-Config'));
}
```

| Generator type | Examples | Build type mechanism |
|---|---|---|
| **Single-config** | Ninja, Unix Makefiles | `CMAKE_BUILD_TYPE` set at **configure** time |
| **Multi-config** | Visual Studio, Xcode, Ninja Multi-Config | `--config <type>` passed at **build** time |

### Exception: `cmake.setBuildTypeOnMultiConfig`

When this setting is `true`, `CMAKE_BUILD_TYPE` is also set at configure time for multi-config generators (used by some CMake scripts that read it). See `src/drivers/cmakeDriver.ts`.

### How it shows up in both modes

- **Presets mode**: The generator is embedded in `configurePreset.generator`. The preset may also set `CMAKE_BUILD_TYPE` in `cacheVariables` or use `configuration` in the build preset.
- **Kits mode**: The generator comes from `Kit.preferredGenerator.name` or is auto-detected. Build type comes from the active variant.

---

## Common mistakes

### 1. Testing only one mode

If you add or change behavior in a shared code path, you must verify it works in **both** presets mode and kits/variants mode. Many bugs ship because the developer only tested with presets (or only with kits).

### 2. Assuming single-config generator

Never assume `CMAKE_BUILD_TYPE` is the way to set the build configuration. Always check `isMultiConfGeneratorFast()` first.

```typescript
// ❌ Wrong — breaks with Visual Studio / Ninja Multi-Config
args.push(`-DCMAKE_BUILD_TYPE=${buildType}`);

// ✅ Correct
if (!isMultiConfGeneratorFast(generator)) {
    args.push(`-DCMAKE_BUILD_TYPE=${buildType}`);
}
```

### 3. Reading preset files directly

```typescript
// ❌ Wrong — bypasses include chaining, expansion, and caching
const presets = JSON.parse(fs.readFileSync('CMakePresets.json', 'utf8'));

// ✅ Correct — use the PresetsController
const configPreset = this.configurePreset;
```

### 4. Not checking for SpecialKits sentinel values

```typescript
// ❌ Wrong — crashes when kit is '__unspec__' or '__scanforkits__'
const compiler = kit.compilers?.['C'];

// ✅ Correct
if (kit.name !== SpecialKits.Unspecified && kit.name !== SpecialKits.ScanForKits) {
    const compiler = kit.compilers?.['C'];
}
```

### 5. Forgetting the driver instance guard

In kits mode, no driver is created without a kit:

```typescript
// src/cmakeProject.ts
if (!this.useCMakePresets && !this.activeKit) {
    log.debug(localize('not.starting.no.kits', 'Not starting CMake driver: no kit selected'));
    return null;
}
```

Always handle `null` driver returns in calling code.

---

## Testing checklist

- [ ] Verified in **presets mode** (create a `CMakePresets.json` with configure + build presets)
- [ ] Verified in **kits/variants mode** (remove preset files or set `cmake.useCMakePresets: "never"`)
- [ ] Verified with a **single-config** generator (Ninja or Unix Makefiles)
- [ ] Verified with a **multi-config** generator (Visual Studio, Ninja Multi-Config, or Xcode)
- [ ] `SpecialKits` sentinel values handled (no crash on `__unspec__` kit)
- [ ] `null` driver / `null` preset / `null` kit cases handled gracefully
- [ ] Windows, macOS, and Linux path differences considered

---

See also: [`.github/copilot-instructions.md`](../copilot-instructions.md) for project-wide conventions.
