/**
 * Module for handling include-what-you-use diagnostics
 */ /** */

import * as vscode from 'vscode';

import { RawDiagnosticParser, RawDiagnostic, FeedLineResult, oneLess } from '@cmt/diagnostics/util';

const HEADER_RE = /^(.*)\s+((should\s+(add|remove))\s+these\slines:)/i;
const FULL_HEADER_RE = /^\s*(the\s+full\s+include[-\s]+list)\s+for\s+(.*):\s*$/i;
const REMOVE_RE = /^\s*-\s*(.*?)\s*\/\/\s*lines\s(\d+)-(\d+)/i;
const SUGGESTION_RE = /^\s*(.*?[^\s].*?)\s*$/;
const END_RE = /^\s*-+\s*$/;

type State = 'wait-header' | 'collect' | 'collect-removes';

export class Parser extends RawDiagnosticParser {
    private state: State = 'wait-header';
    private file = '';
    private messagePrefix = '';
    private suggestedLines: string[] = [];
    private full: string[] = [];
    private severity: string = '';

    protected doHandleLine(line: string): RawDiagnostic | FeedLineResult {
        let mat: RegExpExecArray | null;
        let change: string;
        let addPrefix: string;
        let removePrefix: string;

        switch (this.state) {
            case 'wait-header':
                this.full = [line];
                this.suggestedLines = [];
                mat = HEADER_RE.exec(line);
                if (mat) {
                    [, this.file, addPrefix, removePrefix, change] = mat;
                    this.severity = 'warning';
                    if (change === 'add') {
                        this.messagePrefix = addPrefix;
                        this.state = 'collect';
                    } else {
                        this.messagePrefix = removePrefix;
                        this.state = 'collect-removes';
                    }
                    return FeedLineResult.Ok;
                }
                mat = FULL_HEADER_RE.exec(line);
                if (mat) {
                    [, this.messagePrefix, this.file] = mat;
                    this.severity = 'note';
                    this.messagePrefix += ':';
                    this.state = 'collect';
                    return FeedLineResult.Ok;
                }
                return FeedLineResult.NotMine;

            case 'collect-removes':
                mat = REMOVE_RE.exec(line);
                if (mat) {
                    const [, msg, start, end] = mat;
                    return this.makeDiagnostic(
                        this.messagePrefix + ': ' + msg,
                        new vscode.Range(oneLess(start), 0, oneLess(end), 999),
                        join(this.full, line)
                    );
                } else {
                    this.state = 'wait-header';
                    return FeedLineResult.Ok;
                }

            case 'collect':
                mat = SUGGESTION_RE.exec(line);
                if (mat && !END_RE.exec(line)) {
                    const [, msg] = mat;
                    this.full.push(line);
                    this.suggestedLines.push(msg);
                    return FeedLineResult.Ok;
                } else {
                    this.state = 'wait-header';
                    if (this.suggestedLines.length) {
                        return this.makeDiagnostic(
                            join(this.messagePrefix, this.suggestedLines),
                            new vscode.Range(0, 0, 0, 999),
                            join(this.full)
                        );
                    } else {
                        return FeedLineResult.Ok;
                    }
                }
        }
    }

    private makeDiagnostic(
        message: string, location: vscode.Range, full: string
    ): RawDiagnostic {
        return {
            message: message,
            location: location,
            full: full,
            file: this.file,
            related: [],
            severity: this.severity
        };
    }
}

/** join a grab bag of strings and string[]s with \n */
function join(...lines: (string|string[])[]): string {
    return lines.map(
        (v) => typeof(v) === 'string' ? v : v.join('\n')
    ).join('\n');
}
