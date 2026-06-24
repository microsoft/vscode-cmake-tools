/**
 * Surfaces for rendering colorized build output.
 *
 * The VS Code Output panel is a Monaco text editor and does NOT render ANSI
 * escape codes (it shows them as literal text), so today colorized build output
 * is rendered in an integrated terminal ({@link BuildOutputTerminal}), backed by
 * xterm.js, which does render ANSI. The colorization itself (in `@cmt/colorize`)
 * produces surface-agnostic ANSI strings, so it is portable: if a future VS Code
 * renders ANSI in the Output panel, {@link OutputChannelBuildSink} routes the
 * SAME output to an Output channel with no other change — selected by the single
 * {@link canRenderAnsiInOutput} capability gate.
 *
 * In both cases the per-line build output is still written to the on-disk log
 * file (for diagnostics) and never duplicated into the regular CMake/Build
 * Output channel.
 */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as util from '@cmt/util';
import { BuildColorMode, BuildOutcome, ColorizedBuildSink, GlyphStyle, canRenderAnsiInOutput, decorateBuildLine, linkifyLeadingPath, renderBuildBanner, renderBuildSummary, selectSink } from '@cmt/colorize';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// Terminals require CRLF line endings; a bare '\n' causes staircasing.
const EOL = '\r\n';

/** Resolve a relative diagnostic path to an absolute one (if it exists), cached. */
function resolveExistingPath(rel: string, baseDirs: string[], cache: Map<string, string | undefined>): string | undefined {
    if (cache.has(rel)) {
        return cache.get(rel);
    }
    let abs: string | undefined;
    for (const base of baseDirs) {
        const candidate = util.resolvePath(rel, base);
        if (util.checkFileExistsSync(candidate)) {
            abs = candidate;
            break;
        }
    }
    cache.set(rel, abs);
    return abs;
}

/** Linkify (absolutize a relative leading path) then decorate a build-output line. */
function decoratedLine(line: string, mode: BuildColorMode, glyphs: GlyphStyle, baseDirs: string[], cache: Map<string, string | undefined>): string {
    const linked = baseDirs.length > 0 ? linkifyLeadingPath(line, rel => resolveExistingPath(rel, baseDirs, cache)) : line;
    return decorateBuildLine(linked, mode, glyphs);
}

/** Build the localized status text for the build-summary footer (rich mode). */
function summaryStatusText(outcome: BuildOutcome, counts: { errors: number; warnings: number }, buildStart: number, glyphs: GlyphStyle): string {
    const seconds = ((buildStart ? Date.now() - buildStart : 0) / 1000).toFixed(1);
    const word = outcome === 'succeeded'
        ? localize('build.colorized.succeeded', 'Build succeeded')
        : outcome === 'cancelled'
            ? localize('build.colorized.cancelled', 'Build cancelled')
            : localize('build.colorized.failed', 'Build failed');
    const dash = glyphs === 'unicode' ? '—' : '-';
    const countsText = localize('build.colorized.counts', '{0} error(s), {1} warning(s)', counts.errors, counts.warnings);
    return `${word} ${dash} ${countsText}  (${seconds}s)`;
}

const CHANNEL_NAME = localize('cmake.build.colorized.terminal.name', 'CMake Build');

class BuildOutputTerminal implements vscode.Pseudoterminal, ColorizedBuildSink {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number>();
    readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    readonly onDidClose: vscode.Event<number> = this.closeEmitter.event;

    private terminal?: vscode.Terminal;
    private isOpen = false;
    private pending: string[] = [];
    private buildStart = 0;
    // Base directories used to absolutize relative diagnostic paths so VS Code's
    // built-in terminal link detection can make them clickable. Cached per build.
    private baseDirs: string[] = [];
    private readonly linkCache = new Map<string, string | undefined>();

    /** Reveal the build terminal; `focus` takes keyboard focus. No-op if not created. */
    reveal(focus: boolean): void {
        this.terminal?.show(!focus);
    }

    // vscode.Pseudoterminal: called when the terminal is first shown.
    open(): void {
        this.isOpen = true;
        if (this.pending.length > 0) {
            this.writeEmitter.fire(this.pending.join(''));
            this.pending = [];
        }
    }

    // vscode.Pseudoterminal: called when the user closes the terminal.
    close(): void {
        this.isOpen = false;
        this.terminal = undefined;
        this.pending = [];
    }

    private ensureTerminal(): void {
        if (!this.terminal) {
            this.isOpen = false;
            this.pending = [];
            this.terminal = vscode.window.createTerminal({ name: CHANNEL_NAME, pty: this });
        }
    }

