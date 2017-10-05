/**
 * Module for diagnostic handling
 */ /** */

import * as path from 'path';

import * as vscode from 'vscode';

import {OutputConsumer} from './proc';

import * as logging from './logging';

const cmake_logger = logging.createLogger('cmake');


export interface RawDiagnostic {
  full: string;
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
}

export interface FileDiagnostic {
  filepath: string;
  key: string;
  diag: vscode.Diagnostic;
}

export function populateCollection(coll: vscode.DiagnosticCollection, fdiags: FileDiagnostic[]) {
  // Clear the collection
  coll.clear();
  // Collect the diagnostics and associate them with their respective files
  const diags_by_file = fdiags.reduce((by_file, fdiag) => {
    if (!by_file.has(fdiag.filepath)) {
      by_file.set(fdiag.filepath, []);
    }
    by_file.get(fdiag.filepath) !.push(fdiag.diag);
    return by_file;
  }, new Map<string, vscode.Diagnostic[]>());
  // Insert the diags into the collection
  diags_by_file.forEach((diags, filepath) => { coll.set(vscode.Uri.file(filepath), diags); });
}

export class CMakeOutputConsumer implements OutputConsumer {
  private _diagnostics = [] as FileDiagnostic[];
  get diagnostics() { return this._diagnostics; }

  output(line: string) { cmake_logger.info(line); }

  private _errorState: {
    state : ('init' | 'diag' | 'stack'),
    diag : FileDiagnostic | null,
    blankLines : number,
  }
  = {
      state : 'init',
      diag : null,
      blankLines : 0,
    };
  error(line: string) {
    cmake_logger.error(line);
    const dev_warning_re = /^This warning is for project developers\./;
    switch (this._errorState.state) {
    case 'init': {
      const re = /CMake (.*?)(?: \(dev\))? at (.*?):(\d+) \((.*?)\):/;
      const result = re.exec(line);
      if (result) {
        // We have encountered and error
        const[full, level, filename, linestr, command] = result;
        const line = Number.parseInt(linestr) - 1;
        const filepath = path.isAbsolute(filename)
            ? filename
            : path.join(vscode.workspace.rootPath !, filename);
        const diagmap: {[k: string] : vscode.DiagnosticSeverity} = {
          'Warning' : vscode.DiagnosticSeverity.Warning,
          'Error' : vscode.DiagnosticSeverity.Error,
        };
        const vsdiag
            = new vscode.Diagnostic(new vscode.Range(line, 0, line, 9999), '', diagmap[level]);
        vsdiag.source = `CMake (${command})`;
        this._errorState.diag = {
          filepath,
          diag : vsdiag,
          key : full,
        };
        this._errorState.state = 'diag';
        this._errorState.blankLines = 0;
      }
      break;
    }
    case 'diag': {
      console.assert(this._errorState.diag, 'No diagnostic?');
      const call_stack_re = /^Call Stack \(most recent call first\):$/;
      if (call_stack_re.test(line)) {
        // We're in call stack mode!
        this._errorState.state = 'stack';
        this._errorState.blankLines = 0;
        break;
      }
      if (line == '') {
        // A blank line!
        if (this._errorState.blankLines == 0) {
          // First blank. Okay
          this._errorState.blankLines++;
        } else {
          // Second blank line. Now we commit the diagnostic.
          this._commitDiag();
        }
      } else if (dev_warning_re.test(line)) {
        this._commitDiag();
      } else {
        // Reset blank line count
        this._errorState.blankLines = 0;
        // Add this line to the current diag accumulator
        const trimmed = line.replace(/^  /, '');
        this._errorState.diag !.diag.message += trimmed + '\n';
      }
      break;
    }
    case 'stack': {
      // Meh... vscode doesn't really let us provide call stacks to diagnostics.
      // We can't really do anything...
      if (line == '') {
        if (this._errorState.blankLines == 1) {
          this._commitDiag();
        } else {
          this._errorState.blankLines++;
        }
      } else if (dev_warning_re.test(line)) {
        this._commitDiag();
      } else {
        this._errorState.blankLines++;
      }
      break;
    }
    }
  }

  private _commitDiag() {
    const diag = this._errorState.diag !;
    // Remove the final newline from the message
    diag.diag.message = diag.diag.message.replace(/\n$/, '');
    this._diagnostics.push(this._errorState.diag !);
    this._errorState.diag = null;
    this._errorState.blankLines = 0;
    this._errorState.state = 'init';
  }
}