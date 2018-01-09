//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

import * as path from 'path';

import * as vscode from 'vscode';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {expect} from 'chai';

import * as state from '../src/state';
import * as kit from '../src/kit';
import * as api from '../src/api';
import * as util from '../src/util';
import {CMakeTools} from '../src/cmake-tools';
import {CMakeCache} from '../src/cache';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
// import * as myExtension from '../src/extension';

async function getExtension() {
  const cmt = vscode.extensions.getExtension<CMakeTools>('vector-of-bool.cmake-tools');
  if (!cmt) {
    return Promise.reject("Extension doesn't exist");
  }
  return cmt.isActive ? Promise.resolve(cmt.exports) : cmt.activate();
}

const here
    = __dirname;

function testFilePath(filename: string): string {
  return path.normalize(path.join(here, '../..', 'test', filename));
}

suite('Kits test', () => {
  const fakebin = testFilePath('fakebin');
  test('Detect system kits never throws',
       async() => {
         // Don't care about the result, just check that we don't throw during the test
         await expect(kit.scanForKits()).to.eventually.not.be.rejected;
       })
      // Compiler detection can run a little slow
      .timeout(12000);

  test('Detect a GCC compiler file', async() => {
    const compiler = path.join(fakebin, 'gcc-42.1');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit !.compilers).has.property('C').equal(compiler);
    expect(compkit !.compilers).to.not.have.property('CXX');
    expect(compkit !.name).to.eq('GCC 42.1');
  });

  test('Detect a Clang compiler file', async() => {
    const compiler = path.join(fakebin, 'clang-0.25');
    const compkit = await kit.kitIfCompiler(compiler);
    expect(compkit).to.not.be.null;
    expect(compkit !.compilers).has.property('C').eq(compiler);
    expect(compkit !.compilers).to.not.have.property('CXX');
    expect(compkit !.name).to.eq('Clang 0.25');
  });

  test('Detect non-compiler program', async() => {
    const program = path.join(fakebin, 'gcc-666');
    const nil = await kit.kitIfCompiler(program);
    expect(nil).to.be.null;
  });

  test('Scan dir for kits', async() => {
    // Scan the directory with fake compilers in it
    const kits = await kit.scanDirForCompilerKits(fakebin);
    expect(kits.length).to.eq(2);
  });

  test('KitManager tests', async() => {
    const cmt = await getExtension();
    const sm = new state.StateManager(cmt.extensionContext);
    const km = new kit.KitManager(sm);
    await km.initialize();
    const editor = await km.openKitsEditor();
    // Ensure it is the active editor
    await vscode.window.showTextDocument(editor.document);
    // Now close it. We don't care about it any more
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    // Check that each time we change the kit, it fires a signal
    let fired_kit: string | null = null;
    km.onActiveKitChanged(k => fired_kit = k !.name);
    for (const kit of km.kits) {
      const name = kit.name;
      // Set the kit
      await km.selectKitByName(name);
      // Check that we got the signal
      expect(fired_kit).to.eq(name);
      // Check that we've saved our change
      expect(sm.activeKitName).to.eq(name);
    }
    km.dispose();
  }).timeout(10000);

  test('KitManager test load of kit from test file', async() => {
    let stateMock =  sinon.createStubInstance(state.StateManager);
    sinon.stub(stateMock, 'activeKitName').get(function () {
      return null;
    }).set(function() {});
    const km = new kit.KitManager(stateMock, testFilePath('test_kit.json'));

    await km.initialize();

    expect( km.kits.length).to.eq(6);
    expect( km.kits[0].name).to.eq( "CompilerKit 1");
    expect( km.kits[1].name).to.eq( "CompilerKit 2");
    expect( km.kits[2].name).to.eq( "CompilerKit 3 with PreferedGenerator");
    expect( km.kits[3].name).to.eq( "ToolchainKit 1");
    expect( km.kits[4].name).to.eq( "VSCode Kit 1");
    expect( km.kits[5].name).to.eq( "VSCode Kit 2");

    km.dispose();
  });

  test('KitManager test selection of last activated kit', async() => {
    let stateMock =  sinon.createStubInstance(state.StateManager);

    sinon.stub(stateMock, 'activeKitName').get(function () {
      return "ToolchainKit 1";
    }).set(function() {});
    const km = new kit.KitManager(stateMock, testFilePath('test_kit.json'));

    await km.initialize();

    expect( km.activeKit).to.be.not.null;
    if( km.activeKit)
      expect( km.activeKit.name).to.eq( "ToolchainKit 1");

    km.dispose();
  });

  test('KitManager test selection of a default kit', async() => {
    let stateMock =  sinon.createStubInstance(state.StateManager);
    let storedActivatedKitName : string = "";
    sinon.stub(stateMock, 'activeKitName').get(function () {
      return null;
    }).set(function(kit) {
      storedActivatedKitName = kit;
    });

    const km = new kit.KitManager(stateMock, testFilePath('test_kit.json'));
    await km.initialize();

    expect( km.activeKit).to.be.null;
    km.dispose();
  });

  test('KitManager test selection of default kit if last activated kit is invalid', async() => {
    let stateMock =  sinon.createStubInstance(state.StateManager);
    let storedActivatedKitName = "not replaced";
    sinon.stub(stateMock, 'activeKitName').get(function () {
      return "Unknown";
    }).set(function(kit) {
      storedActivatedKitName = kit;
    });

    const km = new kit.KitManager(stateMock, testFilePath('test_kit.json'));
    await km.initialize();

    expect( km.activeKit).to.be.null;
    expect( storedActivatedKitName).to.be.null;
    km.dispose();
  });
});

