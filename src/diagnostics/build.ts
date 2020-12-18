/**
 * Module for handling build diagnostics (from the compiler/linker)
 */ /** */


import {Logger} from '@cmt/logging';
import * as proc from '@cmt/proc';
import {OutputConsumer} from '@cmt/proc';
import * as util from '@cmt/util';
import * as vscode from 'vscode';

import * as gcc from './gcc';
import * as ghs from './ghs';
import * as diab from './diab';
import * as gnu_ld from './gnu-ld';
import * as mvsc from './msvc';
import {FileDiagnostic, RawDiagnosticParser} from './util';

export class Compilers {
  [compiler: string]: RawDiagnosticParser;

  gcc = new gcc.Parser();
  ghs = new ghs.Parser();
  diab = new diab.Parser();
  gnuLD = new gnu_ld.Parser();
  msvc = new mvsc.Parser();
}

export class CompileOutputConsumer implements OutputConsumer {
  compilers = new Compilers();

  // Defer all output to the `error` method
  output(line: string) { this.error(line); }

  error(line: string) {
    for (const cand in this.compilers) {
      if (this.compilers[cand].handleLine(line)) {
        break;
      }
    }
  }

  resolveDiagnostics(basePath: string): FileDiagnostic[] {
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
      throw new Error('Unknown diagnostic severity level: ' + p);
    };

    const by_source = {
      GCC: this.compilers.gcc.diagnostics,
      MSVC: this.compilers.msvc.diagnostics,
      GHS: this.compilers.ghs.diagnostics,
      DIAB: this.compilers.diab.diagnostics,
      link: this.compilers.gnuLD.diagnostics,
    };
    const arrs = util.objectPairs(by_source).map(([source, diags]) => {
      return diags.map(raw_diag => {
        const filepath = util.resolvePath(raw_diag.file, basePath);
        const diag = new vscode.Diagnostic(raw_diag.location, raw_diag.message, severity_of(raw_diag.severity));
        diag.source = source;
        if (raw_diag.code) {
          diag.code = raw_diag.code;
        }
        if (!diags_by_file.has(filepath)) {
          diags_by_file.set(filepath, []);
        }
        diag.relatedInformation = [];
        for (const rel of raw_diag.related) {
          const relFilePath = vscode.Uri.file(util.resolvePath(rel.file, basePath));
          const related = new vscode.DiagnosticRelatedInformation(new vscode.Location(relFilePath, rel.location), rel.message);
          diag.relatedInformation.push(related);
        }
        diags_by_file.get(filepath)!.push(diag);
        return {
          filepath,
          diag,
        };
      });
    });
    return ([] as FileDiagnostic[]).concat(...arrs);
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
  constructor(readonly logger: Logger|null) {}
  /**
   * Event fired when the progress changes
   */
  get onProgress() { return this._onProgressEmitter.event; }
  private readonly _onProgressEmitter = new vscode.EventEmitter<proc.ProgressData>();
  private readonly _percent_re = /\[.*?(\d+)\%.*?\]/;

  readonly compileConsumer = new CompileOutputConsumer();

  dispose() { this._onProgressEmitter.dispose(); }

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
        value: Number.parseInt(percent),
      });
    }
  }
}
