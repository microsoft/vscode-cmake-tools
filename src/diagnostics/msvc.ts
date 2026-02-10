/**
 * Module for handling MSVC diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnosticParser, FeedLineResult } from '@cmt/diagnostics/util';

export const REGEX = /^\s*(\d+>)?\s*([^\s>].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\)\s*:\s+((?:fatal )?error|warning|info)\s*(\w{1,2}\d+)?\s*:\s*(.*)$/;

// Regex for MSVC linker errors with optional file prefix, e.g.
// '[build] LINK : error LNK2001: message'
// '[build] foo.obj : error LNK2019: message'
// 'fatal error LNK1104: cannot open file'
// Matches MSVC linker errors in multiple formats:
// '[build] LINK : error LNK####: message'
// '[build] foo.obj : error LNK####: message'
// 'fatal error LNK####: message'
// Handles flexible spacing: colons with or without spaces
export const LINKER_REGEX =
    /^\s*(?:\[[^\]]*\])?\s*(?:(.+?)\s*:\s*)?((?:fatal\s+)?error|warning|info)\s+(LNK\d+)\s*:\s*(.*)$/;

export class Parser extends RawDiagnosticParser {
    doHandleLine(line: string) {
        // First try the standard compiler diagnostic regex
        let res = REGEX.exec(line);
        if (res) {
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

        // Try the linker error regex (handles LINK prefix, file prefix, or standalone)
        res = LINKER_REGEX.exec(line);
        if (res) {
            const [full, file, severity, code, message] = res;
            // Convert 'LINK' to 'linker' for display; undefined or empty means standalone
            const actualFile = !file || file === 'LINK' ? 'linker' : file;
            return {
                full,
                file: actualFile,
                location: new vscode.Range(0, 0, 0, 999),
                severity,
                message,
                code,
                related: []
            };
        }

        return FeedLineResult.NotMine;
    }
}