suite('Cache test', async() => {
  test("Read CMake Cache", async function() {
    const cache = await CMakeCache.fromPath(testFilePath('TestCMakeCache.txt'));
    const generator = cache.get("CMAKE_GENERATOR") as api.CacheEntry;
    expect(generator.type).to.eq(api.CacheEntryType.Internal);
    expect(generator.key).to.eq('CMAKE_GENERATOR');
    expect(generator.as<string>()).to.eq('Ninja');
    expect(typeof generator.value).to.eq('string');

    const build_testing = await cache.get('BUILD_TESTING') as api.CacheEntry;
    expect(build_testing.type).to.eq(api.CacheEntryType.Bool);
    expect(build_testing.as<boolean>()).to.be.true;
  });
  test("Read cache with various newlines", async function() {
    for (const newline of['\n', '\r\n', '\r']) {
      const str =
          [ '# This line is ignored', '// This line is docs', 'SOMETHING:STRING=foo', '' ].join(
              newline);
      const entries = CMakeCache.parseCache(str);
      expect(entries.size).to.eq(1);
      expect(entries.has('SOMETHING')).to.be.true;
      const entry = entries.get('SOMETHING') !;
      expect(entry.value).to.eq('foo');
      expect(entry.type).to.eq(api.CacheEntryType.String);
      expect(entry.helpString).to.eq('This line is docs');
    }
  });
  test('Falsey values', () => {
    const false_things = [
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
    ];
    for (const thing of false_things) {
      expect(util.isTruthy(thing), 'Check false-iness of ' + thing).to.be.false;
    }
  });
  test('Truthy values', () => {
    const true_things = [ '1', 'ON', 'YES', 'Y', '112', 12, 'SOMETHING' ];
    for (const thing of true_things) {
      expect(util.isTruthy(thing), 'Check truthiness of ' + thing).to.be.true;
    }
  });
});


import * as diags from '../src/diagnostics';
import {OutputConsumer} from '../src/proc';

function feedLines(consumer: OutputConsumer, output: string[], error: string[]) {
  for (const line of output) {
    consumer.output(line);
  }
  for (const line of error) {
    consumer.error(line);
  }
}

