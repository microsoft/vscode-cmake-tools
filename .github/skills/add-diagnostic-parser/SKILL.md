---
name: add-diagnostic-parser
description: >
  Use when adding a compiler or tool output parser for the Problems panel. Touches
  src/diagnostics/<name>.ts, src/diagnostics/build.ts, package.json
  (cmake.enabledOutputParsers), and package.nls.json. Triggers: "add parser",
  "new diagnostic parser", "parse compiler output".
---

# Adding a New Diagnostic / Output Parser

Recipe for adding a new compiler or tool output parser to CMake Tools. A parser extracts diagnostics (errors, warnings, notes) from build output and surfaces them in the VS Code **Problems** panel.

## Overview

Adding a parser touches **4 files** (plus tests and changelog):

| File | What to do |
|---|---|
| `src/diagnostics/<name>.ts` | Create the parser class |
| `src/diagnostics/build.ts` | Register the parser in `Compilers` |
| `package.json` | Add to `cmake.enabledOutputParsers` enum |
| `package.nls.json` | Update description if user-visible text changes |

---

## Step 1: Create the parser file

Create `src/diagnostics/<name>.ts`. Every parser extends `RawDiagnosticParser` (defined in `src/diagnostics/util.ts`) and exports a class named `Parser`.

### Base class contract

```typescript
// src/diagnostics/util.ts (simplified)
export abstract class RawDiagnosticParser {
    get diagnostics(): readonly RawDiagnostic[] { /* accumulated results */ }

    /** Called by the build consumer for every line of output. */
    handleLine(line: string): boolean {
        const result = this.doHandleLine(line);
        if (result === FeedLineResult.Ok) return true;        // line consumed, no new diagnostic
        if (result === FeedLineResult.NotMine) return false;   // line not recognized
        // Otherwise result is a RawDiagnostic — it gets stored automatically
        this._diagnostics.push(result);
        return true;
    }

    /** Implement this. Return a RawDiagnostic to emit, or a FeedLineResult. */
    protected abstract doHandleLine(line: string): RawDiagnostic | FeedLineResult;
}
```

### Minimal single-regex parser (like MSVC)

```typescript
/**
 * Module for parsing <ToolName> diagnostics
 */ /** */

import * as vscode from 'vscode';
import { oneLess, RawDiagnosticParser, FeedLineResult } from '@cmt/diagnostics/util';

// Regex that captures: file, line, severity, code (optional), message
export const REGEX = /^(.+):(\d+):\s+(error|warning|info)\s+(\w+):\s+(.*)$/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        const mat = REGEX.exec(line);
        if (!mat) {
            return FeedLineResult.NotMine;
        }
        const [full, file, lineStr, severity, code, message] = mat;
        const lineno = oneLess(lineStr);   // convert 1-based to 0-based
        return {
            full,
            file,
            location: new vscode.Range(lineno, 0, lineno, 999),
            severity,
            message,
            code,
            related: []
        };
    }
}
```

### Multi-line / stateful parser (like IAR)

For tools whose diagnostics span multiple lines, use internal state:

```typescript
import { RawDiagnosticParser, RawDiagnostic, FeedLineResult, oneLess } from '@cmt/diagnostics/util';

enum ParserState { init, pending_message }

export class Parser extends RawDiagnosticParser {
    private state = ParserState.init;
    private pending: RawDiagnostic | null = null;

    doHandleLine(line: string): RawDiagnostic | FeedLineResult {
        switch (this.state) {
            case ParserState.init: {
                const mat = FIRST_LINE_REGEX.exec(line);
                if (!mat) return FeedLineResult.NotMine;
                this.pending = { /* ... build partial diagnostic ... */ };
                this.state = ParserState.pending_message;
                return FeedLineResult.Ok;  // consumed, but not complete yet
            }
            case ParserState.pending_message: {
                if (/* line completes the diagnostic */) {
                    const diag = this.pending!;
                    this.reset();
                    return diag;           // emits the diagnostic
                }
                return FeedLineResult.Ok;  // still accumulating
            }
        }
        return FeedLineResult.NotMine;
    }
}
```

### Key types

```typescript
// src/diagnostics/util.ts
interface RawDiagnostic {
    full: string;               // the full matched line(s)
    file: string;               // source file path
    location: vscode.Range;     // 0-based range (use oneLess() for 1-based input)
    severity: string;           // 'error' | 'warning' | 'note' | 'info' | 'fatal error' | 'remark'
    message: string;
    code?: string;              // optional diagnostic code (e.g. 'C4996', 'LNK2019')
    related: RawRelated[];      // related diagnostics (notes, template backtraces)
}

enum FeedLineResult {
    Ok,       // line was consumed (but no new diagnostic produced yet)
    NotMine,  // line not recognized by this parser
}
```

`diagnosticSeverity()` in `util.ts` maps the severity string to `vscode.DiagnosticSeverity`. Recognized values: `'error'`, `'fatal error'`, `'catastrophic error'`, `'warning'`, `'note'`, `'info'`, `'remark'`.

---

## Step 2: Register in `src/diagnostics/build.ts`

Import the new parser module and add an instance to the `Compilers` class. The **property name** becomes the parser identifier used in `cmake.enabledOutputParsers`.

