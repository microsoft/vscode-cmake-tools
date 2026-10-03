import { expect } from 'chai';
import {
    resolveNormalized, compareSortKeys, quoteArgument,
    CommandInvocation, topLevelInvocations, variableReferenceIdent, findPrecedingVariableAssignment
} from '@cmt/cmakeListsModifier';
import { platformNormalizePath, platformPathEquivalent, splitPath } from '@cmt/util';
import { CMakeParser, Token } from '@cmt/cmakeParser';
import { createMockDocument } from './vscode-mock';
import * as path from 'path';

function invocationsOf(text: string): CommandInvocation[] {
    const doc = createMockDocument(text) as any;
    const ast = new CMakeParser(doc).parseDocument();
    return topLevelInvocations(ast.invocations.map(inv => new CommandInvocation(doc, inv)));
}

/** Parses a single command invocation and returns its argument tokens. */
function singleInvocationArgs(text: string): Token[] {
    const doc = createMockDocument(text) as any;
    const ast = new CMakeParser(doc).parseDocument();
    expect(ast.invocations).to.have.lengthOf(1);
    return ast.invocations[0].args;
}

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

    suite('platformPathEquivalent', () => {
        test('Identical paths are equivalent', () => {
            expect(platformPathEquivalent('/project/src/main.cpp', '/project/src/main.cpp')).to.be.true;
        });

        test('Different paths are not equivalent', () => {
            expect(platformPathEquivalent('/project/src/a.cpp', '/project/src/b.cpp')).to.be.false;
        });

        if (process.platform === 'win32') {
            test('Case-insensitive comparison on Windows', () => {
                expect(platformPathEquivalent('C:\\Project\\Src\\Main.cpp', 'c:\\project\\src\\main.cpp')).to.be.true;
            });

            test('Forward and back slashes treated same on Windows', () => {
                expect(platformPathEquivalent('C:/project/src/main.cpp', 'C:\\project\\src\\main.cpp')).to.be.true;
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

    suite('variableReferenceIdent', () => {
        test('Whole-token ${IDENT} reference resolves to IDENT', () => {
            const args = singleInvocationArgs('set(x ${MY_SOURCES})');
            expect(variableReferenceIdent(args[1])).to.equal('MY_SOURCES');
        });

        test('Bare word (no ${}) is not a reference', () => {
            const args = singleInvocationArgs('set(x MY_SOURCES)');
            expect(variableReferenceIdent(args[1])).to.be.undefined;
        });

        test('Partial/interpolated prefix${VAR} is not a reference', () => {
            const args = singleInvocationArgs('set(x prefix${MY_SOURCES})');
            expect(variableReferenceIdent(args[1])).to.be.undefined;
        });

        test('Partial/interpolated ${VAR}suffix is not a reference', () => {
            const args = singleInvocationArgs('set(x ${MY_SOURCES}suffix)');
            expect(variableReferenceIdent(args[1])).to.be.undefined;
        });

        test('Leading underscore identifier is valid', () => {
            const args = singleInvocationArgs('set(x ${_leading_underscore})');
            expect(variableReferenceIdent(args[1])).to.equal('_leading_underscore');
        });

        test('Identifier starting with a digit is not matched', () => {
            const args = singleInvocationArgs('set(x ${1invalid})');
            expect(variableReferenceIdent(args[1])).to.be.undefined;
        });
    });

    suite('findPrecedingVariableAssignment', () => {
        test('Resolves to a prior set()', () => {
            const invocations = invocationsOf('set(MY_SOURCES a.c b.c)\nadd_executable(demo ${MY_SOURCES})');
            const reference = invocations[1];
            const assignment = findPrecedingVariableAssignment('MY_SOURCES', invocations, reference);
            expect(assignment?.command).to.equal('set');
        });

        test('Resolves to a prior list(APPEND ...) when there is no set()', () => {
            const invocations = invocationsOf('list(APPEND MY_SOURCES a.c)\nadd_executable(demo ${MY_SOURCES})');
            const reference = invocations[1];
            const assignment = findPrecedingVariableAssignment('MY_SOURCES', invocations, reference);
            expect(assignment?.command).to.equal('list');
        });

        test('Picks the nearest of two reassignments', () => {
            const invocations = invocationsOf(
                'set(MY_SOURCES a.c)\nset(MY_SOURCES b.c)\nadd_executable(demo ${MY_SOURCES})');
            const reference = invocations[2];
            const assignment = findPrecedingVariableAssignment('MY_SOURCES', invocations, reference);
            expect(assignment).to.equal(invocations[1]);
        });

        test('Returns undefined when never assigned', () => {
            const invocations = invocationsOf('add_executable(demo ${MY_SOURCES})');
            const reference = invocations[0];
            expect(findPrecedingVariableAssignment('MY_SOURCES', invocations, reference)).to.be.undefined;
        });

        test('Returns undefined when the only assignment occurs after the reference', () => {
            const invocations = invocationsOf('add_executable(demo ${MY_SOURCES})\nset(MY_SOURCES a.c)');
            const reference = invocations[0];
            expect(findPrecedingVariableAssignment('MY_SOURCES', invocations, reference)).to.be.undefined;
        });

        test('Ignores assignments inside function()/endfunction() bodies', () => {
            const invocations = invocationsOf(
                'function(foo)\nset(MY_SOURCES a.c)\nendfunction()\nadd_executable(demo ${MY_SOURCES})');
            const reference = invocations[invocations.length - 1];
            expect(findPrecedingVariableAssignment('MY_SOURCES', invocations, reference)).to.be.undefined;
        });

        test('Ignores unrelated set(OTHER_VAR ...)', () => {
            const invocations = invocationsOf(
                'set(OTHER_VAR x.c)\nset(MY_SOURCES a.c)\nadd_executable(demo ${MY_SOURCES})');
            const reference = invocations[2];
            const assignment = findPrecedingVariableAssignment('MY_SOURCES', invocations, reference);
            expect(assignment).to.equal(invocations[1]);
        });

        test('Ignores list(REMOVE_ITEM MY_SOURCES ...) (not an assignment keyword)', () => {
            const invocations = invocationsOf(
                'list(REMOVE_ITEM MY_SOURCES a.c)\nadd_executable(demo ${MY_SOURCES})');
            const reference = invocations[1];
            expect(findPrecedingVariableAssignment('MY_SOURCES', invocations, reference)).to.be.undefined;
        });
    });
});
