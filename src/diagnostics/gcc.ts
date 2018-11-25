
/**
 * Module for handling GCC diagnostics
 */ /** */

import * as vscode from 'vscode';

import {oneLess, RawDiagnosticParser} from './util';

export const REGEX = /^(.*):(\d+):(\d+):\s+(?:fatal )?(\w*)(?:\sfatale)?\s?:\s+(.*)/;


export class Parser extends RawDiagnosticParser {
  doHandleLine(line: string) {
    const mat = REGEX.exec(line);
    if (!mat) {
      // Nothing to see on this line of output...
      return;
    }

    const [full, file, lineno_, column_, severity, message] = mat;
    if (file && lineno_ && column_ && severity && message) {
      const lineno = oneLess(lineno_);
      const column = oneLess(column_);
      return {
        full,
        file,
        location: new vscode.Range(lineno, column, lineno, 999),
        severity,
        message,
      };
    }
  }
}
