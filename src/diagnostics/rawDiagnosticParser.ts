/**
 * Base class for handling diagnostics
 */

export enum FeedLineResult {
    Ok,
    NotMine,
}

export interface RawDiagnosticLocation {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

export interface RawRelated {
    file: string;
    location: RawDiagnosticLocation;
    message: string;
}

export interface RawDiagnostic {
    full: string;
    file: string;
    location: RawDiagnosticLocation;
    severity: string;
    message: string;
    code?: string;
    related: RawRelated[];
}

/**
 * Base class for parsing raw diagnostic information on a line-by-line basis
 */
export abstract class RawDiagnosticParser {
    /**
     * Get the diagnostics which have been parsed by this object
     */
    get diagnostics(): readonly RawDiagnostic[] {
        return this._diagnostics;
    }
    private readonly _diagnostics: RawDiagnostic[] = [];

    /**
     * Push another line into the parser
     * @param line Another line to parse
     */
    handleLine(line: string): boolean {
        const result = this.doHandleLine(line);
        if (result === FeedLineResult.Ok) {
            return true;
        } else if (result === FeedLineResult.NotMine) {
            return false;
        } else {
            this._diagnostics.push(result);
            return true;
        }
    }

    /**
     * Implement in derived classes to parse a line. Returns a new diagnostic, or
     * `undefined` if the give line does not complete a diagnostic
     * @param line The line to process
     */
    protected abstract doHandleLine(line: string): RawDiagnostic | FeedLineResult;
}