suite('Diagnostics', async() => {
  let consumer = new diags.CMakeOutputConsumer("dummyPath");
  let build_consumer = new diags.CompileOutputConsumer();
  setup(() => {
    // FIXME: SETUP IS NOT BEING CALLED
    consumer = new diags.CMakeOutputConsumer("dummyPath");
    build_consumer = new diags.CompileOutputConsumer();
  });
  test('Waring-free CMake output', async() => {
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
    expect(warning.diag.message).to.eq("I'm an inner warning");
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
    expect(warning.diag.message).to.eq("I'm an inner warning");
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
    expect(coll.get(vscode.Uri.file(fullpath)) !.length).to.eq(2);
  });

  test('Parsing Apple Clang Diagnostics', () => {
    const lines = [
      '/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h:85:15: warning: comparison of unsigned expression >= 0 is always true [-Wtautological-compare]'
    ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];
    expect(diag.location.start.line).to.eq(84);
    expect(diag.message)
        .to.eq('comparison of unsigned expression >= 0 is always true [-Wtautological-compare]');
    expect(diag.location.start.character).to.eq(14);
    expect(diag.file).to.eq('/Users/ruslan.sorokin/Projects/Other/dpi/core/dpi_histogram.h');
    expect(diag.severity).to.eq('warning');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });

  test('Parse more GCC diagnostics', () => {
    const lines = [
      `/Users/Tobias/Code/QUIT/Source/qidespot1.cpp:303:49: error: expected ';' after expression`
    ];
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
    const lines = [ '/some/path/here:4:26: fatal error: some_header.h: No such file or directory' ];
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
    const lines = [
      '/home/romain/TL/test/base.c:2:21: erreur fatale : bonjour.h : Aucun fichier ou dossier de ce type'
    ];
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
    const lines = [ "/some/path/here:4:26: warning: unused parameter 'data'" ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gccDiagnostics).to.have.length(1);
    const diag = build_consumer.gccDiagnostics[0];

    expect(diag.location.start.line).to.eq(3);
    expect(diag.message).to.eq("unused parameter 'data'");
    expect(diag.location.start.character).to.eq(25);
    expect(diag.file).to.eq('/some/path/here');
    expect(diag.severity).to.eq('warning');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });
  test('Parsing warning diagnostics 2', () => {
    const lines = [ `/test/main.cpp:21:14: warning: unused parameter ‘v’ [-Wunused-parameter]` ];
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
    const lines = [
      '/home/romain/TL/test/base.c:155:2: attention : déclaration implicite de la fonction ‘create’'
    ];
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
    const lines = [ "/some/path/here:101: undefined reference to `some_function'" ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gnuLDDiagnostics).to.have.length(1);
    const diag = build_consumer.gnuLDDiagnostics[0];

    expect(diag.location.start.line).to.eq(100);
    expect(diag.message).to.eq("undefined reference to `some_function'");
    expect(diag.file).to.eq('/some/path/here');
    expect(diag.severity).to.eq('error');
    expect(path.posix.normalize(diag.file)).to.eq(diag.file);
    expect(path.posix.isAbsolute(diag.file)).to.be.true;
  });
  test('Parsing linker error in french', () => {
    const lines = [
      "/home/romain/TL/test/test_fa_tp4.c:9 : référence indéfinie vers « create_automaton_product56 »"
    ];
    feedLines(build_consumer, [], lines);
    expect(build_consumer.gnuLDDiagnostics).to.have.length(1);
    const diag = build_consumer.gnuLDDiagnostics[0];

    expect(diag.location.start.line).to.eq(8);
    expect(diag.message).to.eq("référence indéfinie vers « create_automaton_product56 »");
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
    const lines = [
      '"C:\\path\\source\\debug\\debug.c", line 631 (col. 3): fatal error #68: some fatal error'
    ];
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
});

import * as compdb from '../src/compdb';
import dirs from '../src/dirs';
import * as sinon from 'sinon';

suite('Compilation info', () => {
  test('Parsing compilation databases', async() => {
    const dbpath = testFilePath('test_compdb.json');
    const db = (await compdb.CompilationDatabase.fromFilePath(dbpath)) !;
    expect(db).to.not.be.null;
    const source_path = "/home/clang-languageservice/main.cpp";
    const info = db.getCompilationInfoForUri(vscode.Uri.file(source_path)) !;
    expect(info).to.not.be.null;
    expect(info.file).to.eq(source_path);
    expect(info.compile !.directory).to.eq('/home/clang-languageservice/build');
    expect(info.compile !.command)
        .to.eq(
            "/usr/local/bin/clang++   -DBOOST_THREAD_VERSION=3 -isystem ../extern/nlohmann-json/src  -g   -std=gnu++11 -o CMakeFiles/clang-languageservice.dir/main.cpp.o -c /home/clang-languageservice/main.cpp");
  });
  test('Parsing gnu-style compile info', () => {
    const raw: api.RawCompilationInfo = {
      command :
          'clang++ -I/foo/bar -isystem /system/path -fsome-compile-flag -DMACRO=DEFINITION -I ../relative/path "-I/path\\"with\\" embedded quotes/foo"',
      directory : '/some/dir',
      file : 'meow.cpp'
    };
    const info = compdb.parseRawCompilationInfo(raw);
    expect(raw.command).to.eq(info.compile !.command);
    expect(raw.directory).to.eq(info.compile !.directory);
    expect(raw.file).to.eq(info.file);
    let idx = info.includeDirectories.findIndex(i => i.path === '/system/path');
    expect(idx).to.be.gte(0);
    let inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.true;
    expect(inc.path).to.eq('/system/path');
    idx = info.includeDirectories.findIndex(i => i.path === '/some/relative/path');
    expect(idx).to.be.gte(0);
    inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.false;
    inc = info.includeDirectories[3];
    expect(inc.path).to.eq('/path"with" embedded quotes/foo');
    expect(info.compileDefinitions['MACRO']).to.eq('DEFINITION');
    expect(info.compileFlags[0]).to.eq('-fsome-compile-flag');
    expect(info.compiler).to.eq('clang++');
  });

  test('Parsing MSVC-style compile info', () => {
    const raw: api.RawCompilationInfo = {
      command :
          'cl.exe -I/foo/bar /I/system/path /Z+:some-compile-flag /DMACRO=DEFINITION -I ../relative/path "/I/path\\"with\\" embedded quotes/foo"',
      directory : '/some/dir',
      file : 'meow.cpp'
    };
    const info = compdb.parseRawCompilationInfo(raw);
    expect(raw.command).to.eq(info.compile !.command);
    expect(raw.directory).to.eq(info.compile !.directory);
    expect(raw.file).to.eq(info.file);
    let idx = info.includeDirectories.findIndex(i => i.path === '/system/path');
    expect(idx).to.be.gte(0);
    let inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.false;
    expect(inc.path).to.eq('/system/path');
    idx = info.includeDirectories.findIndex(i => i.path === '/some/relative/path');
    expect(idx).to.be.gte(0);
    inc = info.includeDirectories[idx];
    expect(inc.isSystem).to.be.false;
    inc = info.includeDirectories[3];
    expect(inc.path).to.eq('/path"with" embedded quotes/foo');
    expect(info.compileDefinitions['MACRO']).to.eq('DEFINITION');
    expect(info.compileFlags[0]).to.eq('/Z+:some-compile-flag');
    expect(info.compiler).to.eq('cl.exe');
  });
});
