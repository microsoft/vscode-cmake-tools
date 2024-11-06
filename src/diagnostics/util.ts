/**
 * Types and utilities for diagnostic parsing and handling
 */

import { reduce } from '@cmt/util';
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

export enum FeedLineResult {
    Ok,
    NotMine,
}

export interface RawRelated {
    file: string;
    location: vscode.Range;
    message: string;
}

export interface RawDiagnostic {
    full: string;
    file: string;
    location: vscode.Range;
    severity: string;
    message: string;
    code?: string;
    related: RawRelated[];
}

/**
 * Get one less than the given number of number-string.
 *
 * If the number is greater than zero, returns that number minus one. If
 * the number is less than one, returns zero.
 * @param num A number or string representing a number
 */
export function oneLess(num: number | string): number {
    if (typeof num === 'string') {
        return oneLess(parseInt(num));
    } else {
        return Math.max(0, num - 1);
    }
}

/**
 * Inserts a list of `FileDiagnostic` instances into a diagnostic collection.
 * @param coll The `vscode.DiagnosticCollecion` to populate.
 * @param fdiags The `FileDiagnostic` objects to insert into the collection
 *
 * @note The `coll` collection will be cleared of all previous contents
 */
export function populateCollection(coll: vscode.DiagnosticCollection, fdiags: Iterable<FileDiagnostic>) {
    // Clear the collection
    coll.clear();
    // Collect the diagnostics and associate them with their respective files
    const diags_by_file = reduce(fdiags, new Map<string, vscode.Diagnostic[]>(), (by_file, fdiag) => {
        if (!by_file.has(fdiag.filepath)) {
            by_file.set(fdiag.filepath, []);
        }
        by_file.get(fdiag.filepath)!.push(fdiag.diag);
        return by_file;
    });
    // Insert the diags into the collection
    diags_by_file.forEach((diags, filepath) => {
        coll.set(vscode.Uri.file(filepath), diags);
    });
}

/**
 * Base class for parsing raw diagnostic information on a line-by-line basis
 */
export abstract class RawDiagnosticParser {
    /**
     * Get the diagnostics which have been parsed by this object
     */
    get diagnostics(): readonly RawDiagnostic[] {
        return this._diagnostics;
    }
    private readonly _diagnostics: RawDiagnostic[] = [];

    /**
     * Push another line into the parser
     * @param line Another line to parse
     */
    handleLine(line: string): boolean {
        const result = this.doHandleLine(line);
        if (result === FeedLineResult.Ok) {
            return true;
        } else if (result === FeedLineResult.NotMine) {
            return false;
        } else {
            this._diagnostics.push(result);
            return true;
        }
    }

    /**
     * Implement in derived classes to parse a line. Returns a new diagnostic, or
     * `undefined` if the give line does not complete a diagnostic
     * @param line The line to process
     */
    protected abstract doHandleLine(line: string): RawDiagnostic | FeedLineResult;
}

/**
 * Match types for gcc related regex diagnostics
 */
export enum MatchType {
    Full,
    File,
    Line,
    Column,
    Severity,
    Message
}

/**
 * Regex pattern interface for generic gcc related regex diagnostics
 */
export interface RegexPattern {
    regexPattern: RegExp;
    matchTypes: MatchType[];
}
