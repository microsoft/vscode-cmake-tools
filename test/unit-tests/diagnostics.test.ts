/* eslint-disable no-unused-expressions */
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import { expect } from 'chai';
import * as diags from '@cmt/diagnostics/build';
import { OutputConsumer } from '../../src/proc';
import { ExtensionConfigurationSettings, ConfigurationReader } from '../../src/config';
import { CustomParser, BuildProblemMatcherConfig } from '@cmt/diagnostics/custom';
import { platformPathEquivalent, resolvePath } from '@cmt/util';
import { CMakeOutputConsumer } from '@cmt/diagnostics/cmake';
import { populateCollection } from '@cmt/diagnostics/util';
import collections from '@cmt/diagnostics/collections';
import { getTestResourceFilePath } from '@test/util';
import { Logger } from '@cmt/logging';

/** A spy logger that records which log methods were called and at what level. */
class SpyLogger extends Logger {
    readonly calls: { level: string; args: string[] }[] = [];
    constructor() {
        super('spy');
    }
    override trace(...args: any[]) {
        this.calls.push({ level: 'trace', args: args.map(String) });
    }
    override debug(...args: any[]) {
        this.calls.push({ level: 'debug', args: args.map(String) });
    }
    override info(...args: any[]) {
        this.calls.push({ level: 'info', args: args.map(String) });
    }
    override warning(...args: any[]) {
        this.calls.push({ level: 'warning', args: args.map(String) });
    }
    override error(...args: any[]) {
        this.calls.push({ level: 'error', args: args.map(String) });
    }
}

function feedLines(consumer: OutputConsumer, output: string[], error: string[]) {
    for (const line of output) {
        consumer.output(line);
    }
    for (const line of error) {
        consumer.error(line);
    }
}

