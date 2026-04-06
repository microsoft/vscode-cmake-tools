# Writing Backend Tests

Recipe for adding backend (unit) tests that run without VS Code.

## When to use backend tests

Use backend tests for **pure logic** that has no VS Code UI interaction. They are the
fastest feedback loop — no Extension Host, no display server, just Node + Mocha.

Good candidates: string manipulation, path logic, parsers, encoding, variable expansion,
data-structure helpers, environment merging.

**Not** suitable for: anything that calls `vscode.window.*`, `vscode.workspace.*` beyond
`getConfiguration()`, or depends on an active editor.

---

## File location

```
test/unit-tests/backend/<name>.test.ts
```

---

## Import strategy — decision tree

### Module has NO transitive `vscode` dependency

Import directly via the `@cmt/*` path alias.

```typescript
// encoding.test.ts — encodingUtils has no vscode imports
import { isValidUtf8 } from '@cmt/encodingUtils';
```

### Module transitively imports `vscode`

**Mirror** the pure function logic inline in the test file. Do **not** import the
source module — it will fail because `vscode` cannot be resolved at test time
(even with the mock, deep transitive chains can break).

```typescript
// expand.test.ts — expand.ts transitively depends on vscode
// Mirror of expand.substituteAll
function substituteAll(input: string, subs: Map<string, string>) {
    let finalString = input;
    let didReplacement = false;
    subs.forEach((value, key) => {
        if (value !== key) {
            const pattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(pattern, 'g');
            finalString = finalString.replace(re, value);
            didReplacement = true;
        }
    });
    return { result: finalString, didReplacement };
}
```

Add a comment like `// --- Mirror of <module>.<function> ---` so reviewers
can trace back to the source.

### What `setup-vscode-mock.ts` provides

The mock is auto-loaded via Mocha's `-r` flag. It intercepts `require('vscode')` and
returns stubs for:

- `workspace.getConfiguration()` — returns a Proxy that yields `undefined`
- `workspace.onDidChangeConfiguration` / `onDidCreateFiles` / `onDidDeleteFiles` — no-ops
- `window.createOutputChannel` / `showErrorMessage` / `showWarningMessage` — no-ops
- `commands.registerCommand` / `executeCommand` — no-ops
- `Position`, `Range`, `Uri` — minimal implementations
- `EventEmitter`, `Disposable`, `TreeItem`, `ThemeIcon` — stubs

This lets some modules with shallow `vscode` dependencies work. If your module only
touches `vscode.workspace.getConfiguration()`, direct import may still work. Test it —
if it fails, fall back to the mirror pattern.

---

## Test framework

| Aspect | Value |
|--------|-------|
| **Runner** | Mocha |
| **Style** | TDD — use `suite()` / `test()`, **not** `describe()` / `it()` |
| **Assertions** | Chai `expect` — `import { expect } from 'chai'` |
| **Path aliases** | `@cmt/*` → `src/*`, `@test/*` → `test/*` |

---

## Skeleton — direct import pattern

```typescript
import { expect } from 'chai';
import { myFunction } from '@cmt/myModule';

suite('[myFunction]', () => {
    test('does the expected thing', () => {
        const result = myFunction('input');
        expect(result).to.equal('expected');
    });

    test('handles edge case', () => {
        expect(myFunction('')).to.equal('');
    });
});
```

## Skeleton — mirror pattern

```typescript
import { expect } from 'chai';

/**
 * Tests for pure utility functions in src/someModule.ts.
 * Functions are mirrored here because someModule.ts transitively
 * depends on 'vscode'.
 */

// --- Mirror of someModule.helperFn ---
function helperFn(input: string): string {
    // Copy the implementation verbatim from the source
    return input.trim().toLowerCase();
}

suite('[helperFn]', () => {
    test('trims and lowercases', () => {
        expect(helperFn('  Hello  ')).to.equal('hello');
    });

    test('empty string', () => {
        expect(helperFn('')).to.equal('');
    });
});
```

---

## Run command

```bash
yarn backendTests
```

Full command (for reference):

```bash
node ./node_modules/mocha/bin/_mocha \
  -u tdd \
  --timeout 999999 \
  --colors \
  -r ts-node/register \
  -r tsconfig-paths/register \
  -r test/unit-tests/backend/setup-vscode-mock.ts \
  ./test/unit-tests/backend/**/*.test.ts
```

---

## Common pitfalls

| Pitfall | Fix |
|---------|-----|
| `Cannot find module 'vscode'` | Module has a transitive vscode dependency — use the mirror pattern |
| `suite is not defined` | Mocha TDD interface not loaded — ensure you run via `yarn backendTests`, not `mocha` directly |
| Import path uses relative `../../../src/` | Use `@cmt/*` alias instead — `tsconfig-paths/register` resolves it |
| `describe`/`it` used instead of `suite`/`test` | This project uses Mocha TDD style — switch to `suite`/`test` |
| Mock returns `undefined` for a config value | `setup-vscode-mock.ts`'s `getConfiguration()` returns `undefined` for everything — if your code needs a real value, you may need to extend the mock or restructure |

---

*See also: [`.github/copilot-instructions.md`](../copilot-instructions.md) for project-wide conventions.*
