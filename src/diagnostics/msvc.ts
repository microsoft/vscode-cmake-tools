/**
 * Module for handling MSVC diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnosticParser, FeedLineResult } from './util';

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
                return new vscode.Range(n0, 0, n0, 999);
            }
            if (parts.length === 2) {
                const n1 = oneLess(parts[1]);
                return new vscode.Range(n0, n1, n0, n1);
            }
            if (parts.length === 4) {
                const n1 = oneLess(parts[1]);
                const n2 = oneLess(parts[2]);
                const n3 = oneLess(parts[3]);
                return new vscode.Range(n0, n1, n2, n3);
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
