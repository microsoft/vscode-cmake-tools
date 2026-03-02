---
name: add-setting
description: >
  Use when adding a new cmake.* configuration setting. Touches package.json
  (contributes.configuration), package.nls.json, src/config.ts (interface + getter),
  docs/cmake-settings.md, and CHANGELOG.md. Triggers: "add setting", "new setting",
  "add configuration".
---

# Adding a New Configuration Setting

Recipe for adding a new `cmake.*` setting to CMake Tools.

## Files you must touch

| File | What to add |
|------|-------------|
| `package.json` | Setting declaration in `contributes.configuration.properties` |
| `package.nls.json` | English description string |
| `src/config.ts` | Interface property + EventEmitter + getter |
| `docs/cmake-settings.md` | Row in the settings table |
| `CHANGELOG.md` | Entry under the current version |

---

## Step 1 — Declare the setting in `package.json`

Add an entry inside `contributes.configuration.properties`. Key format is `cmake.<settingName>`.

```jsonc
// package.json  →  contributes.configuration.properties
"cmake.myNewSetting": {
  "type": "boolean",
  "default": false,
  "description": "%cmake-tools.configuration.cmake.myNewSetting.description%",
  "scope": "resource"
}
```

### Rules

- **`type`** — `"boolean"`, `"string"`, `"number"`, `"array"`, `"object"`, or use `"oneOf"` for union types.
- **`default`** — always required.
- **`scope`** — use `"resource"` for project-specific settings (most common), `"window"` for global UI settings, `"machine-overridable"` for tool paths.
- **`description`** or **`markdownDescription`** — must use an NLS key, never a bare string.
- **NLS key format:** `%cmake-tools.configuration.cmake.<settingName>.description%` (wrapped in `%`).

### Real example — `cmake.saveBeforeBuild`

```json
"cmake.saveBeforeBuild": {
  "type": "boolean",
  "default": true,
  "description": "%cmake-tools.configuration.cmake.saveBeforeBuild.description%",
  "scope": "resource"
}
```

---

## Step 2 — Add the English string to `package.nls.json`

Add the NLS key (without the `%` wrappers) and its English text:

```json
"cmake-tools.configuration.cmake.myNewSetting.description": "Description of what this setting does."
```

> **Do not** modify any file under `i18n/`. Translations are handled separately.

---

## Step 3 — Wire up `src/config.ts` (three changes)

### 3a — Add property to `ExtensionConfigurationSettings`

```typescript
// src/config.ts  →  ExtensionConfigurationSettings interface
export interface ExtensionConfigurationSettings {
    // ... existing properties ...
    myNewSetting: boolean;
}
```

The type must match what you declared in `package.json`.

### 3b — Add EventEmitter to the `emitters` map

```typescript
// src/config.ts  →  ConfigurationReader.emitters
private readonly emitters: EmittersOf<ExtensionConfigurationSettings> = {
    // ... existing emitters ...
    myNewSetting: new vscode.EventEmitter<boolean>(),
};
```

The emitter type parameter must match the interface property type.

### 3c — Add a getter

Simple pass-through getter (most settings):

```typescript
get myNewSetting(): boolean {
    return this.configData.myNewSetting;
}
```

Getter with transformation logic (e.g., `sourceDirectory` normalizes to array):

```typescript
get sourceDirectory(): string[] {
    if (!Array.isArray(this.configData.sourceDirectory)) {
        return [this.configData.sourceDirectory];
    }
    return this.configData.sourceDirectory;
}
```

---

## Step 4 — Document in `docs/cmake-settings.md`

Add a row to the settings table. Keep alphabetical order.

```markdown
| `cmake.myNewSetting` | Description of what this setting does. | `false` | no |
```

Table columns:

| Column | Content |
|--------|---------|
| Setting | Backtick-quoted `cmake.<name>` |
| Description | Plain-English description |
| Default value | Backtick-quoted default |
| Supports substitution | `yes` if `${variable}` expansion applies, otherwise `no` |

---

## Step 5 — Add a CHANGELOG entry

Add an entry under the current version in `CHANGELOG.md`, in the `Features:` or `Improvements:` section.

---

## Verification checklist

- [ ] `package.json` — setting declared with correct type, default, scope, and NLS key
- [ ] `package.nls.json` — English string added
- [ ] `src/config.ts` — interface property, emitter, and getter all added
- [ ] `docs/cmake-settings.md` — table row added in alphabetical order
- [ ] `CHANGELOG.md` — entry added
- [ ] `yarn compile` succeeds (or `npm run compile`)
- [ ] No files under `i18n/` were modified

---

*See also: [`.github/copilot-instructions.md`](../copilot-instructions.md) for project-wide conventions.*
