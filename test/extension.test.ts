import * as path from 'path';
import * as fs from 'fs';

import * as assert from 'assert';

import * as vscode from 'vscode';

import * as cmake from '../src/cmake';
import * as util from '../src/util';
import * as async from '../src/async';
import * as diagnostics from '../src/diagnostics';
import * as compdb from '../src/compdb';

import * as rimraf from 'rimraf';

const here = __dirname;

function pause(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time));
}

function testFilePath(filename: string): string {
    return path.normalize(path.join(here, '../..', 'test', filename));
}

async function getExtension(): Promise<cmake.CMakeTools> {
    const cmt = vscode.extensions.getExtension<cmake.CMakeTools>('vector-of-bool.cmake-tools');
    return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}

suite("Utility tests", () => {
    test("Read CMake Cache", async function () {
        const cache = await cmake.CMakeCache.fromPath(testFilePath('TestCMakeCache.txt'));
        const generator = cache.get("CMAKE_GENERATOR") as cmake.LegacyCacheEntry;
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

        const build_testing = await cache.get('BUILD_TESTING') as cmake.LegacyCacheEntry;
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
            assert.strictEqual(entry.helpString, 'This line is docs');
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
    test('Parsing compilation databases', () => {
        const dbpath = testFilePath('test_compdb.json');
        return compdb.CompilationDatabase.fromFilePath(dbpath).then(db => {
            assert(db);
            if (db) {
                const source_path = "/home/clang-languageservice/main.cpp";
                const info = db.getCompilationInfoForUri(vscode.Uri.file(source_path));
                assert(info);
                if (info) {
                    assert.strictEqual(source_path, info.file);
                    assert.strictEqual('/home/clang-languageservice/build', info.directory);
                    assert.strictEqual(info.command, "/usr/local/bin/clang++   -DBOOST_THREAD_VERSION=3 -isystem ../extern/nlohmann-json/src  -g   -std=gnu++11 -o CMakeFiles/clang-languageservice.dir/main.cpp.o -c /home/clang-languageservice/main.cpp")
                }
            }
        })
    });
    test('Can access the extension API', async function() {
        interface CMakeToolsAPI {
            binaryDir: string;
        };
        const api: CMakeToolsAPI = await getExtension();
        assert(api.binaryDir);
    });

    const store: any = {};
    function smokeTests(subDescription: string, preSetup: () => Promise<any>) {
        // debugger;
        // this.timeout(60 * 1000); // These tests are slower than just unit tests
        // setup(async () => {
        //     await preSetup();
        //     const cmt = await getExtension();
        //     store.cmt = cmt;
        //     cmt.activeVariantCombination = {
        //         keywordSettings: new Map<string, string>([
        //             ['buildType', 'debug']
        //         ]),
        //         description: 'Smoke Testing configuration',
        //         label: 'Debug (Smoke Testing)'
        //     };
        //     const exists = await new Promise<boolean>(resolve => {
        //         fs.exists(cmt.binaryDir, resolve);
        //     });
        //     // Pause before starting each test. There is trouble on NTFS because
        //     // removing files doesn't actually remove them, which can cause
        //     // spurious test failures when we are rapidly adding/removing files
        //     // in the build directory
        //     await pause(1000);
        //     await new Promise(resolve => exists ? rimraf(cmt.binaryDir, resolve) : resolve());
        // });
        // test(`Can configure (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const retc = await cmt.configure();
        //     assert.strictEqual(retc, 0);
        // });
        // test(`Can build named target (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const retc = await cmt.build('MyExecutable');
        //     assert.strictEqual(retc, 0);
        // });
        // test(`Non-existent target fails (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const retc = await cmt.build('ThisIsNotAnExistingTarget');
        //     assert.notStrictEqual(retc, 0);
        // });
        // test(`Can execute CTest tests (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const retc = await cmt.ctest();
        //     assert.strictEqual(retc, 0);
        // });
        // test(`Finds executable targets (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const retc = await cmt.configure();
        //     assert.strictEqual(retc, 0, 'Configure failed');
        //     const targets = cmt.executableTargets;
        //     assert.strictEqual(targets.length, 1, 'Executable targets are missing');
        //     assert.strictEqual(targets[0].name, 'MyExecutable');
        // });
        // test(`CMake Diagnostic Parsing (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const retc = await cmt.configure(['-DWARNING_COOKIE=this-is-a-warning-cookie']);
        //     assert.strictEqual(retc, 0);
        //     const diags: vscode.Diagnostic[] = [];
        //     cmt.diagnostics.forEach((d, diags_) => diags.push(...diags_));
        //     assert.strictEqual(diags.length, 1);
        //     const diag = diags[0];
        //     assert.strictEqual(diag.source, 'CMake (message)');
        //     assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Warning);
        //     assert(diag.message.includes('this-is-a-warning-cookie'));
        // });
        // test(`Compile Error Parsing (${subDescription})`, async () => {
        //     const cmt: cmake.CMakeTools = store.cmt;
        //     const config_retc = await cmt.configure(['-DCAUSE_BUILD_ERROR=TRUE']);
        //     assert.strictEqual(config_retc, 0);
        //     const build_retc = await cmt.build();
        //     assert.notStrictEqual(build_retc, 0);
        //     const diags: vscode.Diagnostic[] = [];
        //     cmt.diagnostics.forEach((_d, diags_) => diags.push(...diags_));
        //     assert.strictEqual(diags.length, 1);
        //     const diag = diags[0];
        //     // These lines are hardcoded purposefully. They are one less than
        //     // the displayed line number in the main.cpp in the test_project
        //     assert.strictEqual(diag.range.start.line, 6);
        //     assert.strictEqual(diag.range.end.line, 6);
        //     assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Error);
        //     assert(diag.message.includes('special-error-cookie asdfqwerty'));
        // });
        test(`Pass arguments to debugger (${subDescription})`, async () => {
            const cmt: cmake.CMakeTools = store.cmt;
            const retc = await cmt.build();
            assert.strictEqual(retc, 0);
            const outfile = testFilePath('output-file.txt');
            const test_string = 'ceacrybuhksrvniruc48o7dvz';
            await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
                args: [
                    '--write-file', outfile,
                    '--content', test_string,
                ]
            });
            await pause(1000);
            await cmt.debugTarget();
            // Debugging doesn't wait for it to finish. We must pause for a
            // while
            await pause(1000);
            const content = (await async.readFile(outfile)).toString();
            assert.strictEqual(content, test_string);
        });
        test(`Debugger gets environment variables (${subDescription})`, async () => {
            const cmt: cmake.CMakeTools = store.cmt;
            const retc = await cmt.build();
            assert.strictEqual(retc, 0);
            const home = process.env['HOME'];
            const outfile = testFilePath('output-file.txt');
            await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
                args: [
                    '--write-file', outfile,
                    '--env', 'HOME',
                ]
            });
            await pause(1000);
            await cmt.debugTarget();
            await pause(1000);
            const content = (await async.readFile(outfile)).toString();
            assert.strictEqual(content, home);
        });
        test(`Debugger gets custom environment variables (${subDescription})`, async () => {
            const cmt: cmake.CMakeTools = store.cmt;
            const retc = await cmt.build();
            assert.strictEqual(retc, 0);
            const outfile = testFilePath('output-file.txt');
            const test_string = 'ceacrybuhksrvniruc48o7dvz';
            const varname = 'CMTTestEnvironmentVariable';
            await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
                args: [
                    '--write-file', outfile,
                    '--env', varname,
                ],
                environment: [{
                    name: varname,
                    value: test_string,
                }]
            });
            await pause(1000);
            await cmt.debugTarget();
            await pause(1000);
            const content = (await async.readFile(outfile)).toString();
            assert.strictEqual(content, test_string);
        });
        teardown(() => {
            const cmt: cmake.CMakeTools = store.cmt;
            const using_server = !!cmt.serverClient;
            if (using_server) {
                cmt.shutdownServerClient();
            }
            if (fs.existsSync(cmt.binaryDir)) {
                rimraf.sync(cmt.binaryDir);
            }
            const output_file = testFilePath('output-file.txt');
            if (fs.existsSync(output_file)) {
                fs.unlinkSync(output_file);
            }
            if (using_server) {
                cmt.restartServerClient();
            }
        });
    };
    suite('Tests without cmake-server', function() {
        // const cmt = await getExtension();
        // cmt.shutdownServerClient();
        // smokeTests.bind(this)('No cmake-server', async () => {
        //     const cmt = await getExtension();
        //     await cmt.shutdownServerClient();
        // });
    });
    suite('Extension smoke tests', function() {
        smokeTests.bind(this)('Using cmake-server', async() => {
            const cmt = await getExtension();
            if (!cmt.serverClient) {
                await cmt.restartServerClient();
            }
        });
    });
});