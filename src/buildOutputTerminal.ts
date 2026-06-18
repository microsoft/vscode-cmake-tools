/**
 * A lazily-created integrated terminal used to display colorized build output.
 *
 * The VS Code Output panel is a Monaco text editor and does NOT render ANSI
 * escape codes (it shows them as literal text). The integrated terminal, backed
 * by xterm.js, does render ANSI. So when colorized build output is enabled, the
 * default (Output-channel) build path mirrors its output here, where the colors
 * actually show. The Output channel and on-disk log file are left untouched.
 */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { BuildColorMode, colorizeBuildLine } from '@cmt/colorize';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// Terminals require CRLF line endings; a bare '\n' causes staircasing.
const EOL = '\r\n';

class BuildOutputTerminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number>();
    readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    readonly onDidClose: vscode.Event<number> = this.closeEmitter.event;

    private terminal?: vscode.Terminal;
    private isOpen = false;
    private pending: string[] = [];

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
            this.terminal = vscode.window.createTerminal({
                name: localize('cmake.build.colorized.terminal.name', 'CMake Build'),
                pty: this
            });
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
     * when requested, and reveal it without stealing keyboard focus.
     */
    prepareForBuild(clear: boolean): void {
        this.ensureTerminal();
        if (clear) {
            // Clear screen + scrollback + move cursor home.
            this.emit('\u001b[2J\u001b[3J\u001b[H');
        }
        this.terminal?.show(true);
    }

    /** Write a single build-output line, colorized according to `mode`. */
    writeLine(line: string, mode: BuildColorMode): void {
        this.ensureTerminal();
        this.emit(colorizeBuildLine(line, mode) + EOL);
    }

    dispose(): void {
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
        this.terminal?.dispose();
        this.terminal = undefined;
    }
}

let instance: BuildOutputTerminal | undefined;

/** The shared colorized build-output terminal (created lazily). */
export function buildOutputTerminal(): BuildOutputTerminal {
    if (!instance) {
        instance = new BuildOutputTerminal();
    }
    return instance;
}

/** Dispose the shared colorized build-output terminal, if any. */
export function disposeBuildOutputTerminal(): void {
    instance?.dispose();
    instance = undefined;
}
