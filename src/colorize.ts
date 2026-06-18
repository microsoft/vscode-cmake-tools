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

export type BuildColorMode = 'off' | 'severity' | 'rich';
export type GlyphStyle = 'unicode' | 'ascii';

export enum BuildLineSeverity {
    Error,
    Warning,
    Note,
    Success,
    None
}

const ESC = '\u001b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

/** Bold red. */
const SGR_ERROR = `${ESC}[1;31m`;
/** Yellow. */
const SGR_WARNING = `${ESC}[33m`;
/** Cyan. */
const SGR_NOTE = `${ESC}[36m`;
/** Green. */
const SGR_SUCCESS = `${ESC}[32m`;

// Force text (non-emoji) presentation for glyphs that have an emoji variant, so
// they render single-width in the terminal across platforms/fonts.
const VS_TEXT = '\uFE0E';
const GLYPHS: Record<GlyphStyle, Record<'Error' | 'Warning' | 'Note' | 'Success', string>> = {
    unicode: { Error: '✗', Warning: `⚠${VS_TEXT}`, Note: `ℹ${VS_TEXT}`, Success: '✓' },
    ascii: { Error: 'x', Warning: '!', Note: 'i', Success: '+' }
};

// Build-progress "noise" lines such as "[ 50%] ..." or "[12/34] ...". These are
// de-emphasized (dimmed) in rich mode so real diagnostics stand out.
const PROGRESS_RE = /^\s*\[\s*(?:\d+%|\d+\/\d+)\s*\]/;

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

function glyphFor(severity: BuildLineSeverity, glyphs: GlyphStyle): string | undefined {
    switch (severity) {
        case BuildLineSeverity.Error:
            return GLYPHS[glyphs].Error;
        case BuildLineSeverity.Warning:
            return GLYPHS[glyphs].Warning;
        case BuildLineSeverity.Note:
            return GLYPHS[glyphs].Note;
        case BuildLineSeverity.Success:
            return GLYPHS[glyphs].Success;
        default:
            return undefined;
    }
}

/** Whether a line is build-progress noise (e.g. "[ 50%] ..." / "[12/34] ..."). */
export function isProgressNoise(line: string): boolean {
    return PROGRESS_RE.test(line);
}

/**
 * Decorate a single build-output line for display in the integrated terminal.
 *
 * - `off` / `severity`: identical to {@link colorizeBuildLine} (behavior unchanged).
 * - `rich`: in addition to the severity color, prefixes an accessible severity
 *   glyph (the severity word stays in the text, so meaning is never color-only)
 *   and dims build-progress noise. Lines that already contain ANSI pass through.
 */
export function decorateBuildLine(line: string, mode: BuildColorMode, glyphs: GlyphStyle): string {
    if (mode !== 'rich') {
        return colorizeBuildLine(line, mode);
    }
    if (line.includes(ESC)) {
        return line;
    }
    const severity = classifyBuildLine(line);
    const sgr = sgrFor(severity);
    if (sgr) {
        const glyph = glyphFor(severity, glyphs);
        return `${sgr}${glyph ? `${glyph} ` : ''}${line}${RESET}`;
    }
    if (isProgressNoise(line)) {
        return `${DIM}${line}${RESET}`;
    }
    return line;
}

/** A bold header line printed at the start of a rich build. `headerText` is
 *  already localized by the caller (this module stays vscode-nls-free). */
export function renderBuildBanner(headerText: string, glyphs: GlyphStyle): string {
    const rule = (glyphs === 'unicode' ? '─' : '-').repeat(8);
    return `${BOLD}${rule} ${headerText} ${rule}${RESET}`;
}

export type BuildOutcome = 'succeeded' | 'failed' | 'cancelled';

/**
 * A two-line, ruled summary printed at the end of a rich build. `statusText` is
 * already localized by the caller; this function only applies a color, a glyph,
 * and a rule. Color/glyph never carry meaning alone — `statusText` always
 * contains the outcome word and the counts.
 */
export function renderBuildSummary(outcome: BuildOutcome, statusText: string, glyphs: GlyphStyle): string[] {
    let sgr: string;
    let severity: BuildLineSeverity;
    switch (outcome) {
        case 'succeeded':
            sgr = `${ESC}[1;32m`;
            severity = BuildLineSeverity.Success;
            break;
        case 'cancelled':
            sgr = `${ESC}[1;33m`;
            severity = BuildLineSeverity.Warning;
            break;
        default:
            sgr = `${ESC}[1;31m`;
            severity = BuildLineSeverity.Error;
            break;
    }
    const glyph = glyphFor(severity, glyphs);
    const rule = (glyphs === 'unicode' ? '─' : '-').repeat(60);
    return [
        `${sgr}${rule}${RESET}`,
        `${sgr}${glyph} ${statusText}${RESET}`
    ];
}
