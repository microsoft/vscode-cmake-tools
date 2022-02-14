/**
 * Module for handling MSVC diagnostics
 */

import { oneLess } from '@cmt/basic/util';
import { FeedLineResult, RawDiagnosticParser } from './rawDiagnosticParser';

export const REGEX = /^\s*(\d+>)?\s*([^\s>].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\)\s*:\s+((?:fatal )?error|warning|info)\s*(\w{1,2}\d+)?\s*:\s*(.*)$/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        const res = REGEX.exec(line);
        if (!res) {
            return FeedLineResult.NotMine;
        }
        const [full, /* proc*/, file, location, severity, code, message] = res;
        const range = (() => {
            const parts = location.split(',');
            const n0 = oneLess(parts[0]);
            if (parts.length === 1) {
                return {startLine: n0, startCharacter: 0, endLine: n0, endCharacter: 999};
            }
            if (parts.length === 2) {
                const n1 = oneLess(parts[1]);
                return {startLine: n0, startCharacter: n1, endLine: n0, endCharacter: n1};
            }
            if (parts.length === 4) {
                const n1 = oneLess(parts[1]);
                const n2 = oneLess(parts[2]);
                const n3 = oneLess(parts[3]);
                return {startLine: n0, startCharacter: n1, endLine: n2, endCharacter: n3};
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
            related: []
        };
    }
}
