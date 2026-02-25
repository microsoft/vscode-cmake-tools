/**
 * Module for handling build diagnostics (from the compiler/linker)
 */ /** */

import { Logger } from '@cmt/logging';
import * as proc from '@cmt/proc';
import { OutputConsumer } from '@cmt/proc';
import * as util from '@cmt/util';
import * as vscode from 'vscode';

import * as gcc from '@cmt/diagnostics/gcc';
import * as ghs from '@cmt/diagnostics/ghs';
import * as diab from '@cmt/diagnostics/diab';
import * as gnu_ld from '@cmt/diagnostics/gnu-ld';
import * as mvsc from '@cmt/diagnostics/msvc';
import * as iar from '@cmt/diagnostics/iar';
import * as iwyu from '@cmt/diagnostics/iwyu';
import { CustomParser } from '@cmt/diagnostics/custom';
import { FileDiagnostic, RawDiagnostic, RawDiagnosticParser } from '@cmt/diagnostics/util';
import { ConfigurationReader } from '@cmt/config';
import { fs } from '@cmt/pr';

export class Compilers {
    [compiler: string]: RawDiagnosticParser;

    gcc = new gcc.Parser();
    gnuld = new gnu_ld.Parser();
    ghs = new ghs.Parser();
    diab = new diab.Parser();
    msvc = new mvsc.Parser();
    iar = new iar.Parser();
    iwyu = new iwyu.Parser();
}

export class CompileOutputConsumer implements OutputConsumer {
    readonly customParsers: Map<string, CustomParser> = new Map();

    constructor(readonly config: ConfigurationReader) {
        for (const matcherConfig of config.additionalBuildProblemMatchers ?? []) {
            if (matcherConfig.name && matcherConfig.regexp) {
                this.customParsers.set(matcherConfig.name, new CustomParser(matcherConfig));
            }
        }
    }

    compilers = new Compilers();

    // Defer all output to the `error` method
    output(line: string) {
        this.error(line);
    }

    error(line: string) {
        // Built-in parsers get first priority
        for (const cand in this.compilers) {
            if (this.compilers[cand].handleLine(line)) {
                return;
            }
        }
        // Custom user-defined parsers run after built-ins
        for (const [, parser] of this.customParsers) {
            if (parser.handleLine(line)) {
                return;
            }
        }
    }

    async resolvePath(file: string, basePaths: string[]): Promise<string> {
        for (const basePath of basePaths) {
            const resolved = util.resolvePath(file, basePath);
            if (await util.checkFileExists(resolved)) {
                return resolved;
            }
        }
        return util.resolvePath(file, basePaths[0] ?? '');
    }