    private emit(text: string): void {
        if (this.isOpen) {
            this.writeEmitter.fire(text);
        } else {
            this.pending.push(text);
        }
    }

    /**
     * Prepare the terminal at the start of a build: create it if needed, clear it
     * when requested, record the start time, and optionally print a bold banner.
     * Revealing is left to the caller so it can honor `cmake.revealLog`.
     */
    prepareForBuild(clear: boolean, glyphs: GlyphStyle, bannerTarget?: string, baseDirs: string[] = []): void {
        this.ensureTerminal();
        this.baseDirs = baseDirs;
        this.linkCache.clear();
        if (clear) {
            // Clear screen + scrollback + move cursor home.
            this.emit('\u001b[2J\u001b[3J\u001b[H');
        }
        this.buildStart = Date.now();
        if (bannerTarget) {
            const header = localize('build.colorized.building', 'Building: {0}', bannerTarget);
            this.emit(renderBuildBanner(header, glyphs) + EOL);
        }
    }

    /** Write a single build-output line, decorated according to `mode`/`glyphs`. */
    writeLine(line: string, mode: BuildColorMode, glyphs: GlyphStyle): void {
        if (!this.terminal) {
            // The user closed the terminal mid-build; drop output rather than
            // recreate it hidden (which would surface stale output next build).
            return;
        }
        this.emit(decoratedLine(line, mode, glyphs, this.baseDirs, this.linkCache) + EOL);
    }

    /** Print the ruled, colored, localized build-summary footer (rich mode). */
    writeSummary(outcome: BuildOutcome, counts: { errors: number; warnings: number }, glyphs: GlyphStyle): void {
        if (!this.terminal) {
            return;
        }
        const statusText = summaryStatusText(outcome, counts, this.buildStart, glyphs);
        for (const line of renderBuildSummary(outcome, statusText, glyphs)) {
            this.emit(line + EOL);
        }
    }

    dispose(): void {
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
        this.terminal?.dispose();
        this.terminal = undefined;
    }
}

/**
 * A {@link ColorizedBuildSink} that writes colorized build output to a VS Code
 * Output channel. Only renders colors when the Output panel can render ANSI (see
 * {@link canRenderAnsiInOutput}); kept ready so the colorization is portable to
 * that surface with no other change.
 */
class OutputChannelBuildSink implements ColorizedBuildSink {
    private channel?: vscode.OutputChannel;
    private buildStart = 0;
    private baseDirs: string[] = [];
    private readonly linkCache = new Map<string, string | undefined>();

    private ensureChannel(): vscode.OutputChannel {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel(CHANNEL_NAME);
        }
        return this.channel;
    }

    reveal(focus: boolean): void {
        this.channel?.show(!focus);
    }

    prepareForBuild(clear: boolean, glyphs: GlyphStyle, bannerTarget?: string, baseDirs: string[] = []): void {
        const channel = this.ensureChannel();
        this.baseDirs = baseDirs;
        this.linkCache.clear();
        if (clear) {
            channel.clear();
        }
        this.buildStart = Date.now();
        if (bannerTarget) {
            const header = localize('build.colorized.building', 'Building: {0}', bannerTarget);
            channel.appendLine(renderBuildBanner(header, glyphs));
        }
    }

    writeLine(line: string, mode: BuildColorMode, glyphs: GlyphStyle): void {
        if (!this.channel) {
            return;
        }
        this.channel.appendLine(decoratedLine(line, mode, glyphs, this.baseDirs, this.linkCache));
    }

    writeSummary(outcome: BuildOutcome, counts: { errors: number; warnings: number }, glyphs: GlyphStyle): void {
        if (!this.channel) {
            return;
        }
        const statusText = summaryStatusText(outcome, counts, this.buildStart, glyphs);
        for (const line of renderBuildSummary(outcome, statusText, glyphs)) {
            this.channel.appendLine(line);
        }
    }

    dispose(): void {
        this.channel?.dispose();
        this.channel = undefined;
    }
}

let instance: ColorizedBuildSink | undefined;

/** The shared colorized build-output sink (terminal today; Output channel if VS Code renders ANSI). */
export function colorizedBuildSink(): ColorizedBuildSink {
    if (!instance) {
        instance = selectSink(canRenderAnsiInOutput(), () => new BuildOutputTerminal(), () => new OutputChannelBuildSink());
    }
    return instance;
}

/** Dispose the shared colorized build-output sink, if any. */
export function disposeColorizedBuildSink(): void {
    instance?.dispose();
    instance = undefined;
}
