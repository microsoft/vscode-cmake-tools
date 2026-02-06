import * as util from '@cmt/util';
import { expect } from '@test/util';

suite('Utils test', () => {
    test('Split path into elements', () => {
        const elems = util.splitPath('foo/bar/baz');
        expect(elems).to.eql(['foo', 'bar', 'baz']);
    });
    test('Split empty path', () => {
        const elems = util.splitPath('');
        expect(elems).to.eql([]);
    });
    test('Milliseconds to time span string', () => {
        const tests: [x: number, s: string][] = [
            [0, '00:00:00.000'],
            [1, '00:00:00.001'],
            [10, '00:00:00.010'],
            [100, '00:00:00.100'],
            [1000, '00:00:01.000'],
            [10000, '00:00:10.000'],
            [60000, '00:01:00.000'],
            [600000, '00:10:00.000'],
            [3600000, '01:00:00.000'],
            [36000000, '10:00:00.000'],
            [39599999, '10:59:59.999']
        ];
        for (const test of tests) {
            expect(util.msToString(test[0])).to.eq(test[1]);
        }
    });
});

suite('cmakeify test', () => {
    test('Convert boolean true to CMake BOOL', () => {
        const result = util.cmakeify(true);
        expect(result.type).to.eq('BOOL');
        expect(result.value).to.eq('TRUE');
    });
    test('Convert boolean false to CMake BOOL', () => {
        const result = util.cmakeify(false);
        expect(result.type).to.eq('BOOL');
        expect(result.value).to.eq('FALSE');
    });
    test('Convert string to CMake STRING', () => {
        const result = util.cmakeify('hello');
        expect(result.type).to.eq('STRING');
        expect(result.value).to.eq('hello');
    });
    test('Convert string with semicolons without escaping', () => {
        const result = util.cmakeify('libc;compiler-rt');
        expect(result.type).to.eq('STRING');
        expect(result.value).to.eq('libc;compiler-rt');
    });
    test('Convert number to CMake STRING', () => {
        const result = util.cmakeify(42);
        expect(result.type).to.eq('STRING');
        expect(result.value).to.eq('42');
    });
    test('Convert array to CMake STRING with semicolon separator', () => {
        const result = util.cmakeify(['a', 'b', 'c']);
        expect(result.type).to.eq('STRING');
        expect(result.value).to.eq('a;b;c');
    });
    test('Convert CMakeValue passthrough', () => {
        const input: util.CMakeValue = { type: 'FILEPATH', value: '/path/to/file' };
        const result = util.cmakeify(input);
        expect(result.type).to.eq('FILEPATH');
        expect(result.value).to.eq('/path/to/file');
    });
});
