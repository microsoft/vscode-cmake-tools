import {Maybe} from './util';

export interface RawDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
}


export function parseGCCDiagnostic(line: string): Maybe<RawDiagnostic> {
    const gcc_re = /^(.*):(\d+):(\d+):\s+(?:fatal )?(warning|error|note):\s+(.*)$/;
    const res = gcc_re.exec(line);
    if (!res)
        return null;
    const [_, file, lineno, column, severity, message] = res;
    if (file && lineno && column && severity && message) {
        return {
            file: file,
            line: parseInt(lineno) - 1,
            column: parseInt(column) - 1,
            severity: severity,
            message: message
        }
    } else {
        return null;
    }
}