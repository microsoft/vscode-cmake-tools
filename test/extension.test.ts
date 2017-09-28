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
import {CMakeTools} from '../src/cmake-tools';

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

  test('Create a kits manager', async() => {
    const cmt = await getExtension();
    const sm = new state.StateManager(cmt.extensionContext);
    const km = new kit.KitManager(sm);
    await km.initialize();
    const editor = await km.openKitsEditor();
    // Ensure it is the active editor
    await vscode.window.showTextDocument(editor.document);
    // Now close it. We don't care about it any more
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    if (km.kits.length > 0) {
      let fired_kit: string | null = null;
      km.onActiveKitChanged(k => fired_kit = k!.name);
      for (const kit of km.kits) {
        const name = kit.name;
        await km.selectKitByName(name);
        expect(fired_kit).to.eq(name);
        // Check that we've saved our change
        expect(sm.activeKitName).to.eq(name);
      }
    } else {
      console.warn('Skipping some tests as no available kits were detected');
    }
  });

  // TODO: Do some tests with Visual Studio kits and vswhere
});
