export interface ShlexOptions {
    mode: 'windows' | 'posix';
}

export function* split(str: string, opt?: ShlexOptions): Iterable<string> {
    opt = opt || {
        mode: process.platform === 'win32' ? 'windows' : 'posix'
    };
    const quoteChars = opt.mode === 'posix' ? '\'"' : '"';
    const escapeChars = '\\';
    let escapeChar: string | undefined;
    let token: string | undefined;
    let isSubQuote: boolean = false;

    for (let i = 0; i < str.length; ++i) {
        const char = str.charAt(i);
        if (escapeChar) {
            if (char === '\n') {
                // Do nothing
            } else if (escapeChars.includes(char)) {
                token = (token || '') + char;
            } else {
                token = (token || '') + escapeChar + char;
            }
            // We parsed an escape seq. Reset to no escape
            escapeChar = undefined;
            continue;
        }

        if (escapeChars.includes(char)) {
            // We're parsing an escape sequence.
            escapeChar = char;
            continue;
        }

        if (isSubQuote) {
            if (quoteChars.includes(char)) {
                // Reached the end of a sub-quoted token.
                isSubQuote = false;
                token = (token || '') + char;
                continue;
            }
            // Another quoted char
            token = (token || '') + char;
            continue;
        }

        if (quoteChars.includes(char)) {
            // Beginning of a sub-quoted token
            isSubQuote = true;
            // Accumulate
            token = (token || '') + char;
            continue;
        }

        if (!isSubQuote && /[\t \n\r\f]/.test(char)) {
            if (token !== undefined) {
                yield token;
            }
            token = undefined;
            continue;
        }

        // Accumulate
        token = (token || '') + char;
    }

    if (token !== undefined) {
        yield token;
    }
}

export function quote(str: string, opt?: ShlexOptions): string {
    opt = opt || {
        mode: process.platform === 'win32' ? 'windows' : 'posix'
    };
    if (str === '') {
        return '""';
    }
    if (/[^\w@%\-+=:,./|><]/.test(str)) {
        str = str.replace(/"/g, '\\"');
        return `"${str}"`;
    } else {
        return str;
    }
}
