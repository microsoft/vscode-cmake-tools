/**
 * Module for parsing GHS diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnosticParser, FeedLineResult } from '@cmt/diagnostics/util';

export const REGEX = /\"(.*)\",\s+(?:(?:line\s+(\d+)\s+\(col\.\s+(\d+)\))|(?:At end of source)):\s+(?:fatal )?(remark|warning|error)\s+(.*)/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        // The pattern is not anchored, so on a long line with many quotes (a command line with quoted -D values, say)
        // the regular expression engine retries it from every quote and the cost grows with the square of the line
        // length. Skip lines that lack text every match contains: the closing quote and comma, and one of the two
        // location forms.
        const mat = line.includes('",') && (line.includes('(col.') || line.includes('At end of source'))
            ? REGEX.exec(line) : null;
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
