/**
 * Module for handling GNU linker diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnostic, RawDiagnosticParser, RawRelated, FeedLineResult } from './util';

enum MatchType {
    Full,
    File,
    Line,
    Column,
    Severity,
    Message
}

const regexPatterns: RegexPattern[] = [
    {   // path/to/ld[.exe]:path/to/file:line: warning: memory region ... not declared
        regexPattern: /^(?:(?:(?:.*ld\:)|(?:.*ld\.exe\:))(.*):(\d+):)\s+(.*): (memory region .* not declared)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/ld[.exe]:path/to/file:line: syntax error
        regexPattern: /^(?:(?:(?:.*ld\:)|(?:.*ld\.exe\:))(.*):(\d+):) (syntax error)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Message]
    },
    {   // path/to/ld.exe: severity: message
        regexPattern: /^(?:(.*ld\.exe):)\s+(?:fatal )?(\w*)(?:\sfatale)?\s?:\s+(.*)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/ld: severity: message
        regexPattern: /^(?:(.*ld):)\s+(?:fatal )?(\w*)(?:\sfatale)?\s?:\s+(.*)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Severity, MatchType.Message]
    },
    {   // path/to/ld.exe: message
        regexPattern: /^(?:(.*ld\.exe):)\s+(.*)(?<!:)$/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Message]
    },
    {   // path/to/ld: message
        regexPattern: /^(?:(.*ld):)\s+(.*)(?<!:)$/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Message]
    },
    {   // path/to/file:line: undefined reference to
        regexPattern: /^(?:(.*):(\d+):)\s+(undefined reference to .*)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Message]
    },
    {   // path/to/file: ... section ... will not fit in region ...
        regexPattern: /^(.*): ((?:.*) .*section.* (?:.*) .*will not fit in region.*)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Message]
    },
    {   // path/to/file:line: multiple definition of ... first defined here
        regexPattern: /^(?:(.*):(\d+):)\s+(multiple definition of .* first defined here)/,
        matchTypes: [MatchType.Full, MatchType.File, MatchType.Line, MatchType.Message]
    }
];

interface RegexPattern {
    regexPattern: RegExp;
    matchTypes: MatchType[];
}

interface PendingTemplateBacktrace {
    rootInstantiation: string;
    requiredFrom: RawRelated[];
}

export class Parser extends RawDiagnosticParser {
    private _prevDiag?: RawDiagnostic;

    private _pendingTemplateError?: PendingTemplateBacktrace;

    doHandleLine(line: string) {
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

        // Early-catch backtrace limit notes
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

        // Test if this is a diagnostic
        let mat2 = null;

        let full = "";
        let file = "";
        let lineno = oneLess("1");
        let columnno = oneLess("1");
        let severity = 'error';
        let message = "foobar";

        for (const [, regexPattern] of regexPatterns.entries()) {
            mat2 = line.match(regexPattern.regexPattern);

            if (mat2 !== null) {
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
            // Nothing to see on this line of output...
            return FeedLineResult.NotMine;
        } else {
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
                    related.push({
                        location,
                        file,
                        message: this._pendingTemplateError.rootInstantiation
                    });
                    related.push(...this._pendingTemplateError.requiredFrom);
                    this._pendingTemplateError = undefined;
                }

                return this._prevDiag = {
                    full,
                    file,
                    location,
                    severity,
                    message,
                    related
                };
            }
            return FeedLineResult.NotMine;
        }
    }
}
