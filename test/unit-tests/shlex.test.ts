import * as shlex from '@cmt/shlex';
import { expect } from '@test/util';

function splitWin(str: string): string[] {
    return [...shlex.split(str, { mode: 'windows' })];
}

function splitUnix(str: string): string[] {
    return [...shlex.split(str, { mode: 'posix' })];
}

suite('shlex testing', () => {
    test('Windows shell splitting', () => {
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
            ['"   fail"', ['"   fail"']],
            // Windows mode: backslash only escapes backslash, not quotes
            [`-DAWESOME=\"\\\"'fo o' bar\\\"\"`, [`-DAWESOME=\"\\\"'fo o' bar\\\"\"`]]
        ];

        for (const [cmd, expected] of pairs) {
            expect(splitWin(cmd)).to.eql(expected, `Bad parse for string: ${cmd}`);
        }
    });
    test('Posix shell splitting', () => {
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
            ['"   fail"', ['"   fail"']],
            // POSIX mode: backslash outside quotes escapes any character (backslash consumed)
            // Input: -DAWESOME=\"\"fo o bar\"\"  (escaped quotes outside quotes)
            // After escape processing: -DAWESOME=""fo o bar""
            // But the inner "" is an empty double-quoted section, so we get:
            [`-DAWESOME=\"\"fo o bar\"\"`, [`-DAWESOME=""fo`, 'o', 'bar""']]
        ];

        for (const [cmd, expected] of pairs) {
            expect(splitUnix(cmd)).to.eql(expected, `Bad parse for string: ${cmd}`);
        }
    });

    test('Posix escape handling outside quotes', () => {
        const pairs: [string, string[]][] = [
            // \\ -> single backslash
            ['foo\\\\bar', ['foo\\bar']],
            // \" -> literal quote
            ['-DFOO=\\"bar\\"', ['-DFOO="bar"']],
            // \n (not newline char) -> n
            ['foo\\nbar', ['foonbar']],
            // Escaped space keeps token together
            ['foo\\ bar', ['foo bar']],
            // Line continuation (actual newline) - backslash+newline consumed
            ['foo\\\nbar', ['foobar']],
            // Compile command with escaped quotes (issue #4896)
            ['-DIMGUI_USER_CONFIG=\\"frontends/sdl/imgui/sa2_imconfig.h\\"', ['-DIMGUI_USER_CONFIG="frontends/sdl/imgui/sa2_imconfig.h"']]
        ];

        for (const [cmd, expected] of pairs) {
            expect(splitUnix(cmd)).to.eql(expected, `Bad parse for string: ${cmd}`);
        }
    });

    test('Posix escape handling inside double quotes', () => {
        const pairs: [string, string[]][] = [
            // Inside double quotes: \\ -> \
            ['"foo\\\\bar"', ['"foo\\bar"']],
            // Inside double quotes: \" -> "
            ['"foo\\"bar"', ['"foo"bar"']],
            // Inside double quotes: \n (not escapable) -> \n preserved
            ['"foo\\nbar"', ['"foo\\nbar"']],
            // Inside double quotes: \$ -> $
            ['"foo\\$bar"', ['"foo$bar"']],
            // Inside double quotes: \` -> `
            ['"foo\\`bar"', ['"foo`bar"']]
        ];

        for (const [cmd, expected] of pairs) {
            expect(splitUnix(cmd)).to.eql(expected, `Bad parse for string: ${cmd}`);
        }
    });

    test('Posix escape handling inside single quotes', () => {
        const pairs: [string, string[]][] = [
            // Inside single quotes: backslash has no special meaning
            [`'foo\\bar'`, [`'foo\\bar'`]],
            [`'foo\\"bar'`, [`'foo\\"bar'`]],
            [`'foo\\\\bar'`, [`'foo\\\\bar'`]]
        ];

        for (const [cmd, expected] of pairs) {
            expect(splitUnix(cmd)).to.eql(expected, `Bad parse for string: ${cmd}`);
        }
    });
});
