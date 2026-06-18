/**
 * Pure helpers for colorizing build output with ANSI SGR escape sequences.
 *
 * This module intentionally has NO dependency on the `vscode` API so it can be
 * unit-tested directly under `test/unit-tests/backend`.
 *
 * Design notes (accessibility):
 * - Only the basic named SGR colors (30-37 / 90-97) plus bold are used. VS Code
 *   remaps these to the active color theme's `terminal.ansi*` tokens, which High
 *   Contrast themes define explicitly for sufficient contrast. Hardcoded 24-bit
 *   (truecolor) or 256-color codes would ignore the theme and can render with
 *   poor contrast, so they are deliberately avoided.
 * - Color never carries meaning on its own: the severity words ("error",
 *   "warning", "note") remain verbatim in the text, and the authoritative
 *   Problems panel and on-disk log file are unaffected.
 * - Errors are additionally bold and notes use cyan (not green) so the red/green
 *   axis stays uncluttered for red-green color vision deficiency.
 */

export type BuildColorMode = 'off' | 'severity';

export enum BuildLineSeverity {
    Error,
    Warning,
    Note,
    Success,
    None
}

const ESC = '\u001b';
const RESET = `${ESC}[0m`;

/** Bold red. */
const SGR_ERROR = `${ESC}[1;31m`;
/** Yellow. */
const SGR_WARNING = `${ESC}[33m`;
/** Cyan. */
const SGR_NOTE = `${ESC}[36m`;
/** Green. */
const SGR_SUCCESS = `${ESC}[32m`;

// Conservative, well-anchored patterns covering the common compiler/build tools.
// GCC/Clang/CMake use "<file>:<line>:<col>: <severity>:"; MSVC uses
// "<severity> C####:" / "LNK####" / "RC####"; Ninja prints "FAILED:".
const ERROR_RE = /(:\s*(fatal error|error):)|(\b(error|fatal error)\s+(C\d+|LNK\d+|RC\d+|MSB\d+)\s*:)|(^FAILED:)|(\bmake(\[\d+\])?:\s+\*\*\*\s)/i;
const WARNING_RE = /(:\s*warning:)|(\bwarning\s+(C\d+|LNK\d+|MSB\d+|RC\d+)\s*:)/i;
const NOTE_RE = /:\s*(note|remark):/i;
const SUCCESS_RE = /\bBuilt target\s\S/;

/**
 * Classify a single (clean, ANSI-free) build-output line by severity. The
 * classification is purely cosmetic — it only drives coloring, never diagnostics.
 */
export function classifyBuildLine(line: string): BuildLineSeverity {
    if (ERROR_RE.test(line)) {
        return BuildLineSeverity.Error;
    }
    if (WARNING_RE.test(line)) {
        return BuildLineSeverity.Warning;
    }
    if (NOTE_RE.test(line)) {
        return BuildLineSeverity.Note;
    }
    if (SUCCESS_RE.test(line)) {
        return BuildLineSeverity.Success;
    }
    return BuildLineSeverity.None;
}

function sgrFor(severity: BuildLineSeverity): string | undefined {
    switch (severity) {
        case BuildLineSeverity.Error:
            return SGR_ERROR;
        case BuildLineSeverity.Warning:
            return SGR_WARNING;
        case BuildLineSeverity.Note:
            return SGR_NOTE;
        case BuildLineSeverity.Success:
            return SGR_SUCCESS;
        default:
            return undefined;
    }
}

/**
 * Return `line` wrapped in an ANSI SGR color sequence based on its severity.
 *
 * The line is returned unchanged when:
 * - `mode` is `'off'`,
 * - the line already contains an ANSI escape (a tool emitted its own colors — we
 *   pass it through so VS Code renders the tool's colors and we avoid nesting),
 * - the line does not classify into a known severity.
 */
export function colorizeBuildLine(line: string, mode: BuildColorMode): string {
    if (mode === 'off') {
        return line;
    }
    if (line.includes(ESC)) {
        return line;
    }
    const sgr = sgrFor(classifyBuildLine(line));
    return sgr ? `${sgr}${line}${RESET}` : line;
}
