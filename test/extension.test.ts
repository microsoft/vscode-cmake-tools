import * as path from 'path';

import * as assert from 'assert';

import * as vscode from 'vscode';
import * as cmake_tools_ext from '../src/extension';

import * as cmake from '../src/cmake';
import * as diagnostics from '../src/diagnostics';

const here = __dirname;

function testFilePath(filename: string): string {
    return path.normalize(path.join(here, '../..', 'test', filename));
}


suite("Utility tests", () => {
    test("Read CMake Cache", async function () {
        const cache = await cmake.CMakeCache.fromPath(testFilePath('TestCMakeCache.txt'));
        const generator = cache.get("CMAKE_GENERATOR") as cmake.CacheEntry;
        assert.strictEqual(
            generator.type,
            cmake.EntryType.Internal
        );
        assert.strictEqual(
            generator.key,
            'CMAKE_GENERATOR'
        );
        assert.strictEqual(
            generator.value,
            'Ninja'
        );
        assert.strictEqual(
            generator.as<string>(),
            'Ninja'
        );
        assert.strictEqual(typeof generator.value === 'string', true);

        const build_testing = await cache.get('BUILD_TESTING') as cmake.CacheEntry;
        assert.strictEqual(
            build_testing.type,
            cmake.EntryType.Bool
        );
        assert.strictEqual(
            build_testing.as<boolean>(),
            true
        );
    });
    test("Read cache with various newlines", async function() {
        for (const newline of ['\n', '\r\n', '\r']) {
            const str = [
                '# This line is ignored',
                '// This line is docs',
                'SOMETHING:STRING=foo',
                ''
            ].join(newline);
            const entries = cmake.CMakeCache.parseCache(str);
            const message = `Using newline ${JSON.stringify(newline)}`
            assert.strictEqual(entries.size, 1, message);
            assert.strictEqual(entries.has('SOMETHING'), true);
            const entry = entries.get('SOMETHING')!;
            assert.strictEqual(entry.value, 'foo');
            assert.strictEqual(entry.type, cmake.EntryType.String);
            assert.strictEqual(entry.docs, 'This line is docs');
        }
    });
    test('Falsey values', () => {
        for (const thing of [
            '0',
            '',
            'NO',
            'FALSE',
            'OFF',
            'NOTFOUND',
            'IGNORE',
            'N',
            'SOMETHING-NOTFOUND',
            null,
            false,
        ]) {
            assert.strictEqual(cmake.isTruthy(thing), false, 'Testing truthiness of ' + thing);
        }
    });
    test('Truthy values', () => {
        for (const thing of [
            '1',
            'ON',
            'YES',
            'Y',
            '112',
            12,
            'SOMETHING'
        ]) {
            assert.strictEqual(cmake.isTruthy(thing), true, 'Testing truthiness of ' + thing);
        }
    });
    test('Parsing Apple Clang Diagnostics', () => {
        const line = '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h:85:15: warning: comparison of unsigned expression >= 0 is always true [-Wtautological-compare]';
        const diag = diagnostics.parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 84);
            assert.strictEqual(diag.message, 'comparison of unsigned expression >= 0 is always true [-Wtautological-compare]');
            assert.strictEqual(diag.column, 14);
            assert.strictEqual(diag.file, '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h');
            assert.strictEqual(diag.severity, 'warning');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing fatal error diagnostics', () => {
        const line = '/some/path/here:4:26: fatal error: some_header.h: No such file or directory';
        const diag = diagnostics.parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 3);
            assert.strictEqual(diag.message, 'some_header.h: No such file or directory');
            assert.strictEqual(diag.column, 25);
            assert.strictEqual(diag.file, '/some/path/here');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing linker error', () => {
        const line = "/some/path/here:101: undefined reference to `some_function'";
        const diag = diagnostics.parseGNULDDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 100);
            assert.strictEqual(diag.message, "undefined reference to `some_function'");
            assert.strictEqual(diag.file, '/some/path/here');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing GHS Diagnostics', () => {
        const line = '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): warning #68-D: integer conversion resulted in a change of sign';
        const diag = diagnostics.parseGHSDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 630);
            assert.strictEqual(diag.message, '#68-D: integer conversion resulted in a change of sign');
            assert.strictEqual(diag.column, 2);
            assert.strictEqual(diag.file, 'C:\\path\\source\\debug\\debug.c');
            assert.strictEqual(diag.severity, 'warning');
            assert.strictEqual(path.win32.normalize(diag.file), diag.file);
            assert(path.win32.isAbsolute(diag.file));
        }
    });
    test('Parsing GHS Diagnostics At end of source', () => {
        const line = '"C:\\path\\source\\debug\\debug.c", At end of source: remark #96-D: a translation unit must contain at least one declaration';
        const diag = diagnostics.parseGHSDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 0);
            assert.strictEqual(diag.message, '#96-D: a translation unit must contain at least one declaration');
            assert.strictEqual(diag.column, 0);
            assert.strictEqual(diag.file, 'C:\\path\\source\\debug\\debug.c');
            assert.strictEqual(diag.severity, 'remark');
            assert.strictEqual(path.win32.normalize(diag.file), diag.file);
            assert(path.win32.isAbsolute(diag.file));
        }
    });
    test('Parsing GHS Diagnostics fatal error', () => {
        const line = '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): fatal error #68: some fatal error';
        const diag = diagnostics.parseGHSDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 630);
            assert.strictEqual(diag.message, '#68: some fatal error');
            assert.strictEqual(diag.column, 2);
            assert.strictEqual(diag.file, 'C:\\path\\source\\debug\\debug.c');
            assert.strictEqual(diag.severity, 'error');
            assert.strictEqual(path.win32.normalize(diag.file), diag.file);
            assert(path.win32.isAbsolute(diag.file));
        }
    });
});