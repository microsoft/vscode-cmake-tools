import { expect } from 'chai';
import { resolveNormalized, sameFile, compareSortKeys, quoteArgument } from '@cmt/cmakeListsModifier';
import { platformNormalizePath, splitPath } from '@cmt/util';
import * as path from 'path';

suite('cmakeListsModifier pure functions', () => {

    suite('quoteArgument', () => {
        test('Returns plain string unchanged', () => {
            expect(quoteArgument('hello')).to.equal('hello');
        });

        test('Returns path without special chars unchanged', () => {
            expect(quoteArgument('src/main.cpp')).to.equal('src/main.cpp');
        });

        test('Quotes string with spaces', () => {
            expect(quoteArgument('hello world')).to.equal('"hello world"');
        });

        test('Quotes string with parentheses', () => {
            expect(quoteArgument('foo(bar)')).to.equal('"foo(bar)"');
        });

        test('Quotes string with hash', () => {
            expect(quoteArgument('foo#bar')).to.equal('"foo#bar"');
        });

        test('Escapes embedded quotes', () => {
            expect(quoteArgument('say "hi"')).to.equal('"say \\"hi\\""');
        });

        test('Escapes tabs', () => {
            expect(quoteArgument('a\tb')).to.equal('"a\\tb"');
        });

        test('Escapes carriage returns', () => {
            expect(quoteArgument('a\rb')).to.equal('"a\\rb"');
        });

        test('Escapes newlines', () => {
            expect(quoteArgument('a\nb')).to.equal('"a\\nb"');
        });

        test('Escapes backslash', () => {
            expect(quoteArgument('C:\\path')).to.equal('"C:\\path"');
        });

        test('Empty string is returned unchanged', () => {
            expect(quoteArgument('')).to.equal('');
        });

        test('String with only special chars is quoted', () => {
            expect(quoteArgument(' ')).to.equal('" "');
        });
    });

    suite('compareSortKeys', () => {
        test('Equal keys return 0', () => {
            expect(compareSortKeys([1, 2, 3], [1, 2, 3])).to.equal(0);
        });

        test('First differing numeric key determines order', () => {
            expect(compareSortKeys([1, 2], [1, 3])).to.be.lessThan(0);
            expect(compareSortKeys([1, 3], [1, 2])).to.be.greaterThan(0);
        });

        test('First differing string key determines order', () => {
            expect(compareSortKeys(['a', 'b'], ['a', 'c'])).to.be.lessThan(0);
            expect(compareSortKeys(['a', 'c'], ['a', 'b'])).to.be.greaterThan(0);
        });

        test('Shorter array is less when prefix matches', () => {
            expect(compareSortKeys([1, 2], [1, 2, 3])).to.be.lessThan(0);
            expect(compareSortKeys([1, 2, 3], [1, 2])).to.be.greaterThan(0);
        });

        test('Empty arrays are equal', () => {
            expect(compareSortKeys([], [])).to.equal(0);
        });

        test('Empty vs non-empty', () => {
            expect(compareSortKeys([], [1])).to.be.lessThan(0);
        });

        test('Mixed number and string keys', () => {
            // Numbers compared numerically, strings by localeCompare
            expect(compareSortKeys([0, 'a'], [0, 'b'])).to.be.lessThan(0);
            expect(compareSortKeys([1, 'z'], [0, 'a'])).to.be.greaterThan(0);
        });

        test('Negative numbers sort correctly', () => {
            expect(compareSortKeys([-5], [-3])).to.be.lessThan(0);
            expect(compareSortKeys([-1], [-10])).to.be.greaterThan(0);
        });
    });

    suite('resolveNormalized', () => {
        test('Resolves relative path against base', () => {
            const result = resolveNormalized('/project/src', 'main.cpp');
            const expected = platformNormalizePath(path.resolve('/project/src', 'main.cpp'));
            expect(result).to.equal(expected);
        });

        test('Absolute path ignores base', () => {
            const absPath = path.resolve('/absolute/path.cpp');
            const result = resolveNormalized('/project/src', absPath);
            expect(result).to.equal(platformNormalizePath(absPath));
        });

        test('Normalizes parent directory references', () => {
            const result = resolveNormalized('/project/src', '../include/header.h');
            const expected = platformNormalizePath(path.resolve('/project/src', '../include/header.h'));
            expect(result).to.equal(expected);
        });
    });

    suite('sameFile', () => {
        test('Identical paths are same file', () => {
            expect(sameFile('/project/src/main.cpp', '/project/src/main.cpp')).to.be.true;
        });

        test('Different paths are not same file', () => {
            expect(sameFile('/project/src/a.cpp', '/project/src/b.cpp')).to.be.false;
        });

        if (process.platform === 'win32') {
            test('Case-insensitive comparison on Windows', () => {
                expect(sameFile('C:\\Project\\Src\\Main.cpp', 'c:\\project\\src\\main.cpp')).to.be.true;
            });

            test('Forward and back slashes treated same on Windows', () => {
                expect(sameFile('C:/project/src/main.cpp', 'C:\\project\\src\\main.cpp')).to.be.true;
            });
        }
    });

    suite('splitPath', () => {
        test('Splits simple path', () => {
            const parts = splitPath('a/b/c');
            expect(parts).to.have.length.greaterThan(0);
            expect(parts[parts.length - 1]).to.equal('c');
        });

        test('Empty string returns empty array', () => {
            expect(splitPath('')).to.deep.equal([]);
        });

        test('Dot returns empty array', () => {
            expect(splitPath('.')).to.deep.equal([]);
        });
    });
});
