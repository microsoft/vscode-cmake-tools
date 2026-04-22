import { expect } from 'chai';
import * as shlex from '@cmt/shlex';

function splitWin(str: string): string[] {
    return [...shlex.split(str, { mode: 'windows' })];
}

function splitUnix(str: string): string[] {
    return [...shlex.split(str, { mode: 'posix' })];
}

suite('shlex testing (backend)', () => {
    suite('Windows shell splitting', () => {
        test('Basic token splitting', () => {
            const pairs: [string, string[]][] = [
                ['foo', ['foo']],
                ['foo bar', ['foo', 'bar']],
                ['', []],
                ['""', ['""']],
                ['    Something    ', ['Something']],
                ['foo     bar', ['foo', 'bar']],
                ['"C:\\Program Files" something', ['"C:\\Program Files"', 'something']],
                ['foo "" bar', ['foo', '""', 'bar']],
                [`\"'fo o'\" bar`, [`\"'fo o'\"`, 'bar']],
                [`'quote arg'`, [`'quote`, `arg'`]],
                ['"   fail"', ['"   fail"']]
            ];

            for (const [cmd, expected] of pairs) {
                expect(splitWin(cmd)).to.deep.equal(expected, `Bad parse for string: ${cmd}`);
            }
        });

        test('Windows mode: backslash only escapes backslash, not quotes', () => {
            // -DAWESOME=\"\\\"'fo o' bar\\\"\" should preserve all escapes
            const cmd = `-DAWESOME=\"\\\"'fo o' bar\\\"\"`;
            expect(splitWin(cmd)).to.deep.equal([`-DAWESOME=\"\\\"'fo o' bar\\\"\"`]);
        });
    });

    suite('Posix shell splitting', () => {
        test('Basic token splitting', () => {
            const pairs: [string, string[]][] = [
                ['foo', ['foo']],
                ['foo bar', ['foo', 'bar']],
                ['', []],
                ['""', ['""']],
                [`''`, [`''`]],
                ['    Something    ', ['Something']],
                ['foo     bar', ['foo', 'bar']],
                ['"C:\\Program Files" something', ['"C:\\Program Files"', 'something']],
                ['foo "" bar', ['foo', '""', 'bar']],
                [`"fo o" bar`, [`"fo o"`, 'bar']],
                [`'quote arg'`, [`'quote arg'`]],
                ['"   fail"', ['"   fail"']]
            ];

            for (const [cmd, expected] of pairs) {
                expect(splitUnix(cmd)).to.deep.equal(expected, `Bad parse for string: ${cmd}`);
            }
        });
    });

    suite('Posix escape handling outside quotes', () => {
        test('\\\\ -> single backslash', () => {
            expect(splitUnix('foo\\\\bar')).to.deep.equal(['foo\\bar']);
        });

        test('\\" -> literal quote', () => {
            expect(splitUnix('-DFOO=\\"bar\\"')).to.deep.equal(['-DFOO="bar"']);
        });

        test('\\n (not newline char) -> n', () => {
            expect(splitUnix('foo\\nbar')).to.deep.equal(['foonbar']);
        });

        test('Escaped space keeps token together', () => {
            expect(splitUnix('foo\\ bar')).to.deep.equal(['foo bar']);
        });

        test('Line continuation (actual newline) - backslash+newline consumed', () => {
            expect(splitUnix('foo\\\nbar')).to.deep.equal(['foobar']);
        });

        test('Compile command with escaped quotes (issue #4896)', () => {
            expect(splitUnix('-DIMGUI_USER_CONFIG=\\"frontends/sdl/imgui/sa2_imconfig.h\\"'))
                .to.deep.equal(['-DIMGUI_USER_CONFIG="frontends/sdl/imgui/sa2_imconfig.h"']);
        });
    });

    suite('Posix escape handling inside double quotes', () => {
        test('Inside double quotes: \\\\ -> \\', () => {
            expect(splitUnix('"foo\\\\bar"')).to.deep.equal(['"foo\\bar"']);
        });

        test('Inside double quotes: \\" -> "', () => {
            expect(splitUnix('"foo\\"bar"')).to.deep.equal(['"foo"bar"']);
        });

        test('Inside double quotes: \\n (not escapable) -> \\n preserved', () => {
            expect(splitUnix('"foo\\nbar"')).to.deep.equal(['"foo\\nbar"']);
        });

        test('Inside double quotes: \\$ -> $', () => {
            expect(splitUnix('"foo\\$bar"')).to.deep.equal(['"foo$bar"']);
        });

        test('Inside double quotes: \\` -> `', () => {
            expect(splitUnix('"foo\\`bar"')).to.deep.equal(['"foo`bar"']);
        });
    });

    suite('Posix escape handling inside single quotes', () => {
        test('Inside single quotes: backslash has no special meaning', () => {
            expect(splitUnix(`'foo\\bar'`)).to.deep.equal([`'foo\\bar'`]);
        });

        test('Inside single quotes: \\" stays as \\"', () => {
            expect(splitUnix(`'foo\\"bar'`)).to.deep.equal([`'foo\\"bar'`]);
        });

        test('Inside single quotes: \\\\ stays as \\\\', () => {
            expect(splitUnix(`'foo\\\\bar'`)).to.deep.equal([`'foo\\\\bar'`]);
        });
    });

    // Cross-platform regression tests (macOS uses POSIX mode)
    suite('Cross-platform: mixed quotes (macOS/Linux POSIX)', () => {
        test('Double quote inside single quotes is literal', () => {
            // 'a"b' -> single token with literal "
            expect(splitUnix(`'a"b'`)).to.deep.equal([`'a"b'`]);
        });

        test('Single quote inside double quotes is literal', () => {
            // "a'b" -> single token with literal '
            expect(splitUnix(`"a'b"`)).to.deep.equal([`"a'b"`]);
        });

        test('Adjacent mixed quotes form single token', () => {
            // "foo"'bar' -> foo and bar concatenated
            expect(splitUnix(`"foo"'bar'`)).to.deep.equal([`"foo"'bar'`]);
        });

        test('Complex mixed quoting with spaces', () => {
            // "foo bar"'baz qux' -> single token
            expect(splitUnix(`"foo bar"'baz qux'`)).to.deep.equal([`"foo bar"'baz qux'`]);
        });
    });

    suite('Cross-platform: Windows path preservation', () => {
        test('Windows paths in Windows mode preserve backslashes', () => {
            expect(splitWin('"C:\\Users\\test\\file.cpp"')).to.deep.equal(['"C:\\Users\\test\\file.cpp"']);
        });

        test('Windows trailing backslash in quoted path', () => {
            // "C:\path\" arg - the backslash before closing quote escapes the quote in Windows mode,
            // so the entire rest of the string becomes one token (this is existing behavior)
            expect(splitWin('"C:\\path\\" arg')).to.deep.equal(['"C:\\path\\" arg']);
        });

        test('UNC paths in Windows mode', () => {
            // In Windows mode, \\ becomes \ (backslash escapes backslash)
            expect(splitWin('"\\\\server\\share\\file.cpp"')).to.deep.equal(['"\\server\\share\\file.cpp"']);
        });
    });
});
