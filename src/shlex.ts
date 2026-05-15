export interface ShlexOptions {
    mode: 'windows' | 'posix';
}

function resolveOptions(opt?: ShlexOptions): ShlexOptions {
    return opt || {
        mode: process.platform === 'win32' ? 'windows' : 'posix'
    };
}

function isWhitespace(char: string): boolean {
    return /[\t \n\r\f]/.test(char);
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
    opt = resolveOptions(opt);

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
                    // Backslash followed by whitespace outside quotes: backslash is literal,
                    // whitespace terminates the token. See issue #4902.
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

        if (isWhitespace(char)) {
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

function* splitPosixCommandLine(str: string): Iterable<string> {
    let token: string[] = [];
    let quoteChar: string | undefined;
    let tokenStarted = false;

    for (let i = 0; i < str.length; ++i) {
        const char = str.charAt(i);

        if (quoteChar === "'") {
            if (char === "'") {
                quoteChar = undefined;
            } else {
                token.push(char);
            }
            tokenStarted = true;
            continue;
        }

        if (quoteChar === '"') {
            if (char === '"') {
                quoteChar = undefined;
                tokenStarted = true;
                continue;
            }
            if (char === '\\') {
                const next = str.charAt(i + 1);
                if (next === '\n') {
                    i += 1;
                    tokenStarted = true;
                    continue;
                }
                if (next === '$' || next === '`' || next === '"' || next === '\\') {
                    token.push(next);
                    i += 1;
                    tokenStarted = true;
                    continue;
                }
            }
            token.push(char);
            tokenStarted = true;
            continue;
        }

        if (isWhitespace(char)) {
            if (tokenStarted) {
                yield token.join('');
                token = [];
                tokenStarted = false;
            }
            continue;
        }

        if (char === "'" || char === '"') {
            quoteChar = char;
            tokenStarted = true;
            continue;
        }

        if (char === '\\') {
            const next = str.charAt(i + 1);
            if (next === '\n') {
                i += 1;
                continue;
            }
            if (next) {
                token.push(next);
                i += 1;
            } else {
                token.push(char);
            }
            tokenStarted = true;
            continue;
        }

        token.push(char);
        tokenStarted = true;
    }

    if (tokenStarted) {
        yield token.join('');
    }
}

function* splitWindowsCommandLine(str: string): Iterable<string> {
    let index = 0;

    while (index < str.length) {
        while (index < str.length && isWhitespace(str.charAt(index))) {
            index += 1;
        }
        if (index >= str.length) {
            return;
        }

        const token: string[] = [];
        let inQuotes = false;

        while (index < str.length) {
            let backslashCount = 0;
            while (index < str.length && str.charAt(index) === '\\') {
                backslashCount += 1;
                index += 1;
            }

            if (index < str.length && str.charAt(index) === '"') {
                token.push('\\'.repeat(Math.floor(backslashCount / 2)));
                if (backslashCount % 2 === 0) {
                    if (inQuotes && index + 1 < str.length && str.charAt(index + 1) === '"') {
                        token.push('"');
                        index += 2;
                    } else {
                        inQuotes = !inQuotes;
                        index += 1;
                    }
                } else {
                    token.push('"');
                    index += 1;
                }
                continue;
            }

            if (backslashCount > 0) {
                token.push('\\'.repeat(backslashCount));
            }

            if (index >= str.length || (!inQuotes && isWhitespace(str.charAt(index)))) {
                break;
            }

            token.push(str.charAt(index));
            index += 1;
        }

        yield token.join('');
    }
}

/**
 * Splits a shell command string into raw argv entries suitable for direct execution.
 * Unlike split(), quote characters used only for grouping are removed and platform-specific
 * escape sequences are resolved.
 *
 * @param str The command string to parse into argv entries.
 * @param opt Optional options for splitting. If not provided, defaults to the platform-specific mode ('windows' or 'posix').
 * @returns An iterable of argv entries suitable for proc.execute()/spawn().
 */
export function* splitCommandLine(str: string, opt?: ShlexOptions): Iterable<string> {
    opt = resolveOptions(opt);
    if (opt.mode === 'windows') {
        yield* splitWindowsCommandLine(str);
    } else {
        yield* splitPosixCommandLine(str);
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
    opt = resolveOptions(opt);
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
