export interface ShlexOptions {
    mode: 'windows' | 'posix';
}

/**
 * Splits a string into an iterable of tokens, similar to how a shell would parse arguments.
 * Handles quoting and escaping according to the specified mode ('windows' or 'posix').
 *
 * In POSIX mode, backslash escapes the following character outside of quotes (the backslash
 * is consumed). Inside double quotes, only $, `, ", \, and newline can be escaped.
 * Inside single quotes, backslash has no special meaning.
 *
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
    let quoteChar: string | undefined;  // Track which quote character we're inside (for POSIX)

    for (let i = 0; i < str.length; ++i) {
        const char = str.charAt(i);

        if (escapeChar) {
            if (char === '\n') {
                // Line continuation: consume both backslash and newline
            } else if (opt.mode === 'posix') {
                // POSIX escape handling
                if (quoteChar === "'") {
                    // Inside single quotes: backslash has no special meaning
                    token.push(escapeChar, char);
                } else if (quoteChar === '"') {
                    // Inside double quotes: only certain chars can be escaped
                    // $, `, ", \, and newline
                    if (char === '$' || char === '`' || char === '"' || char === '\\') {
                        token.push(char);
                    } else {
                        token.push(escapeChar, char);
                    }
                } else {
                    // Outside quotes: backslash escapes any character
                    token.push(char);
                }
            } else {
                // Windows mode: only backslash can be escaped
                if (escapeChars.includes(char)) {
                    token.push(char);
                } else if (!quoteChar && /[\t \r\f]/.test(char)) {
                    // Backslash followed by whitespace outside quotes:
                    // backslash is a literal character; whitespace must terminate the token.
                    // Without this, e.g. "/Fd...\ /FS" would be merged into a single token
                    // because the space would be consumed as part of the escape sequence,
                    // causing cl.exe to receive a malformed PDB path and lose the next flag.
                    // See https://github.com/microsoft/vscode-cmake-tools/issues/4902
                    token.push(escapeChar);
                    yield token.join('');
                    token = [];
                    escapeChar = undefined;
                    continue;
                } else {
                    token.push(escapeChar, char);
                }
            }
            escapeChar = undefined;
            continue;
        }

        if (escapeChars.includes(char)) {
            // Start escape sequence
            escapeChar = char;
            continue;
        }

        if (quoteChar) {
            if (char === quoteChar) {
                // End of quoted section
                quoteChar = undefined;
                token.push(char);
                continue;
            }
            token.push(char);
            continue;
        }

        if (quoteChars.includes(char)) {
            // Beginning of a quoted section
            quoteChar = char;
            token.push(char);
            continue;
        }

        if (/[\t \n\r\f]/.test(char)) {
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
