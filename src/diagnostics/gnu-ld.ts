/**
 * Module for handling GNU linker diagnostics
 */ /** */

import * as vscode from 'vscode';

import { FeedLineResult, oneLess, RawDiagnosticParser } from '@cmt/diagnostics/util';

export const REGEX = /^(.*):(\d+)\s?:\s+(.*[^\]])$/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        // Try to parse for GNU ld
        if (line.startsWith('make')) {
            // This is a Make error. It may *look* like an LD error, so we abort early
            return FeedLineResult.NotMine;
        }
        const res = REGEX.exec(line);
        if (!res) {
            return FeedLineResult.NotMine;
        }
        const [full, file, lineno_, message] = res;
        const lineno = oneLess(lineno_);
        if (file && lineno && message) {
            return {
                full,
                file,
                location: new vscode.Range(lineno, 0, lineno, 999),
                severity: 'error',
                message,
                related: []
            };
        }
        return FeedLineResult.NotMine;
    }
}
