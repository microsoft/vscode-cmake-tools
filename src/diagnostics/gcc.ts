/**
 * Module for handling GCC diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnostic, RawDiagnosticParser, RawRelated, FeedLineResult, MatchType, RegexPattern } from '@cmt/diagnostics/util';

// Patterns to identify and capture GCC diagnostic messages.
const regexPatterns: RegexPattern[] = [
    {   // path/to/file:line:column: severity: message
        regexPattern: /^(.+):(\d+):(\d+):\s+(?:fatal\s+)?(\w+):\s+(.+)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Column, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/file:line: severity: message (but not starting with "path/to/ld[.exe]:")
        regexPattern: /^(?!.*?ld(?:\.exe)?:)(.+):(\d+):\s+(?:fatal\s+)?(\w+):\s+(.+)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/cc1[.exe]|arm-none-eabi-gcc[.exe]: severity: message
        regexPattern: /^(.*(?:cc1|arm-none-eabi-gcc)(?:\.exe)?):\s+(?:fatal\s+)?(\w+):\s+(.+)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Severity, MatchType.Message]
    }
];

interface PendingTemplateBacktrace {
    rootInstantiation: string;
    requiredFrom: RawRelated[];
}

export class Parser extends RawDiagnosticParser {
    private _prevDiag?: RawDiagnostic;

    private _pendingTemplateError?: PendingTemplateBacktrace;

    doHandleLine(line: string) {
        // Detect the first line of a C++ template error
        // This is a special case which consists of 3 lines:
        // path/to/file: In instantiation of ‘...’:
        // path/to/file:lineno:columnno:   required from here
        // path/to/file:lineno:columnno: severity: message
        let mat = /(.*): (In instantiation of.+)/.exec(line);
        if (mat) {
            const [, , message] = mat;
            this._pendingTemplateError = {
                rootInstantiation: message,
                requiredFrom: []
            };
            return FeedLineResult.Ok;
        }
        if (this._pendingTemplateError) {
            // Detect the second line of a pending C++ template error
            mat = /(.*):(\d+):(\d+):(  +required from.+)/.exec(line);
            if (mat) {
                const [, file, linestr, column, message] = mat;
                const lineNo = oneLess(linestr);
                this._pendingTemplateError.requiredFrom.push({
                    file,
                    location: new vscode.Range(lineNo, parseInt(column), lineNo, 999),
                    message
                });
                return FeedLineResult.Ok;
            }
        }

        // Detect backtrace limit notes in GCC diagnostics and append them to the previous diagnostic if one exists
        mat = /note: \((.*backtrace-limit.*)\)/.exec(line);
        if (mat && this._prevDiag && this._prevDiag.related.length !== 0) {
            const prevRelated = this._prevDiag.related[0];
            this._prevDiag.related.push({
                file: prevRelated.file,
                location: prevRelated.location,
                message: mat[1]
            });
            return FeedLineResult.Ok;
        }

        // Attempt to parse a general diagnostic message using regex patterns defined in regexPatterns
        let mat2 = null;

        let full = "";
        let file = "";
        let lineno = oneLess("1");
        let columnno = oneLess("1");
        let severity = 'error';
        let message = "";

        for (const [, regexPattern] of regexPatterns.entries()) {
            mat2 = line.match(regexPattern.regexPattern);

            if (mat2 !== null) {
                // For each matchType in the pattern, assign values accordingly
                for (let i = 0; i < mat2.length; i++) {
                    switch (regexPattern.matchTypes[i]) {
                        case MatchType.Full:
                            full = mat2[i];
                            break;
                        case MatchType.File:
                            file = mat2[i];
                            break;
                        case MatchType.Line:
                            lineno = oneLess(mat2[i]);
                            break;
                        case MatchType.Column:
                            columnno = oneLess(mat2[i]);
                            break;
                        case MatchType.Severity:
                            severity = mat2[i];
                            break;
                        case MatchType.Message:
                            message = mat2[i];
                            break;
                        default:
                            break;
                    }
                }
                break;
            }
        }

        if (!mat2) {
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
                const location = new vscode.Range(lineno, columnno, lineno, 999);
                if (this._pendingTemplateError) {
                    // If the diagnostic is the third line of a pending C++ template error, finalize it here
                    related.push({
                        location,
                        file,
                        message: this._pendingTemplateError.rootInstantiation
                    });
                    related.push(...this._pendingTemplateError.requiredFrom);
                    this._pendingTemplateError = undefined;
                }

                // Store and return the current diagnostic
                return this._prevDiag = {
                    full,
                    file,
                    location,
                    severity,
                    message,
                    related
                };
            }
        }
    }
}
