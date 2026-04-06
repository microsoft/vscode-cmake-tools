# Adding a New Command

Recipe for adding a new `cmake.*` command to CMake Tools.

## Files you must touch

| File | What to add |
|------|-------------|
| `package.json` | Command declaration in `contributes.commands` + optional menu entries |
| `package.nls.json` | English title string |
| `src/extension.ts` | Method name in `funs` array + handler method on `ExtensionManager` |
| `CHANGELOG.md` | Entry under the current version |

---

## Step 1 — Declare the command in `package.json`

### 1a — `contributes.commands`

```jsonc
// package.json  →  contributes.commands
{
  "command": "cmake.myCommand",
  "title": "%cmake-tools.command.cmake.myCommand.title%",
  "category": "CMake"
}
```

### Rules

- **Command ID format:** `cmake.<commandName>` (camelCase).
- **Title:** NLS key in the format `%cmake-tools.command.cmake.<commandName>.title%`.
- **Category:** `"CMake"` — this prefixes the title in the Command Palette as `CMake: <title>`.
- **`when`** (optional): controls when the command appears in the Command Palette.
- **`icon`** (optional): Codicon reference like `"$(settings-gear)"` for tree-view inline buttons.

### 1b — `contributes.menus` (if needed)

Add visibility rules for where the command appears.

**Command Palette visibility:**

```jsonc
// package.json  →  contributes.menus.commandPalette
{
  "command": "cmake.myCommand",
  "when": "cmake:enableFullFeatureSet"
}
```

**Sidebar tree-view inline button:**

```jsonc
// package.json  →  contributes.menus["view/item/context"]
{
  "command": "cmake.projectStatus.myCommand",
  "when": "view == cmake.projectStatus && cmake:enableFullFeatureSet && viewItem == 'myItem'",
  "group": "inline"
}
```

Common `when` clause patterns:

| Pattern | Meaning |
|---------|---------|
| `cmake:enableFullFeatureSet` | Extension is fully activated |
| `useCMakePresets` | Presets mode is active |
| `!useCMakePresets` | Kits/variants mode is active |
| `view == cmake.projectStatus && viewItem == 'kit'` | Specific tree-view item |
| `viewItem =~ /configPreset/` | Regex match on tree-view item |

---

## Step 2 — Add the English string to `package.nls.json`

```json
"cmake-tools.command.cmake.myCommand.title": "My Command Title"
```

For titles containing the product name, use the object form with a translator comment:

```json
"cmake-tools.command.cmake.myCommand.title": {
  "message": "Do Something with CMake Tools",
  "comment": ["The text 'CMake Tools' should not be localized."]
}
```

> **Do not** modify any file under `i18n/`.

---

## Step 3 — Register the command in `src/extension.ts`

Add the method name to the `funs` array (around line 2458). The `register()` helper
auto-generates the command ID `cmake.<name>`, wraps it with debug logging, and hands
the promise to `rollbar.takePromise()` for error tracking.

```typescript
// src/extension.ts
const funs: (keyof ExtensionManager)[] = [
    // ... existing entries ...
    'myCommand',   // ← add here
];
```

That's it — no manual `registerCommand` call needed. The loop at line 2578 handles it:

```typescript
for (const key of funs) {
    context.subscriptions.push(register(key));
}
```

> Only use manual `vscode.commands.registerCommand()` for commands that need
> custom argument handling (e.g., tree-view context-menu commands that receive
> a node argument). Most commands go through the `funs` array.

---

## Step 4 — Implement the handler on `ExtensionManager`

Add a method to the `ExtensionManager` class in `src/extension.ts`. The method
name must match the string added to the `funs` array.

### Pattern A — Delegate to CMakeProject (most common)

```typescript
myCommand(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent('myCommand');
    return this.runCMakeCommand(
        cmakeProject => cmakeProject.myCommand(),
        folder,
        undefined, // precheck (optional)
        true       // cleanOutputChannel
    );
}
```

Then implement the actual logic on `CMakeProject` in `src/cmakeProject.ts`.

### Pattern B — Run for all projects

```typescript
myCommandAll() {
    telemetry.logEvent('myCommand', { all: 'true' });
    return this.runCMakeCommandForAll(
        cmakeProject => cmakeProject.myCommand()
    );
}
```

### Pattern C — Direct implementation (no CMakeProject delegation)

```typescript
async myCommand() {
    telemetry.logEvent('myCommand');
    const result = await vscode.window.showQuickPick(items);
    if (!result) {
        return;
    }
    // ... handle result ...
}
```

### Key helpers

| Helper | Use when |
|--------|----------|
| `this.runCMakeCommand(cmd, folder)` | Single-project command |
| `this.runCMakeCommandForAll(cmd)` | Runs on every open CMake project |
| `this.runCMakeCommandForProject(cmd, project)` | Specific project instance |

---

## Step 5 — Add a CHANGELOG entry

Add an entry under the current version in `CHANGELOG.md`, in the `Features:` section.

---

## Verification checklist

- [ ] `package.json` — command declared with NLS title and `"CMake"` category
- [ ] `package.json` — menu entries added (if applicable) with correct `when` clauses
- [ ] `package.nls.json` — English title string added
- [ ] `src/extension.ts` — method name added to `funs` array
- [ ] `src/extension.ts` — handler method implemented on `ExtensionManager`
- [ ] Handler uses `telemetry.logEvent()` for telemetry
- [ ] Handler delegates to `CMakeProject` via `runCMakeCommand` (if project-scoped)
- [ ] `CHANGELOG.md` — entry added
- [ ] `yarn compile` succeeds
- [ ] No files under `i18n/` were modified

---

*See also: [`.github/copilot-instructions.md`](../copilot-instructions.md) for project-wide conventions.*
