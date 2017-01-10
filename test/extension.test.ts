import * as path from 'path';
import * as fs from 'fs';

import * as assert from 'assert';

import * as vscode from 'vscode';

import * as api from '../src/api';
import * as wrapper from '../src/wrapper';
import * as util from '../src/util';
import * as async from '../src/async';
import * as diagnostics from '../src/diagnostics';
import * as compdb from '../src/compdb';
import {CMakeCache} from '../src/cache';

import * as rimraf from 'rimraf';

const here = __dirname;

function pause(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time));
}

function testFilePath(filename: string): string {
    return path.normalize(path.join(here, '../..', 'test', filename));
}

async function getExtension(): Promise<api.CMakeToolsAPI> {
    const cmt = vscode.extensions.getExtension<api.CMakeToolsAPI>('vector-of-bool.cmake-tools');
    return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}

suite("Utility tests", () => {
    test("Read CMake Cache", async function () {
        const cache = await CMakeCache.fromPath(testFilePath('TestCMakeCache.txt'));
        const generator = cache.get("CMAKE_GENERATOR") as api.CacheEntry;
        assert.strictEqual(
            generator.type,
            api.EntryType.Internal
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

        const build_testing = await cache.get('BUILD_TESTING') as api.CacheEntry;
        assert.strictEqual(
            build_testing.type,
            api.EntryType.Bool
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
            const entries = CMakeCache.parseCache(str);
            const message = `Using newline ${JSON.stringify(newline)}`
            assert.strictEqual(entries.size, 1, message);
            assert.strictEqual(entries.has('SOMETHING'), true);
            const entry = entries.get('SOMETHING')!;
            assert.strictEqual(entry.value, 'foo');
            assert.strictEqual(entry.type, api.EntryType.String);
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
            assert.strictEqual(util.isTruthy(thing), false, 'Testing truthiness of ' + thing);
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
            assert.strictEqual(util.isTruthy(thing), true, 'Testing truthiness of ' + thing);
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
    test('Parsing fatal error diagnostics in french', () => {
        const line = '/home/romain/TL/test/base.c:2:21: erreur fatale : bonjour.h : Aucun fichier ou dossier de ce type';
        const diag = diagnostics.parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 1);
            assert.strictEqual(diag.message, 'bonjour.h : Aucun fichier ou dossier de ce type');
            assert.strictEqual(diag.column, 20);
            assert.strictEqual(diag.file, '/home/romain/TL/test/base.c');
            assert.strictEqual(diag.severity, 'erreur');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing warning diagnostics', () => {
        const line = "/some/path/here:4:26: warning: unused parameter 'data'";
        const diag = diagnostics.parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 3);
            assert.strictEqual(diag.message, "unused parameter 'data'");
            assert.strictEqual(diag.column, 25);
            assert.strictEqual(diag.file, '/some/path/here');
            assert.strictEqual(diag.severity, 'warning');
            assert.strictEqual(path.posix.normalize(diag.file), diag.file);
            assert(path.posix.isAbsolute(diag.file));
        }
    });
    test('Parsing warning diagnostics in french', () => {
        const line = '/home/romain/TL/test/base.c:155:2: attention : déclaration implicite de la fonction ‘create’';
        const diag = diagnostics.parseGCCDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 154);
            assert.strictEqual(diag.message, 'déclaration implicite de la fonction ‘create’');
            assert.strictEqual(diag.column, 1);
            assert.strictEqual(diag.file, '/home/romain/TL/test/base.c');
            assert.strictEqual(diag.severity, 'attention');
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
    test('Parsing linker error in french', () => {
        const line = "/home/romain/TL/test/test_fa_tp4.c:9 : référence indéfinie vers « create_automaton_product56 »";
        const diag = diagnostics.parseGNULDDiagnostic(line);
        assert(diag);
        if (diag) {
            assert.strictEqual(diag.line, 8);
            assert.strictEqual(diag.message, "référence indéfinie vers « create_automaton_product56 »");
            assert.strictEqual(diag.file, '/home/romain/TL/test/test_fa_tp4.c');
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
                    assert.strictEqual('/home/clang-languageservice/build', info.compile!.directory);
                    assert.strictEqual(info.compile!.command, "/usr/local/bin/clang++   -DBOOST_THREAD_VERSION=3 -isystem ../extern/nlohmann-json/src  -g   -std=gnu++11 -o CMakeFiles/clang-languageservice.dir/main.cpp.o -c /home/clang-languageservice/main.cpp")
                }
            }
        })
    });
    test('Parsing gnu-style compile info', () => {
        const raw: api.RawCompilationInfo = {
            command: 'clang++ -I/foo/bar -isystem /system/path -fsome-compile-flag -DMACRO=DEFINITION -I ../relative/path "-I/path\\"with\\" embedded quotes/foo"',
            directory: '/some/dir',
            file: 'meow.cpp'
        };
        const info = util.parseRawCompilationInfo(raw);
        assert.strictEqual(raw.command, info.compile!.command);
        assert.strictEqual(raw.directory, info.compile!.directory);
        assert.strictEqual(raw.file, info.file);
        let idx = info.includeDirectories.findIndex(i => i.path == '/system/path');
        assert(idx >= 0);
        let inc = info.includeDirectories[idx];
        assert(inc.isSystem);
        assert.strictEqual(inc.path, '/system/path');
        idx = info.includeDirectories.findIndex(i => i.path == '/some/relative/path');
        assert(idx >= 0);
        inc = info.includeDirectories[idx];
        assert(!inc.isSystem);
        inc = info.includeDirectories[3];
        assert.strictEqual(inc.path, '/path"with" embedded quotes/foo');
        assert.strictEqual(info.compileDefinitions['MACRO'], 'DEFINITION');
        assert.strictEqual(info.compileFlags[0], '-fsome-compile-flag');
        assert.strictEqual(info.compiler, 'clang++');
    });
    test('Parsing MSVC-style compile info', () => {
        const raw: api.RawCompilationInfo = {
            command: 'cl.exe -I/foo/bar /I/system/path /Z+:some-compile-flag /DMACRO=DEFINITION -I ../relative/path "/I/path\\"with\\" embedded quotes/foo"',
            directory: '/some/dir',
            file: 'meow.cpp'
        };
        const info = util.parseRawCompilationInfo(raw);
        assert.strictEqual(raw.command, info.compile!.command);
        assert.strictEqual(raw.directory, info.compile!.directory);
        assert.strictEqual(raw.file, info.file);
        let idx = info.includeDirectories.findIndex(i => i.path == '/system/path');
        assert(idx >= 0);
        let inc = info.includeDirectories[idx];
        assert(!inc.isSystem);
        assert.strictEqual(inc.path, '/system/path');
        idx = info.includeDirectories.findIndex(i => i.path == '/some/relative/path');
        assert(idx >= 0);
        inc = info.includeDirectories[idx];
        assert(!inc.isSystem);
        inc = info.includeDirectories[3];
        assert.strictEqual(inc.path, '/path"with" embedded quotes/foo');
        assert.strictEqual(info.compileDefinitions['MACRO'], 'DEFINITION');
        assert.strictEqual(info.compileFlags[0], '/Z+:some-compile-flag');
        assert.strictEqual(info.compiler, 'cl.exe');
    });
    test('Can access the extension API', async function() {
        const api = await getExtension();
        assert(await api.binaryDir);
    });
    function smokeTests(context, tag, setupHelper) {
        context.timeout(60 * 1000); // These tests are slower than just unit tests
        setup(async function () {
            await setupHelper();
            const cmt = await getExtension();
            this.cmt = cmt;
            await cmt.setActiveVariantCombination({
                buildType: 'debug'
            });
            const bd = await cmt.binaryDir;
            const exists = await new Promise<boolean>(resolve => {
                fs.exists(bd, resolve);
            });
            // Pause before starting each test. There is trouble on NTFS because
            // removing files doesn't actually remove them, which can cause
            // spurious test failures when we are rapidly adding/removing files
            // in the build directory
            await pause(1000);
            await new Promise(resolve => exists ? rimraf(bd, resolve) : resolve());
        });
        test(`Can configure [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.configure();
            assert.strictEqual(retc, 0);
            assert((await cmt.targets).findIndex(t => t.name == 'MyExecutable') >= 0);
        });
        test(`Can build named target [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.build('MyExecutable');
            assert.strictEqual(retc, 0);
        });
        test(`Non-existent target fails [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.build('ThisIsNotAnExistingTarget');
            assert.notStrictEqual(retc, 0);
        });
        test(`Can execute CTest tests [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.ctest();
            assert.strictEqual(retc, 0);
        });
        test(`Finds executable targets [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.configure();
            assert.strictEqual(retc, 0, 'Configure failed');
            const targets = await cmt.executableTargets;
            assert.strictEqual(targets.length, 1, 'Executable targets are missing');
            assert.strictEqual(targets[0].name, 'MyExecutable');
        });
        test(`CMake Diagnostic Parsing [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.configure(['-DWARNING_COOKIE=this-is-a-warning-cookie']);
            assert.strictEqual(retc, 0);
            const diags: vscode.Diagnostic[] = [];
            (await cmt.diagnostics).forEach((d, diags_) => diags.push(...diags_));
            assert.strictEqual(diags.length, 1);
            const diag = diags[0];
            assert.strictEqual(diag.source, 'CMake (message)');
            assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Warning);
            assert(diag.message.includes('this-is-a-warning-cookie'));
        });
        test(`Compile Error Parsing [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const config_retc = await cmt.configure(['-DCAUSE_BUILD_ERROR=TRUE']);
            assert.strictEqual(config_retc, 0);
            const build_retc = await cmt.build();
            assert.notStrictEqual(build_retc, 0);
            const diags: vscode.Diagnostic[] = [];
            (await cmt.diagnostics).forEach((_d, diags_) => diags.push(...diags_));
            assert.strictEqual(diags.length, 1);
            const diag = diags[0];
            // These lines are hardcoded purposefully. They are one less than
            // the displayed line number in the main.cpp in the test_project
            assert.strictEqual(diag.range.start.line, 6);
            assert.strictEqual(diag.range.end.line, 6);
            assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Error);
            assert(diag.message.includes('special-error-cookie asdfqwerty'));
        });
        test(`Pass arguments to debugger [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
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
        test(`Debugger gets environment variables [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.build();
            assert.strictEqual(retc, 0);
            const pathvar = process.env['PATH'];
            const outfile = testFilePath('output-file.txt');
            await vscode.workspace.getConfiguration('cmake').update('debugConfig', {
                args: [
                    '--write-file', outfile,
                    '--env', 'PATH',
                ]
            });
            await pause(1000);
            await cmt.debugTarget();
            await pause(1000);
            const content = (await async.readFile(outfile)).toString();
            assert.strictEqual(content, pathvar);
        });
        test(`Debugger gets custom environment variables [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
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
        test(`Get compilation info for a file [${tag}]`, async function() {
            const cmt: api.CMakeToolsAPI = this.cmt;
            const retc = await cmt.configure();
            assert.strictEqual(retc, 0);
            const info = await cmt.compilationInfoForFile(testFilePath('test_project/main.cpp'));
            assert(info);
        });
        teardown(async function() {
            const cmt: wrapper.CMakeToolsWrapper = this.cmt;
            await cmt.shutdown();
            if (fs.existsSync(await cmt.binaryDir)) {
                rimraf.sync(await cmt.binaryDir);
            }
            const output_file = testFilePath('output-file.txt');
            if (fs.existsSync(output_file)) {
                fs.unlinkSync(output_file);
            }
            await cmt.reload();
        });
    };
    suite('Extension smoke tests [without cmake-server]', function() {
        smokeTests(this, 'without cmake-server', async() => {
            // await vscode.workspace.getConfiguration('cmake').update('experimental.useCMakeServer', false);
        });
    });
    // suite('Extension smoke tests [with cmake-server]', function() {
    //     smokeTests(this, 'with cmake-server', async() => {
    //         await vscode.workspace.getConfiguration('cmake').update('experimental.useCMakeServer', true);
    //     });
    // });
});