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

export type BuildColorMode = 'off' | 'severity' | 'rich' | 'compiler';
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
    if (mode === 'off' || mode === 'compiler') {
        return line;
    }
    if (line.includes(ESC)) {
        return line;
    }
    const sgr = sgrFor(classifyBuildLine(line));
    return sgr ? `${sgr}${line}${RESET}` : line;
}

const OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// CSI: ESC [ , parameter bytes (0x30-0x3F: 0-9 : ; < = > ?), intermediate bytes
// (0x20-0x2F), final byte (0x40-0x7E). The full parameter-byte class (not just
// "[0-9;?]") covers SGR colon sub-parameters such as ESC[4:3m.
const CSI_RE = /\u001b\[[0-9:;<=>?]*[ -/]*[@-~]/g;
const LONE_ESC_RE = /\u001b[@-Z\\-_]/g;

/**
 * Remove ANSI escape sequences (SGR colors, other CSI, OSC hyperlinks, and lone
 * two-character escapes) from a string. Pure; used to feed the diagnostic parsers
 * and the on-disk log clean text when a tool emits its own colors (e.g. the
 * `compiler` mode forces `-fdiagnostics-color`). No-op fast path for the common
 * case of a line without any escape.
 */
export function stripAnsi(s: string): string {
    if (s.indexOf(ESC) === -1) {
        return s;
    }
    return s.replace(OSC_RE, '').replace(CSI_RE, '').replace(LONE_ESC_RE, '');
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
    if (mode === 'off' || mode === 'compiler') {
        // off: no decoration. compiler: the tool emits its own real ANSI colors,
        // which we forward verbatim (no synthetic severity color or glyph).
        return line;
    }
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

/** True if `p` looks like an absolute path (drive, UNC, or leading slash), platform-independently. */
export function isAbsoluteLike(p: string): boolean {
    return /^([A-Za-z]:[\\/]|[\\/])/.test(p);
}

// Leading diagnostic location: GCC/Clang/Ninja "<file>:<line>[:<col>]:" or MSVC "<file>(<line>[,<col>]):".
// The MSVC form requires the trailing ':' so a file literally named like "foo(1).cpp" is not mis-split.
const LEADING_LOCATION_RE = /^(\s*)(.+?)(:\d+(?::\d+)?:|\(\d+(?:,\d+)?\):)/;

/** The leading "<file>" token of a diagnostic location line, if present. */
export function leadingPathToken(line: string): { file: string; start: number; end: number } | undefined {
    const m = LEADING_LOCATION_RE.exec(line);
    if (!m) {
        return undefined;
    }
    const start = m[1].length;
    const file = m[2];
    return { file, start, end: start + file.length };
}

/**
 * Display-only: rewrite the leading *relative* source path of a diagnostic line to
 * an absolute path so VS Code's built-in terminal link detection can make it
 * clickable (a Pseudoterminal has no cwd, so relative paths are not linkable).
 *
 * `resolveExisting(rel)` must return the absolute path iff the file exists, else
 * `undefined`. This keeps the module pure — all filesystem access is the caller's.
 * Only error/warning/note lines are touched, and only when the path is relative
 * and resolves to a real file, so it never corrupts non-location text.
 */
export function linkifyLeadingPath(line: string, resolveExisting: (rel: string) => string | undefined): string {
    if (line.includes(ESC)) {
        return line;
    }
    const severity = classifyBuildLine(line);
    if (severity !== BuildLineSeverity.Error && severity !== BuildLineSeverity.Warning && severity !== BuildLineSeverity.Note) {
        return line;
    }
    const tok = leadingPathToken(line);
    if (!tok || isAbsoluteLike(tok.file)) {
        return line;
    }
    const abs = resolveExisting(tok.file);
    return abs ? line.slice(0, tok.start) + abs + line.slice(tok.end) : line;
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

/**
 * A surface that renders colorized build output. Implemented by an integrated
 * terminal (today) or — if VS Code can render ANSI in the Output panel — an
 * Output channel. The ANSI strings produced by this module are identical for
 * both surfaces, so the colorization is portable across them.
 */
export interface ColorizedBuildSink {
    /** Open the build surface (creating it if needed) *before* the pre-build configure runs,
     * optionally clearing it, so the surface appears immediately when the user starts a build
     * rather than only once configuration finishes. Writes a short "preparing" notice; the
     * caller is responsible for revealing via {@link reveal}. */
    prepareForConfigure(clear: boolean): void;
    prepareForBuild(clear: boolean, glyphs: GlyphStyle, bannerTarget?: string, baseDirs?: string[]): void;
    writeLine(line: string, mode: BuildColorMode, glyphs: GlyphStyle): void;
    writeSummary(outcome: BuildOutcome, counts: { errors: number; warnings: number }, glyphs: GlyphStyle): void;
    /** Reveal the sink's surface. Returns `true` if a surface was actually revealed
     * (`false` if there is nothing to reveal, e.g. the terminal was closed mid-build). */
    reveal(focus: boolean): boolean;
    dispose(): void;
}

/**
 * Whether the VS Code Output panel can render ANSI escape codes. Today this is
 * `false`: the Output panel is a Monaco text editor that shows escapes as literal
 * text, so colorized build output is rendered in an integrated terminal instead.
 * If a future VS Code renders ANSI in the Output panel, flipping this to `true`
 * routes the SAME colorized output to the Output channel with no other change.
 */
export function canRenderAnsiInOutput(): boolean {
    return false;
}

/** Pure sink selection: the Output channel when it can render ANSI, else a terminal. */
export function selectSink(canRender: boolean, makeTerminal: () => ColorizedBuildSink, makeChannel: () => ColorizedBuildSink): ColorizedBuildSink {
    return canRender ? makeChannel() : makeTerminal();
}
