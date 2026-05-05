/**
 * Module for handling user-defined custom build diagnostic patterns.
 *
 * Users configure additional problem matchers via the
 * `cmake.additionalBuildProblemMatchers` setting. Each entry describes a regex
 * and capture-group mapping that is applied to every build-output line. Matched
 * lines are turned into `RawDiagnostic` objects and surfaced in the VS Code
 * Problems pane alongside the built-in compiler diagnostics.
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnosticParser, FeedLineResult, RawDiagnostic } from '@cmt/diagnostics/util';

/**
 * Configuration for a single user-defined problem matcher.
 *
 * Mirrors the JSON schema exposed through `cmake.additionalBuildProblemMatchers`
 * in `package.json`. See the docs for field-level descriptions.
 */
export interface BuildProblemMatcherConfig {
    /** Friendly name used as the diagnostic `source` label in the Problems pane. */
    name: string;
    /** The regular expression applied to each output line. */
    regexp: string;
    /** Capture group index for the file path. Defaults to 1. */
    file?: number;
    /** Capture group index for the line number. Defaults to 2. */
    line?: number;
    /** Capture group index for the column number. Optional. */
    column?: number;
    /**
     * Severity — either a capture group index (number) or a fixed string
     * (`"error"`, `"warning"`, or `"info"`).
     */
    severity?: number | string;
    /** Capture group index for the diagnostic message. Defaults to 3. */
    message?: number;
    /** Capture group index for an optional diagnostic code. */
    code?: number;
}

/**
 * A parser constructed at runtime from a single user-supplied
 * `BuildProblemMatcherConfig`. One instance is created for each entry in the
 * `cmake.additionalBuildProblemMatchers` array.
 */
export class CustomParser extends RawDiagnosticParser {
    private readonly regex: RegExp | null;
    private readonly fileGroup: number;
    private readonly lineGroup: number;
    private readonly columnGroup: number | undefined;
    private readonly severitySource: number | string;
    private readonly messageGroup: number;
    private readonly codeGroup: number | undefined;
    readonly name: string;

    constructor(config: BuildProblemMatcherConfig) {
        super();
        this.name = config.name;
        this.fileGroup = config.file ?? 1;
        this.lineGroup = config.line ?? 2;
        this.columnGroup = config.column;
        this.severitySource = config.severity ?? 'warning';
        this.messageGroup = config.message ?? 3;
        this.codeGroup = config.code;

        try {
            this.regex = new RegExp(config.regexp);
        } catch {
            // Invalid regex — the parser will never match anything.
            this.regex = null;
        }
    }

    protected doHandleLine(line: string): RawDiagnostic | FeedLineResult {
        if (!this.regex) {
            return FeedLineResult.NotMine;
        }

        const mat = this.regex.exec(line);
        if (!mat) {
            return FeedLineResult.NotMine;
        }

        const file = mat[this.fileGroup] ?? '';
        const lineNo = oneLess(mat[this.lineGroup] ?? '1');
        const colNo = this.columnGroup !== undefined ? oneLess(mat[this.columnGroup] ?? '1') : 0;

        let severity: string;
        if (typeof this.severitySource === 'number') {
            severity = (mat[this.severitySource] ?? 'warning').toLowerCase();
        } else {
            severity = this.severitySource.toLowerCase();
        }

        const message = mat[this.messageGroup] ?? '';
        const code = this.codeGroup !== undefined ? mat[this.codeGroup] : undefined;

        const range = this.columnGroup !== undefined
            ? new vscode.Range(lineNo, colNo, lineNo, colNo)
            : new vscode.Range(lineNo, 0, lineNo, 999);

        return {
            full: mat[0],
            file,
            location: range,
            severity,
            message,
            code,
            related: []
        };
    }
}
