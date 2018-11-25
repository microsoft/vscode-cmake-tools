/**
 * Module for diagnostic handling
 */ /** */

import * as vscode from 'vscode';

import {oneLess, FileDiagnostic} from './diagnostics/diagnostic';
import * as logging from './logging';
import * as proc from './proc';
import {OutputConsumer} from './proc';
import * as util from './util';

const build_logger = logging.createLogger('build');

export interface RawDiagnostic {
  full: string;
  file: string;
  location: vscode.Range;
  severity: string;
  message: string;
  code?: string;
}

/**
 * Inserts a list of `FileDiagnostic` instances into a diagnostic collection.
 * @param coll The `vscode.DiagnosticCollecion` to populate.
 * @param fdiags The `FileDiagnostic` objects to insert into the collection
 *
 * @note The `coll` collection will be cleared of all previous contents
 */
export function populateCollection(coll: vscode.DiagnosticCollection, fdiags: FileDiagnostic[]) {
  // Clear the collection
  coll.clear();
  // Collect the diagnostics and associate them with their respective files
  const diags_by_file = fdiags.reduce((by_file, fdiag) => {
    if (!by_file.has(fdiag.filepath)) {
      by_file.set(fdiag.filepath, []);
    }
    by_file.get(fdiag.filepath)!.push(fdiag.diag);
    return by_file;
  }, new Map<string, vscode.Diagnostic[]>());
  // Insert the diags into the collection
  diags_by_file.forEach((diags, filepath) => { coll.set(vscode.Uri.file(filepath), diags); });
}

export class CompileOutputConsumer implements OutputConsumer {
  // Regular expressions for the diagnostic messages corresponding to each tool
  private readonly _ghs_re
      = /^\"(.*)\",\s+(?:(?:line\s+(\d+)\s+\(col\.\s+(\d+)\))|(?:At end of source)):\s+(?:fatal )?(remark|warning|error)\s+(.*)/;
  private readonly _gcc_re = /^(.*):(\d+):(\d+):\s+(?:fatal )?(\w*)(?:\sfatale)?\s?:\s+(.*)/;
  private readonly _gnu_ld_re = /^(.*):(\d+)\s?:\s+(.*[^\]])$/;
  private readonly _msvc_re
      = /^\s*(?!\d+>)?\s*([^\s>].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+((?:fatal )?error|warning|info)\s+(\w{1,2}\d+)\s*:\s*(.*)$/;

  private readonly _ghsDiagnostics: RawDiagnostic[] = [];
  get ghsDiagnostics() { return this._ghsDiagnostics; }

  private readonly _gccDiagnostics: RawDiagnostic[] = [];
  get gccDiagnostics() { return this._gccDiagnostics; }

  private readonly _gnuLDDiagnostics: RawDiagnostic[] = [];
  get gnuLDDiagnostics() { return this._gnuLDDiagnostics; }

  private readonly _msvcDiagnostics: RawDiagnostic[] = [];
  get msvcDiagnostics() { return this._msvcDiagnostics; }

  private _tryParseLD(line: string): RawDiagnostic|null {
    // Try to parse for GNU ld
    if (line.startsWith('make')) {
      // This is a Make error. It may *look* like an LD error, so we abort early
      return null;
    }
    const res = this._gnu_ld_re.exec(line);
    if (!res) {
      return null;
    }
    // Tricksy compiler error looks like a linker error:
    if (line.endsWith('required from here'))
      return null;
    const [full, file, lineno_, message] = res;
    const lineno = oneLess(lineno_);
    if (file && lineno && message) {
      return {
        full,
        file,
        location: new vscode.Range(lineno, 0, lineno, 999),
        severity: 'error',
        message,
      };
    } else {
      return null;
    }
  }

  public _tryParseMSVC(line: string): RawDiagnostic|null {
    const res = this._msvc_re.exec(line);
    if (!res)
      return null;
    const [full, file, location, severity, code, message] = res;
    const range = (() => {
      const parts = location.split(',');
      const n0 = oneLess(parts[0]);
      if (parts.length === 1)
        return new vscode.Range(n0, 0, n0, 999);
      if (parts.length === 2) {
        const n1 = oneLess(parts[1]);
        return new vscode.Range(n0, n1, n0, n1);
      }
      if (parts.length === 4) {
        const n1 = oneLess(parts[1]);
        const n2 = oneLess(parts[2]);
        const n3 = oneLess(parts[3]);
        return new vscode.Range(n0, n1, n2, n3);
      }
      throw new Error('Unable to determine location of MSVC diagnostic');
    })();
    return {
      full,
      file,
      location: range,
      severity,
      message,
      code,
    };
  }

  error(line: string) {
    {
      // Try to parse for GCC
      const gcc_mat = this._gcc_re.exec(line);
      if (gcc_mat) {
        const [full, file, lineno_, column_, severity, message] = gcc_mat;
        if (file && lineno_ && column_ && severity && message) {
          const lineno = oneLess(lineno_);
          const column = oneLess(column_);
          this._gccDiagnostics.push({
            full,
            file,
            location: new vscode.Range(lineno, column, lineno, 999),
            severity,
            message,
          });
          return;
        }
      }
    }

    {
      // Try to parse for GHS
      const ghs_mat = this._ghs_re.exec(line);
      if (ghs_mat) {
        const [full, file, lineno = '1', column = '1', severity, message] = ghs_mat;
        if (file && severity && message) {
          this._ghsDiagnostics.push({
            full,
            file,
            location: new vscode.Range(oneLess(lineno), oneLess(column), oneLess(lineno), 999),
            severity,
            message
          });
          return;
        }
      }
    }

    {
      const ld_diag = this._tryParseLD(line);
      if (ld_diag) {
        this._gnuLDDiagnostics.push(ld_diag);
      }
    }

    {
      const msvc_diag = this._tryParseMSVC(line);
      if (msvc_diag) {
        this._msvcDiagnostics.push(msvc_diag);
      }
    }
  }

  output(line: string) { this.error(line); }

  createDiagnostics(build_dir: string): FileDiagnostic[] {
    const diags_by_file = new Map<string, vscode.Diagnostic[]>();

    const severity_of = (p: string) => {
      switch (p) {
      case 'warning':
        return vscode.DiagnosticSeverity.Warning;
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
      GCC: this.gccDiagnostics,
      MSVC: this.msvcDiagnostics,
      GHS: this.ghsDiagnostics,
      link: this.gnuLDDiagnostics,
    };
    const arrs = util.objectPairs(by_source).map(([source, diags]) => {
      return diags.map(raw_diag => {
        const filepath = util.resolvePath(raw_diag.file, build_dir);
        const diag = new vscode.Diagnostic(raw_diag.location, raw_diag.message, severity_of(raw_diag.severity));
        diag.source = source;
        if (raw_diag.code) {
          diag.code = raw_diag.code;
        }
        if (!diags_by_file.has(filepath)) {
          diags_by_file.set(filepath, []);
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
    build_logger.error(line);
  }

  output(line: string) {
    this.compileConsumer.output(line);
    build_logger.info(line);
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
