import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import * as vscode from 'vscode';

chai.use(chaiAsPromised);

import {expect} from 'chai';
import * as sinon from 'sinon';

import * as kit from '../../src/kit';
import {fs} from '../../src/pr';
import * as state from '../../src/state';

// tslint:disable:no-unused-expression

const here = __dirname;
function getTestResourceFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../test/unit-tests', filename));
}


suite('Kits test', async () => {
  suite('GUI test', async () => {
    let km: kit.KitManager;
    let gui_sandbox: sinon.SinonSandbox;
    setup(async () => {
      gui_sandbox = sinon.sandbox.create();
      const stateMock = gui_sandbox.createStubInstance(state.StateManager);
      sinon.stub(stateMock, 'activeKitName').get(() => null).set(() => {});
      const kit_file = getTestResourceFilePath('test_kit.json');
      km = new kit.KitManager(stateMock, kit_file);
    });
    teardown(async () => { gui_sandbox.restore(); });

    test('KitManager tests opening of kit file', async () => {
      let text: vscode.TextDocument|undefined;
      gui_sandbox.stub(vscode.window, 'showTextDocument').callsFake(textDoc => {
        text = textDoc;
        return {document: textDoc};
      });
      await km.initialize();

      const editor = await km.openKitsEditor();

      expect(text).to.be.not.undefined;
      if (text !== undefined) {
        const rawKitsFromFile = (await fs.readFile(getTestResourceFilePath('test_kit.json'), 'utf8'));
        expect(editor.document.getText()).to.be.eq(rawKitsFromFile);
      } else {
      }
    }).timeout(10000);
  });

  test('KitManager tests event on change of active kit', async () => {
    const stateMock = sinon.createStubInstance(state.StateManager);
    let storedActivatedKitName: string = '';
    sinon.stub(stateMock, 'activeKitName').get(() => null).set(kit_ => storedActivatedKitName = kit_);
    const km = new kit.KitManager(stateMock, getTestResourceFilePath('test_kit.json'));
    await km.initialize();
    // Check that each time we change the kit, it fires a signal
    let fired_kit: string|null = null;
    km.onActiveKitChanged(k => fired_kit = k!.name);
    for (const kit_el of km.kits) {
      const name = kit_el.name;
      // Set the kit
      await km.selectKitByName(name);
      // Check that we got the signal
      expect(fired_kit).to.eq(name);
      // Check that we've saved our change
      expect(storedActivatedKitName).to.eq(name);
    }
    km.dispose();
  }).timeout(10000);

  test('KitManager test load of kit from test file', async () => {
    const stateMock = sinon.createStubInstance(state.StateManager);
    sinon.stub(stateMock, 'activeKitName').get(() => null).set(() => {});
    const km = new kit.KitManager(stateMock, getTestResourceFilePath('test_kit.json'));

    await km.initialize();

    const names = km.kits.map(k => k.name);
    expect(names).to.deep.eq([
      'CompilerKit 1',
      'CompilerKit 2',
      'CompilerKit 3 with PreferedGenerator',
      'ToolchainKit 1',
      'VSCode Kit 1',
      'VSCode Kit 2',
      '__unspec__',
    ]);
    km.dispose();
  });

  test('KitManager test selection of last activated kit', async () => {
    const stateMock = sinon.createStubInstance(state.StateManager);

    sinon.stub(stateMock, 'activeKitName').get(() => 'ToolchainKit 1').set(() => {});
    const km = new kit.KitManager(stateMock, getTestResourceFilePath('test_kit.json'));

    await km.initialize();

    expect(km.activeKit).to.be.not.null;
    if (km.activeKit)
      expect(km.activeKit.name).to.eq('ToolchainKit 1');

    km.dispose();
  });

  test('KitManager test selection of a default kit', async () => {
    const stateMock = sinon.createStubInstance(state.StateManager);
    sinon.stub(stateMock, 'activeKitName').get(() => null).set(() => {});

    const km = new kit.KitManager(stateMock, getTestResourceFilePath('test_kit.json'));
    await km.initialize();

    expect(km.activeKit).to.be.null;
    km.dispose();
  });

  test('KitManager test selection of default kit if last activated kit is invalid', async () => {
    const stateMock = sinon.createStubInstance(state.StateManager);
    let storedActivatedKitName = 'not replaced';
    sinon.stub(stateMock, 'activeKitName').get(() => 'Unknown').set(kit_ => storedActivatedKitName = kit_);

    const km = new kit.KitManager(stateMock, getTestResourceFilePath('test_kit.json'));
    await km.initialize();

    expect(km.activeKit).to.be.null;
    expect(storedActivatedKitName).to.be.null;
    km.dispose();
  });
});
