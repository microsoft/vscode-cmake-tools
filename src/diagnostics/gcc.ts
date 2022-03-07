/**
 * Module for handling GCC diagnostics
 */ /** */

import * as vscode from 'vscode';

import { oneLess, RawDiagnostic, RawDiagnosticParser, RawRelated, FeedLineResult } from './util';

export const REGEX = /^(.*):(\d+):(\d+):\s+(?:fatal )?(\w*)(?:\sfatale)?\s?:\s+(.*)/;

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
        mat = REGEX.exec(line);
        if (!mat) {
            // Nothing to see on this line of output...
            return FeedLineResult.NotMine;
        } else {
            const [full, file, lineno_, column_, severity, message] = mat;
            if (file && lineno_ && column_ && severity && message) {
                const lineno = oneLess(lineno_);
                const column = oneLess(column_);
                if (severity === 'note' && this._prevDiag) {
                    this._prevDiag.related.push({
                        file,
                        location: new vscode.Range(lineno, column, lineno, 999),
                        message
                    });
                    return FeedLineResult.Ok;
                } else {
                    const related: RawRelated[] = [];
                    const location = new vscode.Range(lineno, column, lineno, 999);
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
            }
            return FeedLineResult.NotMine;
        }
    }
}
