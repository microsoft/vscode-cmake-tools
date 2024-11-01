/**
 * Module for parsing GHS diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnosticParser, FeedLineResult } from '@cmt/diagnostics/util';

export const REGEX = /^\"(.*)\",\s+(?:(?:line\s+(\d+)\s+\(col\.\s+(\d+)\))|(?:At end of source)):\s+(?:fatal )?(remark|warning|error)\s+(.*)/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        const mat = REGEX.exec(line);
        if (!mat) {
            // Nothing to see on this line of output...
            return FeedLineResult.NotMine;
        }

        const [full, file, lineno = '1', column = '1', severity, message] = mat;
        if (file && severity && message) {
            return {
                full,
                file,
                location: new vscode.Range(oneLess(lineno), oneLess(column), oneLess(lineno), 999),
                severity,
                message,
                related: []
            };
        }
        return FeedLineResult.NotMine;
    }
}
