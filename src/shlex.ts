export interface ShlexOptions {
    mode: 'windows' | 'posix';
}

/**
 * Splits a string into an iterable of tokens, similar to how a shell would parse arguments.
 * Handles quoting and escaping according to the specified mode ('windows' or 'posix').
 * @param str The string to split into tokens.
 * @param opt Optional options for splitting. If not provided, defaults to the platform-specific mode ('windows' or 'posix').
 * @returns An iterable of tokens.
 */
export function* split(str: string, opt?: ShlexOptions): Iterable<string> {
    opt = opt || {
        mode: process.platform === 'win32' ? 'windows' : 'posix'
    };

    const quoteChars = opt.mode === 'posix' ? '\'"' : '"';
    const escapeChars = '\\';
    let escapeChar: string | undefined;
    let token: string[] = [];
    let isSubQuote: boolean = false;

    for (let i = 0; i < str.length; ++i) {
        const char = str.charAt(i);

        if (escapeChar) {
            if (char === '\n') {
                // Do nothing
            } else if (escapeChars.includes(char)) {
                token.push(char);
            } else {
                token.push(escapeChar, char);  // Append escape sequence
            }
            // We parsed an escape seq. Reset to no escape
            escapeChar = undefined;
            continue;
        }

        if (escapeChars.includes(char)) {
            // Start escape sequence
            escapeChar = char;
            continue;
        }

        if (isSubQuote) {
            if (quoteChars.includes(char)) {
                // End of sub-quoted token
                isSubQuote = false;
                token.push(char);
                continue;
            }
            token.push(char);
            continue;
        }

        if (quoteChars.includes(char)) {
            // Beginning of a subquoted token
            isSubQuote = true;
            token.push(char);
            continue;
        }

        if (!isSubQuote && /[\t \n\r\f]/.test(char)) {
            if (token.length > 0) {
                yield token.join('');
            }
            token = [];
            continue;
        }

        token.push(char);
    }

    if (token.length > 0) {
        yield token.join('');
    }
}

/**
 * Quotes a string for safe use in a shell command.
 * If the string contains special characters, it will be wrapped in double quotes and any existing double quotes will be escaped.
 * @param str The string to quote.
 * @param opt Optional options for quoting. If not provided, defaults to the platform-specific mode ('windows' or 'posix').
 * @returns The quoted string.
 */
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
