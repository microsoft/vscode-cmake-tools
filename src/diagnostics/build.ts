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
import { FileDiagnostic, RawDiagnosticParser } from '@cmt/diagnostics/util';
import { ConfigurationReader } from '@cmt/config';

export class Compilers {
    [compiler: string]: RawDiagnosticParser;

    gcc = new gcc.Parser();
    gnuld = new gnu_ld.Parser();
    ghs = new ghs.Parser();
    diab = new diab.Parser();
    msvc = new mvsc.Parser();
    iar = new iar.Parser();
}

export class CompileOutputConsumer implements OutputConsumer {
    constructor(readonly config: ConfigurationReader) {}

    compilers = new Compilers();

    // Defer all output to the `error` method
    output(line: string) {
        this.error(line);
    }

    error(line: string) {
        for (const cand in this.compilers) {
            if (this.compilers[cand].handleLine(line)) {
                break;
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
            IAR: this.compilers.iar.diagnostics
        };
        const parsers = util.objectPairs(by_source)
            .filter(([source, _]) => this.config.enableOutputParsers?.includes(source.toLowerCase()) ?? false);
        const arrs: FileDiagnostic[] = [];
        for (const [ source, diags ] of parsers) {
            for (const raw_diag of diags) {
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
        return arrs;
    }
}

/**
 * Class which consumes the output of a running build.
 *
 * This parses compiler errors, but also emits progress events when the build
 * tool writes a status message which can be parsed as containing a progress
 * indicator.
 */
export class CMakeBuildConsumer implements OutputConsumer, vscode.Disposable {
    constructor(readonly logger: Logger | null, config: ConfigurationReader) {
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
    }

    output(line: string) {
        this.compileConsumer.output(line);
        if (this.logger) {
            this.logger.info(line);
        }
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