```typescript
// At the top — add import
import * as myparser from '@cmt/diagnostics/myparser';

// Inside the Compilers class — add property
export class Compilers {
    [compiler: string]: RawDiagnosticParser;

    gcc = new gcc.Parser();
    gnuld = new gnu_ld.Parser();
    ghs = new ghs.Parser();
    diab = new diab.Parser();
    msvc = new mvsc.Parser();
    iar = new iar.Parser();
    iwyu = new iwyu.Parser();
    myparser = new myparser.Parser();   // ← new parser
}
```

The `CompileOutputConsumer.error()` method iterates over all `Compilers` properties in declaration order, calling `parser.handleLine(line)`. The **first** parser to return `true` claims the line — order matters if your parser's regex could match lines from another compiler.

The `resolveDiagnostics()` method filters diagnostics by `config.enableOutputParsers` — only parsers whose name appears in that array will have their diagnostics shown in the Problems panel.

---

## Step 3: Update `package.json`

Add the parser name to the `cmake.enabledOutputParsers` enum. Decide whether it should be **default-enabled** or **opt-in**.

```jsonc
// package.json → contributes.configuration → cmake.enabledOutputParsers
"cmake.enabledOutputParsers": {
    "type": "array",
    "items": {
        "type": "string",
        "enum": [
            "cmake",
            "gcc",
            "gnuld",
            "msvc",
            "ghs",
            "diab",
            "iar",
            "iwyu",
            "myparser"     // ← add to enum
        ]
    },
    "default": [
        "cmake",
        "gcc",
        "gnuld",
        "msvc",
        "ghs",
        "diab"
        // only add here if default-enabled
    ]
}
```

---

## Step 4: Update `package.nls.json`

If any user-visible setting descriptions changed, update the localization key in `package.nls.json`. The `cmake.enabledOutputParsers` description uses the key `cmake-tools.configuration.cmake.enabledOutputParsers.description`.

---

## Step 5: Write tests

Add tests in `test/unit-tests/diagnostics.test.ts`. The test pattern:

```typescript
test('Parse <tool> error', () => {
    const build_consumer = new diags.CompileOutputConsumer(
        new ConfigurationReader({} as ExtensionConfigurationSettings)
    );
    // Feed real compiler output lines
    build_consumer.error('<tool-specific output line>');

    // Verify diagnostics
    const parser = build_consumer.compilers.myparser;
    expect(parser.diagnostics).to.have.length(1);
    expect(parser.diagnostics[0].severity).to.eq('error');
    expect(parser.diagnostics[0].file).to.eq('expected/file.cpp');
});
```

---

## Step 6: `CHANGELOG.md`

Add an entry under the current version:

```markdown
Features:
- Add `myparser` diagnostic parser for <ToolName> compiler output. [PR #XXXX](https://github.com/microsoft/vscode-cmake-tools/pull/XXXX)
```

---

## Currently registered parsers

| Property in `Compilers` | Module file | Default-enabled |
|---|---|---|
| `gcc` | `src/diagnostics/gcc.ts` | ✅ |
| `gnuld` | `src/diagnostics/gnu-ld.ts` | ✅ |
| `ghs` | `src/diagnostics/ghs.ts` | ✅ |
| `diab` | `src/diagnostics/diab.ts` | ✅ |
| `msvc` | `src/diagnostics/msvc.ts` | ✅ |
| `iar` | `src/diagnostics/iar.ts` | ❌ opt-in |
| `iwyu` | `src/diagnostics/iwyu.ts` | ❌ opt-in |

The `cmake` parser (in `src/diagnostics/cmake.ts`) is separate — it handles CMake's own configure/generate output via `CMakeOutputConsumer`, not build compiler output. It is listed in the `enabledOutputParsers` default array but is **not** part of the `Compilers` class.

---

## Default-enabled vs opt-in

- **Default-enabled** parsers (`cmake`, `gcc`, `gnuld`, `msvc`, `ghs`, `diab`) are included in the `"default"` array in `package.json`. Users get them automatically.
- **Opt-in** parsers (`iar`, `iwyu`) are in the `"enum"` but **not** in `"default"`. Users must add them to their `cmake.enabledOutputParsers` setting.
- Use opt-in for parsers with aggressive regexes that might false-positive on common output, or for niche toolchains.

---

## Verification checklist

- [ ] Parser class extends `RawDiagnosticParser` and exports as `Parser`
- [ ] `doHandleLine()` returns `FeedLineResult.NotMine` for unrecognized lines
- [ ] `doHandleLine()` returns a `RawDiagnostic` (not `FeedLineResult.Ok`) when a diagnostic is complete
- [ ] Line/column numbers converted from 1-based to 0-based with `oneLess()`
- [ ] Registered in `Compilers` class in `src/diagnostics/build.ts`
- [ ] Added to `cmake.enabledOutputParsers` enum in `package.json`
- [ ] Default array updated (or deliberately left opt-in)
- [ ] Unit tests in `test/unit-tests/diagnostics.test.ts` pass
- [ ] `yarn compile` succeeds
- [ ] `CHANGELOG.md` entry added

---

See also: [`.github/copilot-instructions.md`](../copilot-instructions.md) for project-wide conventions.