    async resolveDiagnostics(...basePaths: string[]): Promise<FileDiagnostic[]> {
        const diags_by_file = new Map<string, vscode.Diagnostic[]>();
        const linkerHandler = this.createLinkerDiagnosticsHandler(basePaths);

        const severity_of = (p: string) => {
            switch (p) {
                case 'warning':
                    return vscode.DiagnosticSeverity.Warning;
                case 'catastrophic error':
                case 'fatal error':
                case 'error':
                    return vscode.DiagnosticSeverity.Error;
                case 'note':
                case 'info':
                case 'remark':
                    return vscode.DiagnosticSeverity.Information;
            }
            // tslint:disable-next-line
            console.warn('Unknown diagnostic severity level: ' + p);
            return undefined;
        };

        const by_source = {
            GCC: this.compilers.gcc.diagnostics,
            MSVC: this.compilers.msvc.diagnostics,
            GHS: this.compilers.ghs.diagnostics,
            DIAB: this.compilers.diab.diagnostics,
            GNULD: this.compilers.gnuld.diagnostics,
            IAR: this.compilers.iar.diagnostics,
            IWYU: this.compilers.iwyu.diagnostics
        };
        const parsers = util.objectPairs(by_source)
            .filter(([source, _]) => this.config.enableOutputParsers?.includes(source.toLowerCase()) ?? false);
        const arrs: FileDiagnostic[] = [];

        await linkerHandler.maybeEnsureFileFromDiagnostics(this.compilers.msvc.diagnostics);
        for (const [ source, diags ] of parsers) {
            for (const raw_diag of diags) {
                await linkerHandler.collect(raw_diag, source, arrs.length);
                const filepath = await this.resolvePath(raw_diag.file, basePaths);
                const severity = severity_of(raw_diag.severity);
                if (severity === undefined) {
                    continue;
                }

                const diag = new vscode.Diagnostic(raw_diag.location, raw_diag.message, severity);
                diag.source = source;
                if (raw_diag.code) {
                    diag.code = raw_diag.code;
                }
                if (!diags_by_file.has(filepath)) {
                    diags_by_file.set(filepath, []);
                }
                diag.relatedInformation = [];
                for (const rel of raw_diag.related) {
                    const relFilePath = vscode.Uri.file(await this.resolvePath(rel.file, basePaths));
                    const related = new vscode.DiagnosticRelatedInformation(new vscode.Location(relFilePath, rel.location), rel.message);
                    diag.relatedInformation.push(related);
                }
                diags_by_file.get(filepath)!.push(diag);
                arrs.push({
                    filepath,
                    diag
                });
            }
        }

        await linkerHandler.finalize(arrs);

        // Include diagnostics from custom user-defined parsers (always enabled)
        for (const [name, parser] of this.customParsers) {
            for (const raw_diag of parser.diagnostics) {
                const filepath = await this.resolvePath(raw_diag.file, basePaths);
                const severity = severity_of(raw_diag.severity);
                if (severity === undefined) {
                    continue;
                }

                const diag = new vscode.Diagnostic(raw_diag.location, raw_diag.message, severity);
                diag.source = name;
                if (raw_diag.code) {
                    diag.code = raw_diag.code;
                }
                if (!diags_by_file.has(filepath)) {
                    diags_by_file.set(filepath, []);
                }
                diag.relatedInformation = [];
                for (const rel of raw_diag.related) {
                    const relFilePath = vscode.Uri.file(await this.resolvePath(rel.file, basePaths));
                    const related = new vscode.DiagnosticRelatedInformation(new vscode.Location(relFilePath, rel.location), rel.message);
                    diag.relatedInformation.push(related);
                }
                diags_by_file.get(filepath)!.push(diag);
                arrs.push({
                    filepath,
                    diag
                });
            }
        }

        return arrs;
    }

