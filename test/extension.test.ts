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

async function getExtension():
    Promise<CMakeTools> {
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

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", () => {
  // Defines a Mocha unit test
  test("Something 1",
       () => {
           // assert.equal(-1, [ 1, 2, 3 ].indexOf(5));
           // assert.equal(-1, [ 1, 2, 3 ].indexOf(0));
       });
});

suite('Kits test', async() => {
  const fakebin = path.join(vscode.workspace.rootPath !, '../fakebin');
  test('Detect system kits never throws',
       async() => {
         // Don't care about the result, just check that we don't throw during the test
         await expect(kit.scanForKits()).to.eventually.not.be.rejected;
       })
      // Compiler detection can run a little slow
      .timeout(10000);

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
  });

  // TODO: Do some tests with Visual Studio kits and vswhere
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

suite('CMake Diagnostics', async() => {
  let consumer = new diags.CMakeOutputConsumer();
  setup(() => { consumer = new diags.CMakeOutputConsumer(); });
  test('Waring-free output', async() => {
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
    expect(diag.filepath).to.eq(path.join(vscode.workspace.rootPath!, 'CMakeLists.txt'));
    expect(diag.diag.severity).to.eq(vscode.DiagnosticSeverity.Warning);
    expect(diag.diag.source).to.eq('CMake (message)');
    expect(diag.diag.message).to.eq('I am a warning!');
    expect(diag.diag.range.start.line).to.eq(13); // Line numbers are one-based
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
    const fullpath = path.join(vscode.workspace.rootPath!, 'CMakeLists.txt');
    expect(coll.has(vscode.Uri.file(fullpath))).to.be.true;
    expect(coll.get(vscode.Uri.file(fullpath))!.length).to.eq(2);
  });
});
