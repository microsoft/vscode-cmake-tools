/* eslint-disable no-unused-expressions */
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import { expect } from 'chai';
import * as diags from '@cmt/diagnostics/build';
import { OutputConsumer } from '../../src/proc';
import { ExtensionConfigurationSettings, ConfigurationReader } from '../../src/config';
import { platformPathEquivalent, resolvePath } from '@cmt/util';
import { CMakeOutputConsumer } from '@cmt/diagnostics/cmake';
import { populateCollection } from '@cmt/diagnostics/util';
import { getTestResourceFilePath } from '@test/util';

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
        expect(diag.diag.message).to.endsWith('I am a warning!');
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
        expect(diag.diag.message).to.endsWith('I am deprecated!');
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
        expect(warning.diag.message).to.endsWith('I am a warning!');
        expect(error.diag.message).to.endsWith('I am an error!');
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
        expect(warning.diag.message).to.endsWith('I\'m an inner warning');
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
        expect(warning.diag.message).to.endsWith('I\'m an inner warning');
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
});