    /**
     * Creates a handler that centralizes linker-only diagnostics logic.
     *
     * Why this exists:
     * - MSVC linker diagnostics are emitted without a real source file path.
     * - Copilot `get_errors` drops diagnostics that do not map to a file on disk.
     * - We synthesize a real file (`linkerrors.txt`) and map all linker diagnostics
     *   to it so tooling can surface the errors consistently.
     *
     * Responsibilities:
     * - Ensure `linkerrors.txt` exists when linker diagnostics are present.
     * - Collect linker diagnostics and keep a stable index mapping to `FileDiagnostic` entries.
     * - Write a deterministic, line-based report file and then update diagnostic ranges
     *   to point at the correct lines in that file.
     *
     * Line mapping details:
     * - The file starts with a fixed header (5 lines plus a blank line).
     * - Each linker diagnostic then occupies three lines: header, message, blank.
     * - We store 1-based line numbers while building content and convert to 0-based
     *   `vscode.Range` indices when updating diagnostics.
     *
     * This is intentionally isolated to keep non-linker diagnostic flow readable.
     */
    private createLinkerDiagnosticsHandler(basePaths: string[]) {
        const linkErrorsFilename = 'linkerrors.txt';
        const linkerErrors: { code: string; message: string; source: string; lineNumber: number }[] = [];
        const linkerDiagIndexMap = new Map<number, number>(); // Maps linkerErrors index to arrs index
        let ensuredLinkErrorsFile = false;

        const ensureLinkErrorsFile = async () => {
            if (ensuredLinkErrorsFile) {
                return;
            }
            const buildDir = basePaths[0];
            if (!buildDir) {
                return;
            }
            const linkErrorsPath = util.resolvePath(linkErrorsFilename, buildDir);
            if (!await util.checkFileExists(linkErrorsPath)) {
                try {
                    await fs.writeFile(linkErrorsPath, '');
                } catch {
                    // Best-effort: if this fails, diagnostics will still resolve to the path.
                }
            }
            ensuredLinkErrorsFile = true;
        };

        const maybeEnsureFileFromDiagnostics = async (diagnostics: readonly RawDiagnostic[]) => {
            if (diagnostics.some(diag => diag.file === linkErrorsFilename)) {
                await ensureLinkErrorsFile();
            }
        };

        const collect = async (raw_diag: RawDiagnostic, source: string, arrsIndex: number) => {
            if (raw_diag.file !== linkErrorsFilename) {
                return;
            }
            await ensureLinkErrorsFile();
            const linkerErrorIndex = linkerErrors.length;
            linkerErrors.push({
                code: raw_diag.code || 'LNK0000',
                message: raw_diag.message,
                source: source,
                lineNumber: -1  // Will be set when building file content
            });
            linkerDiagIndexMap.set(linkerErrorIndex, arrsIndex);
        };

        const finalize = async (arrs: FileDiagnostic[]) => {
            if (linkerErrors.length === 0) {
                return;
            }

            const buildDir = basePaths[0];
            if (!buildDir) {
                return;
            }

            const linkErrorsPath = util.resolvePath(linkErrorsFilename, buildDir);
            const timestamp = new Date().toISOString();
            const lines: string[] = [
                '================================================================================',
                'Linker Errors',
                `Generated: ${timestamp}`,
                `Total Errors: ${linkerErrors.length}`,
                '================================================================================',
                ''
            ];

            // Hack: write a real file so Copilot get_errors does not drop diagnostics without a source file.
            for (const err of linkerErrors) {
                err.lineNumber = lines.length + 1;
                lines.push(`[${err.code}] (${err.source})`);
                lines.push(err.message);
                lines.push('');
            }

            try {
                await fs.writeFile(linkErrorsPath, lines.join('\n'));

                // Now update the line numbers in the diagnostics using the index mapping
                linkerDiagIndexMap.forEach((arrsIndex, linkerErrorIndex) => {
                    const errorInfo = linkerErrors[linkerErrorIndex];
                    if (errorInfo && errorInfo.lineNumber >= 0 && arrsIndex < arrs.length) {
                        const line = errorInfo.lineNumber - 1; // VS Code uses 0-based line numbers
                        arrs[arrsIndex].diag.range = new vscode.Range(line, 0, line, 999);
                    }
                });
            } catch {
                // Best-effort: if writing fails, diagnostics are still available in Problems panel
            }
        };

        return {
            maybeEnsureFileFromDiagnostics,
            collect,
            finalize
        };
    }
}

/**
 * Class which consumes the output of a running build.
 *
 * This parses compiler errors, but also emits progress events when the build
 * tool writes a status message which can be parsed as containing a progress
 * indicator.
 */
export class CMakeBuildConsumer extends proc.CommandConsumer implements vscode.Disposable {
    constructor(readonly logger: Logger | null, config: ConfigurationReader) {
        super();
        this.compileConsumer = new CompileOutputConsumer(config);
    }
    /**
     * Event fired when the progress changes
     */
    get onProgress() {
        return this._onProgressEmitter.event;
    }
    private readonly _onProgressEmitter = new vscode.EventEmitter<proc.ProgressData>();
    private readonly _percent_re = /\[.*?(\d+)\%.*?\]/;

    readonly compileConsumer: CompileOutputConsumer;

    dispose() {
        this._onProgressEmitter.dispose();
    }

    error(line: string) {
        this.compileConsumer.error(line);
        if (this.logger) {
            this.logger.error(line);
        }
        super.error(line);
    }

    output(line: string) {
        this.compileConsumer.output(line);
        if (this.logger) {
            this.logger.info(line);
        }
        super.output(line);
        const progress = this._percent_re.exec(line);
        if (progress) {
            const percent = progress[1];
            this._onProgressEmitter.fire({
                minimum: 0,
                maximum: 100,
                value: Number.parseInt(percent)
            });
        }
    }
}
