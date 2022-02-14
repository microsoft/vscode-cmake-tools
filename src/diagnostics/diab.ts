/**
 * Module for parsing Wind River Diab diagnostics
 */

import { oneLess } from '@cmt/basic/util';
import { FeedLineResult, RawDiagnosticParser } from './rawDiagnosticParser';

export const REGEX = /^\"(.*)\",\s+(?:line\s+(\d+):\s+)?(info|warning|(?:|fatal |catastrophic )error)\s+\((.*)\):\s+(.*)$/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        const mat = REGEX.exec(line);
        if (!mat) {
            // Nothing to see on this line of output...
            return FeedLineResult.NotMine;
        }

        const [full, file, lineno = '1', severity, code, message] = mat;
        const column = '1';
        if (file && severity && message) {
            return {
                full,
                file,
                location: {
                    startLine: oneLess(lineno),
                    startCharacter: oneLess(column),
                    endLine: oneLess(lineno),
                    endCharacter: 999
                },
                severity,
                code,
                message,
                related: []
            };
        }
        return FeedLineResult.NotMine;
    }
}
