/**
 * Types and utilities for diagnostic parsing and handling
 */

import * as vscode from 'vscode';

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

export function oneLess(num: number|string): number {
  if (typeof num === 'string') {
    return oneLess(parseInt(num));
  } else {
    return Math.max(0, num - 1);
  }
}