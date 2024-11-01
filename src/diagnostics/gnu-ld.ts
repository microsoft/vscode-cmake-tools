/**
 * Module for handling GNU linker diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnostic, RawDiagnosticParser, RawRelated, FeedLineResult, MatchType, RegexPattern } from '@cmt/diagnostics/util';

// Patterns to identify and capture GNU linker diagnostic messages
const regexPatterns: RegexPattern[] = [
    {   // path/to/ld[.exe]:[ ]path/to/file:line: severity: message
        regexPattern: /^(?:.*ld(?:\.exe)?:)(?:\s*)?(.+):(\d+):\s+(?:fatal )?(\w+):\s+(.+)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/ld[.exe]:[ ]path/to/file:line: message
        regexPattern: /^(?:.*ld(?:\.exe)?\:)(?:\s*)?(.+):(\d+):\s+(.+)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Message]
    },
    {   // path/to/ld[.exe]: severity: message
        regexPattern: /^(.*ld(?:\.exe)?):\s+(?:fatal )?(\w+):\s+(.+)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/ld[.exe]: message (without trailing colon)
        regexPattern: /^(.*ld(?:\.exe)?):\s+(.+)(?<!:)$/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Message]
    },
    {   // /path/to/file:line: message (without "[fatal] severity:" or trailing colon)
        regexPattern: /^(.+?):(\d+):\s+(?!fatal\s+\w+:)(?!\w+:)(.+)(?<!:)$/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Message]
    }
];

export class Parser extends RawDiagnosticParser {
    private _prevDiag?: RawDiagnostic;

    doHandleLine(line: string) {
        // Test if this is a diagnostic
        let mat = null;

        let full = "";
        let file = "";
        let lineno = oneLess("1");
        let columnno = oneLess("1");
        let severity = 'error';
        let message = "foobar";

        for (const [, regexPattern] of regexPatterns.entries()) {
            mat = line.match(regexPattern.regexPattern);

            if (mat !== null) {
                // For each matchType in the pattern, assign values accordingly
                for (let i = 0; i < mat.length; i++) {
                    switch (regexPattern.matchTypes[i]) {
                        case MatchType.Full:
                            full = mat[i];
                            break;
                        case MatchType.File:
                            file = mat[i];
                            break;
                        case MatchType.Line:
                            lineno = oneLess(mat[i]);
                            break;
                        case MatchType.Column:
                            columnno = oneLess(mat[i]);
                            break;
                        case MatchType.Severity:
                            severity = mat[i];
                            break;
                        case MatchType.Message:
                            message = mat[i];
                            break;
                        default:
                            break;
                    }
                }
                break;
            }
        }

        if (!mat) {
            // Ignore this line because it is no matching diagnostic
            return FeedLineResult.NotMine;
        } else {
            // If severity is "note", append the message to the previous diagnostic's related messages
            if (severity === 'note' && this._prevDiag) {
                this._prevDiag.related.push({
                    file,
                    location: new vscode.Range(lineno, columnno, lineno, 999),
                    message
                });
                return FeedLineResult.Ok;
            } else {
                const related: RawRelated[] = [];

                // Store and return the current diagnostic
                return this._prevDiag = {
                    full,
                    file,
                    location: new vscode.Range(lineno, columnno, lineno, 999),
                    severity,
                    message,
                    related
                };
            }
        }
    }
}
