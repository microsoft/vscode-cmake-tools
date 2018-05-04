import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as diags from '../../src/diagnostics';
import {OutputConsumer} from '../../src/proc';

// tslint:disable:no-unused-expression

function feedLines(consumer: OutputConsumer, output: string[], error: string[]) {
  for (const line of output) {
    consumer.output(line);
  }
  for (const line of error) {
    consumer.error(line);
  }
}

suite('Diagnostics', async () => {
  let consumer = new diags.CMakeOutputConsumer('dummyPath');
  let build_consumer = new diags.CompileOutputConsumer();
  setup(() => {
    // FIXME: SETUP IS NOT BEING CALLED
    consumer = new diags.CMakeOutputConsumer('dummyPath');
    build_consumer = new diags.CompileOutputConsumer();
  });
  test('Waring-free CMake output', async () => {
    const cmake_output = [
      '-- Configuring done',
      '-- Generating done',
      '-- Build files have been written to /foo/bar',
    ];
    feedLines(consumer, cmake_output, []);
  });

  test('Parse a warning', () => {
    const error_output = [
      'CMake Warning at CMakeLists.txt:14 (message):',
      '  I am a warning!',
      '',
      '',
    ];
    feedLines(consumer, [], error_output);
    expect(consumer.diagnostics.length).to.eq(1);
    const diag = consumer.diagnostics[0];
    expect(diag.filepath).to.eq('dummyPath/CMakeLists.txt');
    expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
    expect(diag.diag.source).to.eq('CMake (message)');
    expect(diag.diag.message).to.eq('I am a warning!');
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
      '-- Extra suff',
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
    expect(warning.diag.message).to.eq('I am a warning!');
    expect(error.diag.message).to.eq('I am an error!');
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
      '-- Generating done',
    ];
    feedLines(consumer, [], error_output);
    expect(consumer.diagnostics.length).to.eq(1);
    const warning = consumer.diagnostics[0];
    expect(warning.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
    expect(warning.diag.message).to.eq('I\'m an inner warning');
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
      '-- Generating done',
    ];
    feedLines(consumer, [], error_output);
    expect(consumer.diagnostics.length).to.eq(1);
    const warning = consumer.diagnostics[0];
    expect(warning.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
    expect(warning.diag.message).to.eq('I\'m an inner warning');
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
      '-- Extra suff',
    ];
    feedLines(consumer, [], error_output);
    expect(consumer.diagnostics.length).to.eq(2);
    const coll = vscode.languages.createDiagnosticCollection('cmake-tools-test');
    diags.populateCollection(coll, consumer.diagnostics);
    const fullpath = 'dummyPath/CMakeLists.txt';
    expect(coll.has(vscode.Uri.file(fullpath))).to.be.true;
    expect(coll.get(vscode.Uri.file(fullpath))!.length).to.eq(2);
  });

  test('Parsing Apple Clang Diagnostics', () => {
    const lines = [
      '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h:85:15: warning: comparison of unsigned expression >= 0 is always true [-Wtautological-compare]'
    ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];
    expect(diag.location.start.line).to.eq(84);
    expect(diag.message).to.eq('comparison of unsigned expression >= 0 is always true [-Wtautological-compare]');
    expect(diag.location.start.character).to.eq(14);
    expect(diag.file).to.eq('/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h');
    expect(diag.severity).to.eq('warning');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });

  test('Parse more GCC diagnostics', () => {
    const lines = [`/Users/Tobias/Code/QUIT/Source/qidespot1.cpp:303:49: error: expected ';' after expression`];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];
    expect(diag.file).to.eq('/Users/Tobias/Code/QUIT/Source/qidespot1.cpp');
    expect(diag.location.start.line).to.eq(302);
    expect(diag.location.start.character).to.eq(48);
    expect(diag.message).to.eq(`expected ';' after expression`);
    expect(diag.severity).to.eq('error');
  });

  test('Parsing fatal error diagnostics', () => {
    const lines = ['/some/path/here:4:26: fatal error: some_header.h: No such file or directory'];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];
    expect(diag.location.start.line).to.eq(3);
    expect(diag.message).to.eq('some_header.h: No such file or directory');
    expect(diag.location.start.line).to.eq(3);
    expect(diag.location.start.character).to.eq(25);
    expect(diag.file).to.eq('/some/path/here');
    expect(diag.severity).to.eq('error');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });

  test('Parsing fatal error diagnostics in french', () => {
    const lines = ['/home/romain/TL/test/base.c:2:21: erreur fatale : bonjour.h : Aucun fichier ou dossier de ce type'];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];

    expect(diag.location.start.line).to.eq(1);
    expect(diag.message).to.eq('bonjour.h : Aucun fichier ou dossier de ce type');
    expect(diag.location.start.character).to.eq(20);
    expect(diag.file).to.eq('/home/romain/TL/test/base.c');
    expect(diag.severity).to.eq('erreur');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });
  test('Parsing warning diagnostics', () => {
    const lines = ['/some/path/here:4:26: warning: unused parameter \'data\''];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];

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
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];

    expect(diag.location.start.line).to.eq(20);
    expect(diag.location.start.character).to.eq(13);
    expect(diag.file).to.eq('/test/main.cpp');
    expect(diag.message).to.eq(`unused parameter ‘v’ [-Wunused-parameter]`);
    expect(diag.severity).to.eq('warning');
  });
  test('Parsing warning diagnostics in french', () => {
    const lines = ['/home/romain/TL/test/base.c:155:2: attention : déclaration implicite de la fonction ‘create’'];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];

    expect(diag.location.start.line).to.eq(154);
    expect(diag.message).to.eq('déclaration implicite de la fonction ‘create’');
    expect(diag.location.start.character).to.eq(1);
    expect(diag.file).to.eq('/home/romain/TL/test/base.c');
    expect(diag.severity).to.eq('attention');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });
  test('Parsing linker error', () => {
    const lines = ['/some/path/here:101: undefined reference to `some_function\''];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gnuLDDiagnostics).to.have.length(1);
    const diag = build_consumer.gnuLDDiagnostics[0];

    expect(diag.location.start.line).to.eq(100);
    expect(diag.message).to.eq('undefined reference to `some_function\'');
    expect(diag.file).to.eq('/some/path/here');
    expect(diag.severity).to.eq('error');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });
  test('Parsing linker error in french', () => {
    const lines = ['/home/romain/TL/test/test_fa_tp4.c:9 : référence indéfinie vers « create_automaton_product56 »'];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gnuLDDiagnostics).to.have.length(1);
    const diag = build_consumer.gnuLDDiagnostics[0];

    expect(diag.location.start.line).to.eq(8);
    expect(diag.message).to.eq('référence indéfinie vers « create_automaton_product56 »');
    expect(diag.file).to.eq('/home/romain/TL/test/test_fa_tp4.c');
    expect(diag.severity).to.eq('error');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });
  test('Parsing GHS Diagnostics', () => {
    const lines = [
      '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): warning #68-D: integer conversion resulted in a change of sign'
    ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.ghsDiagnostics).to.have.length(1);
    const diag = build_consumer.ghsDiagnostics[0];

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
    expect(build_consumer.ghsDiagnostics).to.have.length(1);
    const diag = build_consumer.ghsDiagnostics[0];

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
    expect(build_consumer.ghsDiagnostics).to.have.length(1);
    const diag = build_consumer.ghsDiagnostics[0];
    expect(diag.location.start.line).to.eq(630);
    expect(diag.message).to.eq('#68: some fatal error');
    expect(diag.location.start.character).to.eq(2);
    expect(diag.file).to.eq('C:\\path\\source\\debug\\debug.c');
    expect(diag.severity).to.eq('error');
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
    expect(build_consumer.gnuLDDiagnostics).to.have.length(0);
  });

  test('Parse GCC error on line zero', () => {
    const lines = [
      '/foo.h:66:0: warning: ignoring #pragma comment [-Wunknown-pragmas]'
    ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    expect(build_consumer.gccDiagnostics[0].file).to.eq('/foo.h');
    expect(build_consumer.gccDiagnostics[0].location.start.line).to.eq(65);
    expect(build_consumer.gccDiagnostics[0].location.start.character).to.eq(0);
  });
});