suite('Diagnostics', () => {
    let consumer = new CMakeOutputConsumer('dummyPath');
    let build_consumer = new diags.CompileOutputConsumer(new ConfigurationReader({} as ExtensionConfigurationSettings));
    setup(() => {
        // FIXME: SETUP IS NOT BEING CALLED
        consumer = new CMakeOutputConsumer('dummyPath');
        build_consumer = new diags.CompileOutputConsumer(new ConfigurationReader({} as ExtensionConfigurationSettings));
    });
    test('Waring-free CMake output', async () => {
        const cmake_output = [
            '-- Configuring done',
            '-- Generating done',
            '-- Build files have been written to /foo/bar'
        ];
        feedLines(consumer, cmake_output, []);
    });

    test('Parse a warning', () => {
        const error_output = [
            'CMake Warning at CMakeLists.txt:14 (message):',
            '  I am a warning!',
            '',
            ''
        ];
        feedLines(consumer, [], error_output);
        expect(consumer.diagnostics.length).to.eq(1);
        const diag = consumer.diagnostics[0];
        expect(diag.filepath).to.eq('dummyPath/CMakeLists.txt');
        expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(diag.diag.source).to.eq('CMake (message)');
        expect(diag.diag.message).to.match(/I am a warning!$/);
        expect(diag.diag.range.start.line).to.eq(13);  // Line numbers are one-based
    });
    test('Parse a deprecation warning', () => {
        const error_output = [
            'CMake Deprecation Warning at CMakeLists.txt:14 (message):',
            '  I am deprecated!',
            '',
            ''
        ];
        feedLines(consumer, [], error_output);
        expect(consumer.diagnostics.length).to.eq(1);
        const diag = consumer.diagnostics[0];
        expect(diag.filepath).to.eq('dummyPath/CMakeLists.txt');
        expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(diag.diag.source).to.eq('CMake (message)');
        expect(diag.diag.message).to.match(/I am deprecated!$/);
        expect(diag.diag.range.start.line).to.eq(13);  // Line numbers are one-based
    });
    test('Parse two diags', () => {
        const error_output = [
            'CMake Warning at CMakeLists.txt:14 (message):',
            '  I am a warning!',
            '',
            '',
            '-- Ignore me!',
            '-- Me too',
            'CMake Error at CMakeLists.txt:13 (some_error_function):',
            '  I am an error!',
            '',
            '',
            '-- Extra suff'
        ];
        feedLines(consumer, [], error_output);
        expect(consumer.diagnostics.length).to.eq(2);
        const warning = consumer.diagnostics[0];
        const error = consumer.diagnostics[1];
        expect(warning.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(error.diag.severity).to.eq(vscode.DiagnosticSeverity.Error);
        expect(warning.diag.range.start.line).to.eq(13);
        expect(error.diag.range.start.line).to.eq(12);
        expect(warning.diag.source).to.eq('CMake (message)');
        expect(error.diag.source).to.eq('CMake (some_error_function)');
        expect(warning.diag.message).to.match(/I am a warning!$/);
        expect(error.diag.message).to.match(/I am an error!$/);
    });
    test('Parse diags with call stacks', () => {
        const error_output = [
            'CMake Warning at CMakeLists.txt:15 (message):',
            '  I\'m an inner warning',
            'Call Stack (most recent call first):',
            '  CMakeLists.txt:18 (another_fn)',
            '',
            '',
            '-- Configuring done',
            '-- Generating done'
        ];
        feedLines(consumer, [], error_output);
        expect(consumer.diagnostics.length).to.eq(1);
        const warning = consumer.diagnostics[0];
        expect(warning.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(warning.diag.message).to.match(/I'm an inner warning$/);
        expect(warning.diag.range.start.line).to.eq(14);
        expect(warning.diag.source).to.eq('CMake (message)');
    });
    test('Parse Author Warnings', () => {
        const error_output = [
            'CMake Warning (dev) at CMakeLists.txt:15 (message):',
            '  I\'m an inner warning',
            'Call Stack (most recent call first):',
            '  CMakeLists.txt:18 (another_fn)',
            'This warning is for project developers.  Use -Wno-dev to suppress it.',
            '',
            '-- Configuring done',
            '-- Generating done'
        ];
        feedLines(consumer, [], error_output);
        expect(consumer.diagnostics.length).to.eq(1);
        const warning = consumer.diagnostics[0];
        expect(warning.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(warning.diag.message).to.match(/I'm an inner warning$/);
        expect(warning.diag.range.start.line).to.eq(14);
        expect(warning.diag.source).to.eq('CMake (message)');
    });
    test('Populate a diagnostic collection', () => {
        const error_output = [
            'CMake Warning at CMakeLists.txt:14 (message):',
            '  I am a warning!',
            '',
            '',
            '-- Ignore me!',
            '-- Me too',
            'CMake Error at CMakeLists.txt:13 (some_error_function):',
            '  I am an error!',
            '',
            '',
            '-- Extra suff'
        ];
        feedLines(consumer, [], error_output);
        expect(consumer.diagnostics.length).to.eq(2);
        const coll = vscode.languages.createDiagnosticCollection('cmake-tools-test');
        populateCollection(coll, consumer.diagnostics);
        const fullpath = 'dummyPath/CMakeLists.txt';
        expect(coll.has(vscode.Uri.file(fullpath))).to.be.true;
        expect(coll.get(vscode.Uri.file(fullpath))!.length).to.eq(2);
    });

    test('Parsing Apple Clang Diagnostics', () => {
        const lines = [
            '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h:85:15: warning: comparison of unsigned expression >= 0 is always true [-Wtautological-compare]'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];
        expect(diag.location.start.line).to.eq(84);
        expect(diag.message).to.eq('comparison of unsigned expression >= 0 is always true [-Wtautological-compare]');
        expect(diag.location.start.character).to.eq(14);
        const expected = '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h';
        expect(platformPathEquivalent(diag.file, expected), `${diag.file} !== ${expected}`).to.be.true;
        expect(diag.severity).to.eq('warning');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });

    test('Parse more GCC diagnostics', () => {
        const lines = [`/Users/Tobias/Code/QUIT/Source/qidespot1.cpp:303:49: error: expected ';' after expression`];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];
        const expected = '/Users/Tobias/Code/QUIT/Source/qidespot1.cpp';
        expect(platformPathEquivalent(diag.file, expected), `${diag.file} !== ${expected}`).to.be.true;
        expect(diag.location.start.line).to.eq(302);
        expect(diag.location.start.character).to.eq(48);
        expect(diag.message).to.eq(`expected ';' after expression`);
        expect(diag.severity).to.eq('error');
    });

    test('Parsing fatal error diagnostics', () => {
        const lines = ['/some/path/here:4:26: fatal error: some_header.h: No such file or directory'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];
        expect(diag.location.start.line).to.eq(3);
        expect(diag.message).to.eq('some_header.h: No such file or directory');
        expect(diag.location.start.line).to.eq(3);
        expect(diag.location.start.character).to.eq(25);
        expect(diag.file).to.eq('/some/path/here');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });

    test('Parsing warning diagnostics', () => {
        const lines = ['/some/path/here:4:26: warning: unused parameter \'data\''];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(3);
        expect(diag.message).to.eq('unused parameter \'data\'');
        expect(diag.location.start.character).to.eq(25);
        expect(diag.file).to.eq('/some/path/here');
        expect(diag.severity).to.eq('warning');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing warning diagnostics 2', () => {
        const lines = [`/test/main.cpp:21:14: warning: unused parameter ‘v’ [-Wunused-parameter]`];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(20);
        expect(diag.location.start.character).to.eq(13);
        expect(diag.file).to.eq('/test/main.cpp');
        expect(diag.message).to.eq(`unused parameter ‘v’ [-Wunused-parameter]`);
        expect(diag.severity).to.eq('warning');
    });
    test('Parsing non-diagnostic', async () => {
        const lines = ['/usr/include/c++/10/bits/stl_vector.h:98:47: optimized: basic block part vectorized using 32 byte vectors'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const resolved = await build_consumer.resolveDiagnostics('dummyPath');
        expect(resolved.length).to.eq(0);
    });
    test('Parsing linker error of type "/path/to/ld:path/to/file:line: severity: message"', () => {
        const lines = ['/path/to/ld:path/to/file:42: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld.exe:path/to/file:line: severity: message"', () => {
        const lines = ['/path/to/ld.exe:path/to/file:42: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld: path/to/file:line: severity: message"', () => {
        const lines = ['/path/to/ld: path/to/file:42: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld.exe: path/to/file:line: severity: message"', () => {
        const lines = ['/path/to/ld.exe: path/to/file:42: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld:path/to/file:line: message"', () => {
        const lines = ['/path/to/ld:path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld.exe:path/to/file:line: message"', () => {
        const lines = ['/path/to/ld.exe:path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld: path/to/file.obj:path/to/file:line: message"', () => {
        const lines = ['/path/to/ld: path/to/file.obj:path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld.exe: path/to/file.obj:path/to/file:line: message"', () => {
        const lines = ['/path/to/ld.exe: path/to/file.obj:path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld: path/to/file:line: message"', () => {
        const lines = ['/path/to/ld: path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld.exe: path/to/file:line: message"', () => {
        const lines = ['/path/to/ld.exe: path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.false;
    });
    test('Parsing linker error of type "/path/to/ld: severity: message"', () => {
        const lines = ['/path/to/ld: error: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/ld');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing linker error of type "/path/to/ld.exe: severity: message"', () => {
        const lines = ['/path/to/ld.exe: warning: some message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('some message');
        expect(diag.file).to.eq('/path/to/ld.exe');
        expect(diag.severity).to.eq('warning');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing linker error of type "/path/to/ld: message (without trailing colon)"', () => {
        const lines = ['/path/to/ld: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/ld');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing linker error of type "/path/to/ld.exe: message (without trailing colon)"', () => {
        const lines = ['/path/to/ld.exe: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/ld.exe');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing linker error of type "/path/to/file:line: message (without "[fatal] severity:" or trailing colon)"', () => {
        const lines = ['/path/to/file:42: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gnuld.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/file');
        expect(diag.severity).to.eq('error');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing gcc error of type "/path/to/file:line:column: severity: message"', () => {
        const lines = ['/path/to/file:42:24: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(23);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/file');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing gcc error of type "/path/to/file:line: severity: message"', () => {
        const lines = ['/path/to/file:42: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(41);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/file');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing gcc error of type "/path/to/cc1: severity: message"', () => {
        const lines = ['/path/to/cc1: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/cc1');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing gcc error of type "/path/to/cc1.exe: severity: message"', () => {
        const lines = ['/path/to/cc1.exe: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/cc1.exe');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing gcc error of type "/path/to/arm-none-eabi-gcc: severity: message"', () => {
        const lines = ['/path/to/arm-none-eabi-gcc: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/arm-none-eabi-gcc');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing gcc error of type "/path/to/arm-none-eabi-gcc.exe: severity: message"', () => {
        const lines = ['/path/to/arm-none-eabi-gcc.exe: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.gcc.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('message');
        expect(diag.file).to.eq('/path/to/arm-none-eabi-gcc.exe');
        expect(diag.severity).to.eq('severity');
        expect(path.posix.normalize(diag.file)).to.eq(diag.file);
        expect(path.posix.isAbsolute(diag.file)).to.be.true;
    });
    test('Parse GCC error on line zero', () => {
        const lines = ['/foo.h:66:0: warning: ignoring #pragma comment [-Wunknown-pragmas]'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
        expect(build_consumer.compilers.gcc.diagnostics[0].file).to.eq('/foo.h');
        expect(build_consumer.compilers.gcc.diagnostics[0].location.start.line).to.eq(65);
        expect(build_consumer.compilers.gcc.diagnostics[0].location.start.character).to.eq(0);
    });
    test('No gcc and linker error on "/path/to/ld: message:" (trailing colon)', () => {
        const lines = ['/path/to/ld: message:'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(0);
    });
    test('No gcc and linker error on "/path/to/ld.exe: message:" (trailing colon)', () => {
        const lines = ['/path/to/ld.exe: message:'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(0);
    });
    test('No gcc and linker error on "/path/to/file:line:column severity: message" (missing colon after column)', () => {
        const lines = ['path/to/file:42:24 severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(0);
    });
    test('No gcc and linker error on "/path/to/file:line severity: message" (missing colon after line)', () => {
        const lines = ['path/to/file:42 severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(0);
    });
    test('No linker error on "/path/to/file:line: severity: message" ("severity:" is gcc diagnostic)', () => {
        const lines = ['/path/to/file:42: severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
    });
    test('No linker error on "/path/to/file:line: fatal severity: message" ("fatal severity:" is gcc diagnostic)', () => {
        const lines = ['/path/to/file:42: fatal severity: message'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);
    });
    test('No gcc and linker error on "/path/to/file:line: message:" (trailing colon)', () => {
        const lines = ['/path/to/file:42: message:'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
    });
    test('Parsing GHS Diagnostics', () => {
        const lines = [
            '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): warning #68-D: integer conversion resulted in a change of sign'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.ghs.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.ghs.diagnostics[0];

        expect(diag.location.start.line).to.eq(630);
        expect(diag.message).to.eq('#68-D: integer conversion resulted in a change of sign');
        expect(diag.location.start.character).to.eq(2);
        expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
        expect(diag.severity).to.eq('warning');
        expect(path.win32.normalize(diag.file)).to.eq(diag.file);
        expect(path.win32.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing GHS Diagnostics At end of source', () => {
        const lines = [
            '"C:\\path\\source\\debug\\debug.c", At end of source: remark #96-D: a translation unit must contain at least one declaration'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.ghs.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.ghs.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.message).to.eq('#96-D: a translation unit must contain at least one declaration');
        expect(diag.location.start.character).to.eq(0);
        expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
        expect(diag.severity).to.eq('remark');
        expect(path.win32.normalize(diag.file)).to.eq(diag.file);
        expect(path.win32.isAbsolute(diag.file)).to.be.true;
    });
    test('Parsing GHS Diagnostics fatal error', () => {
        const lines = ['"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): fatal error #68: some fatal error'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.ghs.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.ghs.diagnostics[0];
        expect(diag.location.start.line).to.eq(630);
        expect(diag.message).to.eq('#68: some fatal error');
        expect(diag.location.start.character).to.eq(2);
        expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
        expect(diag.severity).to.eq('error');
        expect(path.win32.normalize(diag.file)).to.eq(diag.file);
        expect(path.win32.isAbsolute(diag.file)).to.be.true;
    });

    test('Parsing DIAB Diagnostics', () => {
        const lines = [
            '"C:\\path\\source\\debug\\debug.c", line 631: warning (dcc:1518): variable i is never used'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.diab.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.diab.diagnostics[0];

        expect(diag.location.start.line).to.eq(630);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('variable i is never used');
        expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
        expect(diag.code).to.eq('dcc:1518');
        expect(diag.severity).to.eq('warning');
        expect(path.win32.normalize(diag.file)).to.eq(diag.file);
        expect(path.win32.isAbsolute(diag.file)).to.be.true;
    });

    test('Parsing DIAB Diagnostics catastrophic error', () => {
        const lines = [
            '"C:\\path\\source\\debug\\debug.c", line 631: catastrophic error (etoa:5711): cannot open source file "../debug.h"'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.diab.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.diab.diagnostics[0];

        expect(diag.location.start.line).to.eq(630);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('cannot open source file "../debug.h"');
        expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
        expect(diag.code).to.eq('etoa:5711');
        expect(diag.severity).to.eq('catastrophic error');
        expect(path.win32.normalize(diag.file)).to.eq(diag.file);
        expect(path.win32.isAbsolute(diag.file)).to.be.true;
    });

    test('Parsing DIAB Diagnostics fatal error without line number', () => {
        const lines = [
            '"C:\\path\\source\\debug\\debug.c", fatal error (etoa:1635): License error: FLEXlm error: License server machine is down or not responding.'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.diab.diagnostics).to.have.length(1);
        const diag = build_consumer.compilers.diab.diagnostics[0];

        expect(diag.location.start.line).to.eq(0);
        expect(diag.location.start.character).to.eq(0);
        expect(diag.message).to.eq('License error: FLEXlm error: License server machine is down or not responding.');
        expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
        expect(diag.code).to.eq('etoa:1635');
        expect(diag.severity).to.eq('fatal error');
        expect(path.win32.normalize(diag.file)).to.eq(diag.file);
        expect(path.win32.isAbsolute(diag.file)).to.be.true;
    });

    test('No parsing Make errors', () => {
        const lines = [
            `make[2]: *** [CMakeFiles/myApp.dir/build.make:87: CMakeFiles/myApp.dir/app.cpp.o] Error 1`,
            `make[1]: *** [CMakeFiles/Makefile2:68: CMakeFiles/myApp.dir/all] Error 2`,
            `make: *** [Makefile:84 all] Error 2`
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(0);
        expect(build_consumer.compilers.gnuld.diagnostics).to.have.length(0);
    });

    test('Parse MSVC single proc error', () => {
        const lines = [`C:\\foo\\bar\\include\\bar.hpp(67): error C2429: language feature 'init-statements in if/switch' requires compiler flag '/std:c++latest'`];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.msvc.diagnostics).to.have.length(1);
        expect(build_consumer.compilers.msvc.diagnostics[0].file).to.eq('C:\\foo\\bar\\include\\bar.hpp');
        expect(build_consumer.compilers.msvc.diagnostics[0].location.start.line).to.eq(66);
        expect(build_consumer.compilers.msvc.diagnostics[0].location.start.character).to.eq(0);
    });

    test('Parse MSVC single proc error (older compiler)', () => {
        const lines = [`E:\\CI-Cor-Ready\\study\\reproc\\reproc\\src\\strv.c(13) : error C2143: syntax error : missing ';' before 'type'`];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.msvc.diagnostics).to.have.length(1);
        expect(build_consumer.compilers.msvc.diagnostics[0].file).to.eq('E:\\CI-Cor-Ready\\study\\reproc\\reproc\\src\\strv.c');
        expect(build_consumer.compilers.msvc.diagnostics[0].location.start.line).to.eq(12);
        expect(build_consumer.compilers.msvc.diagnostics[0].location.start.character).to.eq(0);
    });

    test('Parse MSVC multi proc error', () => {
        const lines = [`12>C:\\foo\\bar\\include\\bar.hpp(67): error C2429: language feature 'init-statements in if/switch' requires compiler flag '/std:c++latest'`];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.msvc.diagnostics).to.have.length(1);
        expect(build_consumer.compilers.msvc.diagnostics[0].file).to.eq('C:\\foo\\bar\\include\\bar.hpp');
        expect(build_consumer.compilers.msvc.diagnostics[0].location.start.line).to.eq(66);
        expect(build_consumer.compilers.msvc.diagnostics[0].location.start.character).to.eq(0);
    });

    interface LinkerTestCase {
        line: string;
        expectedFile: string;
        expectedCode: string;
        expectedSeverity: string;
        expectedMessageContains: string;
    }

    const msvcLinkerTestCases: LinkerTestCase[] = [
        // Fatal error: cannot open input file
        {
            line: 'LINK : fatal error LNK1181: cannot open input file "non_existent_file.obj"',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK1181',
            expectedSeverity: 'fatal error',
            expectedMessageContains: 'cannot open input file'
        },
        // Unresolved external symbol with build prefix
        {
            line: '[build] Validation_TCM_SURFACE_BASED.cpp.obj : error LNK2019: unresolved external symbol "class ParameterValidationException __cdecl mw::Toolpath::MakeException_35521(void)" (?MakeException_35521@Toolpath@mw@@YA?AVParameterValidationException@@XZ) referenced in function "class std::vector<class misc::mwException,class std::allocator<class misc::mwException> > __cdecl mw::Toolpath::Validate_TCM_SURFACE_BASED(class mw::Toolpath::CalculationParams const &,class misc::mwAutoPointer<class cadcam::mwTool> const &,bool)" (?Validate_TCM_SURFACE_BASED@Toolpath@mw@@YA?AV?$vector@VmwException@misc@@V?$allocator@VmwException@misc@@@std@@@std@@AEBVCalculationParams@12@AEBV?$mwAutoPointer@VmwTool@cadcam@@@misc@@_N@Z)',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2019',
            expectedSeverity: 'error',
            expectedMessageContains: 'unresolved external symbol'
        },
        // Simple unresolved external symbol
        {
            line: 'main.obj : error LNK2001: unresolved external symbol _foo',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: 'unresolved external symbol _foo'
        },
        // Unresolved external with decorated name
        {
            line: 'utils.obj : error LNK2019: unresolved external symbol "void __cdecl bar(void)" referenced in function main',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2019',
            expectedSeverity: 'error',
            expectedMessageContains: 'unresolved external symbol'
        },
        // Library object reference
        {
            line: 'libmath.lib(math.obj) : error LNK2001: unresolved external symbol _sin',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: 'unresolved external symbol _sin'
        },
        // Warning: PDB not found
        {
            line: 'module.obj : warning LNK4099: PDB \'vc142.pdb\' was not found with \'module.obj\'',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK4099',
            expectedSeverity: 'warning',
            expectedMessageContains: 'PDB'
        },
        // Warning: locally defined symbol imported
        {
            line: 'lib.lib(other.obj) : warning LNK4049: locally defined symbol _baz imported',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK4049',
            expectedSeverity: 'warning',
            expectedMessageContains: 'locally defined symbol'
        },
        // Fatal error: cannot open file
        {
            line: 'fatal error LNK1104: cannot open file \'kernel32.lib\'',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK1104',
            expectedSeverity: 'fatal error',
            expectedMessageContains: 'cannot open file'
        },
        // Fatal error: PDB error
        {
            line: 'fatal error LNK1318: Unexpected PDB error; OK (0)',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK1318',
            expectedSeverity: 'fatal error',
            expectedMessageContains: 'Unexpected PDB error'
        },
        // Absolute path
        {
            line: 'C:\\projects\\demo\\main.obj : error LNK2019: unresolved external symbol _printf referenced in function main',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2019',
            expectedSeverity: 'error',
            expectedMessageContains: '_printf'
        },
        // Build directory path
        {
            line: 'D:\\build\\lib\\foo.lib(bar.obj) : error LNK2001: unresolved external symbol _bar',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: '_bar'
        },
        // Complex decorated name
        {
            line: 'utils.obj : error LNK2019: unresolved external symbol "int __cdecl add(int,int)" (?add@@YAHHH@Z) referenced in function main',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2019',
            expectedSeverity: 'error',
            expectedMessageContains: 'add'
        },
        // Error summary
        {
            line: 'error LNK1120: 1 unresolved externals',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK1120',
            expectedSeverity: 'error',
            expectedMessageContains: 'unresolved externals'
        },
        // Multiple definitions error
        {
            line: 'error LNK1169: one or more multiply defined symbols found',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK1169',
            expectedSeverity: 'error',
            expectedMessageContains: 'multiply defined'
        },
        // Colon variant (no space after obj)
        {
            line: 'main.obj: error LNK2001: unresolved external symbol _foo',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: '_foo'
        },
        // Library object with colon
        {
            line: 'lib.lib(obj.obj):error LNK2019: unresolved external symbol _bar',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2019',
            expectedSeverity: 'error',
            expectedMessageContains: '_bar'
        },
        // Destructor
        {
            line: 'file.obj : error LNK2019: unresolved external symbol "public: __cdecl MyClass::~MyClass(void)" (??1MyClass@@QEAA@XZ) referenced in function main',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2019',
            expectedSeverity: 'error',
            expectedMessageContains: 'MyClass'
        },
        // Template instantiation
        {
            line: 'tmpl.obj : error LNK2001: unresolved external symbol "class std::vector<int,class std::allocator<int> > __cdecl getVec(void)"',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: 'vector'
        },
        // Path with spaces
        {
            line: 'C:\\Program Files\\My Project\\main.obj : error LNK2001: unresolved external symbol _foo',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: '_foo'
        },
        // Entry point error
        {
            line: 'LINK : error LNK2001: unresolved external symbol _WinMain@16',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK2001',
            expectedSeverity: 'error',
            expectedMessageContains: 'WinMain'
        },
        // Entry point must be defined
        {
            line: 'LINK : fatal error LNK1561: entry point must be defined',
            expectedFile: 'linkerrors.txt',
            expectedCode: 'LNK1561',
            expectedSeverity: 'fatal error',
            expectedMessageContains: 'entry point'
        }
    ];

    // Generate individual tests for each linker error case
    msvcLinkerTestCases.forEach((testCase, index) => {
        test(`Parse MSVC Linker errors - Case ${index + 1}: ${testCase.expectedCode}`, () => {
            const test_consumer = new diags.CompileOutputConsumer(
                new ConfigurationReader({} as ExtensionConfigurationSettings)
            );
            feedLines(test_consumer, [], [testCase.line]);

            expect(
                test_consumer.compilers.msvc.diagnostics,
                `Failed to parse: ${testCase.line}`
            ).to.have.length(1);

            const diag = test_consumer.compilers.msvc.diagnostics[0];
            expect(diag.file, `File mismatch for: ${testCase.line}`).to.eq(
                testCase.expectedFile
            );
            expect(diag.code, `Code mismatch for: ${testCase.line}`).to.eq(
                testCase.expectedCode
            );
            expect(
                diag.severity,
                `Severity mismatch for: ${testCase.line}`
            ).to.eq(testCase.expectedSeverity);
            expect(
                diag.message,
                `Message mismatch for: ${testCase.line}`
            ).to.include(testCase.expectedMessageContains);
        });
    });

    test('Linker errors resolve to unique line numbers in linkerrors.txt', async () => {
        const test_consumer = new diags.CompileOutputConsumer(
            new ConfigurationReader({} as ExtensionConfigurationSettings)
        );
        test_consumer.config.updatePartial({ enabledOutputParsers: ['msvc'] });

        // Feed multiple linker errors
        const linkerErrorLines = [
            'main.obj : error LNK2019: unresolved external symbol _foo',
            'utils.obj : error LNK2019: unresolved external symbol _bar',
            'test.obj : error LNK2001: unresolved external symbol _baz'
        ];
        feedLines(test_consumer, [], linkerErrorLines);

        expect(test_consumer.compilers.msvc.diagnostics).to.have.length(3);

        // Resolve diagnostics (this should create linkerrors.txt and set line numbers)
        const tmpDir = path.join(__dirname, 'tmp_linker_test');
        await fs.promises.mkdir(tmpDir, { recursive: true });
        const resolved = await test_consumer.resolveDiagnostics(tmpDir);

        // All should point to linkerrors.txt
        expect(resolved.every(d => d.filepath.endsWith('linkerrors.txt'))).to.be.true;

        // Each should have a unique line number (not all pointing to the same line)
        const lineNumbers = resolved.map(d => d.diag.range.start.line);
        const uniqueLines = new Set(lineNumbers);

        expect(uniqueLines.size, 'All diagnostics should point to different lines').to.eq(3);

        // Line numbers should be sequential (each error takes 3 lines: header, message, blank)
        // Header is 6 lines, then each error starts at 7, 10, 13, etc.
        expect(lineNumbers[0]).to.eq(6); // Line 7 (0-indexed = 6)
        expect(lineNumbers[1]).to.eq(9); // Line 10 (0-indexed = 9)
        expect(lineNumbers[2]).to.eq(12); // Line 13 (0-indexed = 12)
    });

    test('Parse IAR error', () => {
        const lines = [
            '      kjfdlkj kfjg;',
            '      ^',
            '"C:\\foo\\bar\\bar.c",147  Error[Pe020]:',
            '          identifier "kjfdlkj" is undefined',
            'a'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.iar.diagnostics).to.have.length(1);
        const diagnostic = build_consumer.compilers.iar.diagnostics[0];

        expect(diagnostic.file).to.eq('C:\\foo\\bar\\bar.c');
        expect(diagnostic.location.start.line).to.eq(146);
        expect(diagnostic.location.start.character).to.eq(4);
        expect(diagnostic.code).to.eq('Pe020');
        expect(diagnostic.message).to.eq('identifier "kjfdlkj" is undefined');
        expect(diagnostic.severity).to.eq('error');
    });

    test('Parse IAR fatal error', () => {
        const lines = [
            '  #include <kjlkjl>',
            '                   ^',
            '"C:\\foo\\bar\\test.c",1  Fatal error[Pe1696]: cannot open source',
            '          file "kjlkjl"',
            '            searched: "C:\\Program Files (x86)\\IAR Systems\\Embedded Workbench',
            '                      8.0\\arm\\inc\\"',
            '            current directory: "C:\\Users\\user\\Documents"',
            'Fatal error detected, aborting.'
        ];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.iar.diagnostics).to.have.length(1);
        const diagnostic = build_consumer.compilers.iar.diagnostics[0];

        expect(diagnostic.file).to.eq('C:\\foo\\bar\\test.c');
        expect(diagnostic.location.start.line).to.eq(0);
        expect(diagnostic.location.start.character).to.eq(17);
        expect(diagnostic.code).to.eq('Pe1696');
        expect(diagnostic.message).to.eq('cannot open source file "kjlkjl"\nsearched: "C:\\Program Files (x86)\\IAR Systems\\Embedded Workbench\n8.0\\arm\\inc\\"\ncurrent directory: "C:\\Users\\user\\Documents"');
        expect(diagnostic.severity).to.eq('error');
    });

    test('Relative file resolution', async () => {
        const project_dir = getTestResourceFilePath('driver/workspace/test_project');
        build_consumer.config.updatePartial({ enabledOutputParsers: [ 'gcc' ] });

        const lines = ['main.cpp:42:42: error: test warning'];
        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.gcc.diagnostics).to.have.length(1);

        /* default behavior resolve in build-dir */
        let resolved = await build_consumer.resolveDiagnostics('dummyPath');
        expect(resolved.length).to.eq(1);
        let diagnostic = resolved[0];
        expect(diagnostic.filepath).to.eq('dummyPath/main.cpp');

        /* resolve first path where file exists (fallback on first argument) */
        resolved = await build_consumer.resolveDiagnostics('dummyPath', path.resolve(project_dir, 'build'), project_dir, 'dummyPath2');
        expect(resolved.length).to.eq(1);
        diagnostic = resolved[0];
        expect(diagnostic.filepath).to.eq(resolvePath('main.cpp', project_dir));
    });

    test('Parse IWYU', () => {
        const lines = [
            '/home/user/src/project/main.c should add these lines:',
            '#include <stdbool.h>           // for bool',
            '#include <stdint.h>            // for uint32_t, uint8_t',
            '',
            '/home/user/src/project/main.c should remove these lines:',
            '- #include <alloca.h>  // lines 24-24',
            '- #include <stdalign.h>  // lines 25-26',
            '',
            'The full include-list for /home/user/src/project/main.c:',
            '#include <stdbool.h>           // for bool',
            '#include <stdint.h>            // for uint32_t, uint8_t',
            '#include <stdio.h>             // for fprintf, FILE, printf, NULL, stdout',
            '#include "array.h"             // for ARRAY_SIZE',
            '---'
        ];

        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.iwyu.diagnostics).to.have.length(4);
        const [add, rem1, rem2, all] = build_consumer.compilers.iwyu.diagnostics;

        expect(add.file).to.eq('/home/user/src/project/main.c');
        expect(add.location.start.line).to.eq(0);
        expect(add.location.start.character).to.eq(0);
        expect(add.location.end.line).to.eq(0);
        expect(add.location.end.character).to.eq(999);
        expect(add.code).to.eq(undefined);
        expect(add.message).to.eq('should add these lines:\n#include <stdbool.h>           // for bool\n#include <stdint.h>            // for uint32_t, uint8_t');
        expect(add.severity).to.eq('warning');

        expect(rem1.file).to.eq('/home/user/src/project/main.c');
        expect(rem1.location.start.line).to.eq(23);
        expect(rem1.location.start.character).to.eq(0);
        expect(rem1.location.end.line).to.eq(23);
        expect(rem1.location.end.character).to.eq(999);
        expect(rem1.code).to.eq(undefined);
        expect(rem1.message).to.eq('should remove: #include <alloca.h>');
        expect(rem1.severity).to.eq('warning');

        expect(rem2.file).to.eq('/home/user/src/project/main.c');
        expect(rem2.location.start.line).to.eq(24);
        expect(rem2.location.start.character).to.eq(0);
        expect(rem2.location.end.line).to.eq(25);
        expect(rem2.location.end.character).to.eq(999);
        expect(rem2.code).to.eq(undefined);
        expect(rem2.message).to.eq('should remove: #include <stdalign.h>');
        expect(rem2.severity).to.eq('warning');

        expect(all.file).to.eq('/home/user/src/project/main.c');
        expect(all.location.start.line).to.eq(0);
        expect(all.location.start.character).to.eq(0);
        expect(all.location.end.line).to.eq(0);
        expect(all.location.end.character).to.eq(999);
        expect(all.code).to.eq(undefined);
        expect(all.message).to.eq('The full include-list:\n#include <stdbool.h>           // for bool\n#include <stdint.h>            // for uint32_t, uint8_t\n#include <stdio.h>             // for fprintf, FILE, printf, NULL, stdout\n#include "array.h"             // for ARRAY_SIZE');
        expect(all.severity).to.eq('note');
    });

    test('Parse IWYU with only additions', () => {
        const lines = [
            '/home/user/src/project/main.c should add these lines:',
            '#include <stdbool.h>           // for bool',
            '',
            '/home/user/src/project/main.c should remove these lines:',
            '',
            'The full include-list for /home/user/src/project/main.c:',
            '#include <stdbool.h>           // for bool',
            '#include "array.h"             // for ARRAY_SIZE',
            '---'
        ];

        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.iwyu.diagnostics).to.have.length(2);
        const [add, all] = build_consumer.compilers.iwyu.diagnostics;

        expect(add.file).to.eq('/home/user/src/project/main.c');
        expect(add.location.start.line).to.eq(0);
        expect(add.location.start.character).to.eq(0);
        expect(add.location.end.line).to.eq(0);
        expect(add.location.end.character).to.eq(999);
        expect(add.code).to.eq(undefined);
        expect(add.message).to.eq('should add these lines:\n#include <stdbool.h>           // for bool');
        expect(add.severity).to.eq('warning');

        expect(all.file).to.eq('/home/user/src/project/main.c');
        expect(all.location.start.line).to.eq(0);
        expect(all.location.start.character).to.eq(0);
        expect(all.location.end.line).to.eq(0);
        expect(all.location.end.character).to.eq(999);
        expect(all.code).to.eq(undefined);
        expect(all.message).to.eq('The full include-list:\n#include <stdbool.h>           // for bool\n#include "array.h"             // for ARRAY_SIZE');
        expect(all.severity).to.eq('note');
    });

    test('Parse IWYU with only removals', () => {
        const lines = [
            '/home/user/src/project/main.c should add these lines:',
            '',
            '/home/user/src/project/main.c should remove these lines:',
            '- #include <alloca.h>  // lines 24-24',
            '',
            'The full include-list for /home/user/src/project/main.c:',
            '#include "array.h"             // for ARRAY_SIZE',
            '---'
        ];

        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.iwyu.diagnostics).to.have.length(2);
        const [rem, all] = build_consumer.compilers.iwyu.diagnostics;

        expect(rem.file).to.eq('/home/user/src/project/main.c');
        expect(rem.location.start.line).to.eq(23);
        expect(rem.location.start.character).to.eq(0);
        expect(rem.location.end.line).to.eq(23);
        expect(rem.location.end.character).to.eq(999);
        expect(rem.code).to.eq(undefined);
        expect(rem.message).to.eq('should remove: #include <alloca.h>');
        expect(rem.severity).to.eq('warning');

        expect(all.file).to.eq('/home/user/src/project/main.c');
        expect(all.location.start.line).to.eq(0);
        expect(all.location.start.character).to.eq(0);
        expect(all.location.end.line).to.eq(0);
        expect(all.location.end.character).to.eq(999);
        expect(all.code).to.eq(undefined);
        expect(all.message).to.eq('The full include-list:\n#include "array.h"             // for ARRAY_SIZE');
        expect(all.severity).to.eq('note');
    });

    test('Parse IWYU with multiple files', () => {
        const lines = [
            '/home/user/src/project/main.c should add these lines:',
            '#include <stdbool.h>           // for bool',
            '',
            '/home/user/src/project/main.c should remove these lines:',
            '',
            'The full include-list for /home/user/src/project/main.c:',
            '#include <stdbool.h>           // for bool',
            '---',
            '/home/user/src/project/module.c should add these lines:',
            '',
            '/home/user/src/project/module.c should remove these lines:',
            '- #include <alloca.h>  // lines 24-24',
            '',
            'The full include-list for /home/user/src/project/module.c:',
            '#include "array.h"             // for ARRAY_SIZE',
            '---'
        ];

        feedLines(build_consumer, [], lines);
        expect(build_consumer.compilers.iwyu.diagnostics).to.have.length(4);
        const [add, all1, rem, all2] = build_consumer.compilers.iwyu.diagnostics;

        expect(add.file).to.eq('/home/user/src/project/main.c');
        expect(add.location.start.line).to.eq(0);
        expect(add.location.start.character).to.eq(0);
        expect(add.location.end.line).to.eq(0);
        expect(add.location.end.character).to.eq(999);
        expect(add.code).to.eq(undefined);
        expect(add.message).to.eq('should add these lines:\n#include <stdbool.h>           // for bool');
        expect(add.severity).to.eq('warning');

        expect(all1.file).to.eq('/home/user/src/project/main.c');
        expect(all1.location.start.line).to.eq(0);
        expect(all1.location.start.character).to.eq(0);
        expect(all1.location.end.line).to.eq(0);
        expect(all1.location.end.character).to.eq(999);
        expect(all1.code).to.eq(undefined);
        expect(all1.message).to.eq('The full include-list:\n#include <stdbool.h>           // for bool');
        expect(all1.severity).to.eq('note');

        expect(rem.file).to.eq('/home/user/src/project/module.c');
        expect(rem.location.start.line).to.eq(23);
        expect(rem.location.start.character).to.eq(0);
        expect(rem.location.end.line).to.eq(23);
        expect(rem.location.end.character).to.eq(999);
        expect(rem.code).to.eq(undefined);
        expect(rem.message).to.eq('should remove: #include <alloca.h>');
        expect(rem.severity).to.eq('warning');

        expect(all2.file).to.eq('/home/user/src/project/module.c');
        expect(all2.location.start.line).to.eq(0);
        expect(all2.location.start.character).to.eq(0);
        expect(all2.location.end.line).to.eq(0);
        expect(all2.location.end.character).to.eq(999);
        expect(all2.code).to.eq(undefined);
        expect(all2.message).to.eq('The full include-list:\n#include "array.h"             // for ARRAY_SIZE');
        expect(all2.severity).to.eq('note');
    });

    test('clearAll clears all diagnostic collections', () => {
        // Add some diagnostics to each collection
        const testUri = vscode.Uri.file('/test/file.cpp');
        const testDiagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 10),
            'Test diagnostic',
            vscode.DiagnosticSeverity.Error
        );

        // Populate the collections
        collections.cmake.set(testUri, [testDiagnostic]);
        collections.build.set(testUri, [testDiagnostic]);
        collections.presets.set(testUri, [testDiagnostic]);

        // Verify diagnostics were added
        expect(collections.cmake.has(testUri)).to.be.true;
        expect(collections.build.has(testUri)).to.be.true;
        expect(collections.presets.has(testUri)).to.be.true;

        // Clear all collections
        collections.clearAll();

        // Verify all collections are cleared
        expect(collections.cmake.has(testUri)).to.be.false;
        expect(collections.build.has(testUri)).to.be.false;
        expect(collections.presets.has(testUri)).to.be.false;
    });

    test('CMakeOutputConsumer logs stdout lines at trace level, not info', () => {
        const spy = new SpyLogger();
        const consumerWithLogger = new CMakeOutputConsumer('dummyPath', spy);
        consumerWithLogger.output('-- Configuring done');
        consumerWithLogger.output('-- Generating done');

        const traceCalls = spy.calls.filter(c => c.level === 'trace');
        const infoCalls = spy.calls.filter(c => c.level === 'info');
        expect(traceCalls.length).to.eq(2);
        expect(infoCalls.length).to.eq(0);
    });

    test('CMakeOutputConsumer logs stderr lines at warning level, not error', () => {
        const spy = new SpyLogger();
        const consumerWithLogger = new CMakeOutputConsumer('dummyPath', spy);
        consumerWithLogger.error('CMake Error at CMakeLists.txt:1 (message):');
        consumerWithLogger.error('  Something went wrong');

        const warningCalls = spy.calls.filter(c => c.level === 'warning');
        const errorCalls = spy.calls.filter(c => c.level === 'error');
        expect(warningCalls.length).to.eq(2);
        expect(errorCalls.length).to.eq(0);
    });

    test('CMakeOutputConsumer still parses diagnostics after log level change', () => {
        const spy = new SpyLogger();
        const consumerWithLogger = new CMakeOutputConsumer('dummyPath', spy);
        const error_output = [
            'CMake Warning at CMakeLists.txt:14 (message):',
            '  I am a warning!',
            '',
            ''
        ];
        for (const line of error_output) {
            consumerWithLogger.error(line);
        }
        // Diagnostics should still be parsed correctly regardless of log level
        expect(consumerWithLogger.diagnostics.length).to.eq(1);
        const diag = consumerWithLogger.diagnostics[0];
        expect(diag.filepath).to.eq('dummyPath/CMakeLists.txt');
        expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
        expect(diag.diag.message).to.match(/I am a warning!$/);
    });

    // ===== Custom Problem Matcher (cmake.additionalBuildProblemMatchers) tests =====

    test('CustomParser matches clang-tidy-style output', () => {
        const config: BuildProblemMatcherConfig = {
            name: 'clang-tidy',
            regexp: '^(.+?):(\\d+):(\\d+):\\s+(warning|error|note):\\s+(.+?)\\s*(?:\\[(.+)\\])?$',
            file: 1,
            line: 2,
            column: 3,
            severity: 4,
            message: 5,
            code: 6
        };
        const parser = new CustomParser(config);
        expect(parser.name).to.eq('clang-tidy');

        const handled = parser.handleLine('/path/to/file.cpp:10:5: warning: some check message [bugprone-some-check]');
        expect(handled).to.be.true;
        expect(parser.diagnostics).to.have.length(1);

        const diag = parser.diagnostics[0];
        expect(diag.file).to.eq('/path/to/file.cpp');
        expect(diag.location.start.line).to.eq(9); // 0-based
        expect(diag.location.start.character).to.eq(4); // 0-based
        expect(diag.severity).to.eq('warning');
        expect(diag.message).to.eq('some check message');
        expect(diag.code).to.eq('bugprone-some-check');
    });

    test('CustomParser matches PCLint-style output', () => {
        // PCLint Plus format: "file.cpp(42): error 1234: some lint message"
        const config: BuildProblemMatcherConfig = {
            name: 'pclint',
            regexp: '^(.+?)\\((\\d+)\\):\\s+(error|warning|info|note)\\s+(\\d+):\\s+(.+)$',
            file: 1,
            line: 2,
            severity: 3,
            code: 4,
            message: 5
        };
        const parser = new CustomParser(config);

        const handled = parser.handleLine('src/main.cpp(42): error 1234: some lint message');
        expect(handled).to.be.true;
        expect(parser.diagnostics).to.have.length(1);

        const diag = parser.diagnostics[0];
        expect(diag.file).to.eq('src/main.cpp');
        expect(diag.location.start.line).to.eq(41); // 0-based
        expect(diag.severity).to.eq('error');
        expect(diag.code).to.eq('1234');
        expect(diag.message).to.eq('some lint message');
    });

    test('CustomParser matches cppcheck-style output', () => {
        // cppcheck format: "[file.cpp:10]: (warning) message"
        const config: BuildProblemMatcherConfig = {
            name: 'cppcheck',
            regexp: '^\\[(.+?):(\\d+)\\]:\\s+\\((error|warning|style|performance|portability|information)\\)\\s+(.+)$',
            file: 1,
            line: 2,
            severity: 3,
            message: 4
        };
        const parser = new CustomParser(config);

        const handled = parser.handleLine('[src/utils.cpp:25]: (warning) Variable is not initialized');
        expect(handled).to.be.true;
        expect(parser.diagnostics).to.have.length(1);

        const diag = parser.diagnostics[0];
        expect(diag.file).to.eq('src/utils.cpp');
        expect(diag.location.start.line).to.eq(24);
        expect(diag.severity).to.eq('warning');
        expect(diag.message).to.eq('Variable is not initialized');
    });

    test('CustomParser with fixed severity string', () => {
        const config: BuildProblemMatcherConfig = {
            name: 'custom-linter',
            regexp: '^LINT:\\s+(.+?):(\\d+):\\s+(.+)$',
            file: 1,
            line: 2,
            severity: 'error',
            message: 3
        };
        const parser = new CustomParser(config);

        parser.handleLine('LINT: foo.cpp:7: bad style detected');
        expect(parser.diagnostics).to.have.length(1);

        const diag = parser.diagnostics[0];
        expect(diag.file).to.eq('foo.cpp');
        expect(diag.location.start.line).to.eq(6);
        expect(diag.severity).to.eq('error');
        expect(diag.message).to.eq('bad style detected');
    });

    test('CustomParser does not match unrelated lines', () => {
        const config: BuildProblemMatcherConfig = {
            name: 'simple',
            regexp: '^ERROR:\\s+(.+):(\\d+):\\s+(.+)$',
            file: 1,
            line: 2,
            message: 3
        };
        const parser = new CustomParser(config);

        const handled = parser.handleLine('All good, no errors here.');
        expect(handled).to.be.false;
        expect(parser.diagnostics).to.have.length(0);
    });

    test('CustomParser with invalid regex does not crash', () => {
        const config: BuildProblemMatcherConfig = {
            name: 'broken',
            regexp: '([invalid'  // Invalid regex
        };
        const parser = new CustomParser(config);

        // Should not throw and should not match anything
        const handled = parser.handleLine('some random line');
        expect(handled).to.be.false;
        expect(parser.diagnostics).to.have.length(0);
    });

    test('Custom parsers integrate with CompileOutputConsumer alongside built-in parsers', () => {
        const configSettings = {
            additionalBuildProblemMatchers: [
                {
                    name: 'my-tool',
                    regexp: '^>>MYTOOL>>\\s+(\\S+)\\|(\\d+)\\|(warning|error)\\|(.+)$',
                    file: 1,
                    line: 2,
                    severity: 3,
                    message: 4
                }
            ]
        } as unknown as ExtensionConfigurationSettings;
        const consumer = new diags.CompileOutputConsumer(new ConfigurationReader(configSettings));

        // Feed a GCC-style error (should be captured by built-in GCC parser)
        consumer.error('/home/user/src/main.cpp:15:3: error: undeclared identifier');
        // Feed a custom tool line (pipe-separated format that no built-in parser matches)
        consumer.error('>>MYTOOL>> /home/user/src/utils.cpp|20|warning|possible null dereference');

        // The GCC parser should have captured the first line
        expect(consumer.compilers.gcc.diagnostics).to.have.length(1);

        // The custom parser should have captured the second line
        expect(consumer.customParsers.has('my-tool')).to.be.true;
        const customDiags = consumer.customParsers.get('my-tool')!.diagnostics;
        expect(customDiags).to.have.length(1);
        expect(customDiags[0].file).to.eq('/home/user/src/utils.cpp');
        expect(customDiags[0].severity).to.eq('warning');
        expect(customDiags[0].message).to.eq('possible null dereference');
    });

    test('Built-in parsers take priority over custom parsers', () => {
        // Configure a custom parser that could also match GCC output
        const configSettings = {
            additionalBuildProblemMatchers: [
                {
                    name: 'greedy',
                    regexp: '^(.+?):(\\d+):(\\d+):\\s+(warning|error):\\s+(.+)$',
                    file: 1,
                    line: 2,
                    column: 3,
                    severity: 4,
                    message: 5
                }
            ]
        } as unknown as ExtensionConfigurationSettings;
        const consumer = new diags.CompileOutputConsumer(new ConfigurationReader(configSettings));

        // Feed a line that both GCC and the custom parser could match
        consumer.error('/home/user/src/main.cpp:15:3: error: undeclared identifier');

        // GCC should claim this line, NOT the custom parser
        expect(consumer.compilers.gcc.diagnostics).to.have.length(1);
        expect(consumer.customParsers.get('greedy')!.diagnostics).to.have.length(0);
    });
});
