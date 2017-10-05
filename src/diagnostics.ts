/**
 * Module for diagnostic handling
 */ /** */

import * as path from 'path';

import * as vscode from 'vscode';

import {OutputConsumer} from './proc';

import * as logging from './logging';

const cmake_logger = logging.createLogger('cmake');


// export interface RawDiagnostic {
//   full: string;
//   file: string;
//   line: number;
//   column: number;
//   severity: string;
//   message: string;
// }

/**
 * An association between a diagnostic and the path to a file. This is required
 * because `vscode.Diagnostic` does not have an associated file, just a location
 * within one.
 */
export interface FileDiagnostic {
  /**
   * The path to the file for which the diagnostic applies
   */
  filepath: string;

  /**
   * The actual diagnostic itself
   */
  diag: vscode.Diagnostic;
}

/**
 * Inserts a list of `FileDiagnostic` instances into a diagnostic collection.
 * @param coll The `vscode.DiagnosticCollecion` to populate.
 * @param fdiags The `FileDiagnostic` objects to insert into the collection
 *
 * @note The `coll` collection will be cleared of all previous contents
 */
export function populateCollection(coll: vscode.DiagnosticCollection, fdiags: FileDiagnostic[]) {
  vscode.Diagnostic
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

/**
 * Class which consumes output from CMake.
 *
 * This class is in charge of logging CMake's output, as well as parsing and
 * collecting warnings and errors from the configure step. It should be used
 * in conjunction with `proc.execute`.
 */
export class CMakeOutputConsumer implements OutputConsumer {
  /**
   * The diagnostics that this consumer has accumulated. It will be populated
   * during calls to `output()` and `error()`
   */
  get diagnostics() { return this._diagnostics; }
  private _diagnostics = [] as FileDiagnostic[];

  /**
   * Simply writes the line of output to the log
   * @param line Line of output
   */
  output(line: string) { cmake_logger.info(line); }

  /**
   * The state for the diagnostic parser. Implemented as a crude FSM
   */
  private _errorState: {
    /**
     * The state of the parser. `init` is the rest state. `diag` is the state
     * of active parsing. `stack` is parsing the CMake call stack from an error
     * or warning.
     */
    state: ('init' | 'diag' | 'stack'),

    /**
     * The diagnostic that is currently being accumulated into
     */
    diag: FileDiagnostic | null,

    /**
     * The number of blank lines encountered thus far. CMake signals the end of
     * a warning or error with blank lines
     */
    blankLines : number,
  }
  = {
      state : 'init',
      diag : null,
      blankLines : 0,
  };
  /**
   * Consume a line of stderr.
   * @param line The line from stderr
   */
  error(line: string) {
    // First, just log the line
    cmake_logger.error(line);
    // This line of output terminates an `AUTHOR_WARNING`
    const dev_warning_re = /^This warning is for project developers\./;
    // Switch on the state to implement our crude FSM
    switch (this._errorState.state) {
    case 'init': {
      const re = /CMake (.*?)(?: \(dev\))? at (.*?):(\d+) \((.*?)\):/;
      const result = re.exec(line);
      if (result) {
        // We have encountered and error
        const[_full, level, filename, linestr, command] = result;
        _full; // unused
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
          this._errorState.diag !.diag.message += '\n';
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

  /**
   * Commit the accumulated diagnostic and go back to `init` state.
   */
  private _commitDiag() {
    const diag = this._errorState.diag !;
    // Remove the final newline(s) from the message, for prettiness
    diag.diag.message = diag.diag.message.replace(/\n+$/, '');
    this._diagnostics.push(this._errorState.diag !);
    this._errorState.diag = null;
    this._errorState.blankLines = 0;
    this._errorState.state = 'init';
  }
}