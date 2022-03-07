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
            [`-DAWESOME=\"\\\"fo o bar\\\"\"`, [`-DAWESOME=\"\\\"fo o bar\\\"\"`]]
        ];

        for (const [cmd, expected] of pairs) {
            expect(splitUnix(cmd)).to.eql(expected, `Bad parse for string: ${cmd}`);
        }
    });
});
