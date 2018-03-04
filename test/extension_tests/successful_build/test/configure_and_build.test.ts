import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {expect} from 'chai';
import sinon = require('sinon');
import * as vscode from 'vscode';
import * as path from 'path';

import {clearExistingKitConfigurationFile, getExtension} from '../../../test_helpers';
import {CMakeTools} from '../../../../src/cmake-tools';
import {fs} from '../../../../src/pr';
import {normalizePath} from '../../../../src/util';


suite('Build', async () => {
  let cmt: CMakeTools;
  let sandbox: sinon.SinonSandbox;

  suiteSetup(async () => {
    clearExistingKitConfigurationFile();
    // clean build folder
    sandbox = sinon.sandbox.create();

    sandbox.stub(vscode.window, "showQuickPick").callsFake(function(items: string[]): Thenable<string|undefined> {
      return Promise.resolve(items[1]);  // How do we make it plattform independent?
    });
  });
  suiteTeardown(async () => {
    sandbox.restore();
    await cmt.stop();

  })

  test('Configure ', async () => {
    cmt = await getExtension();
    await cmt.scanForKits();
    await cmt.selectKit();

    expect(await cmt.configure()).to.be.eq(0);
  }).timeout(100000);

  test.only('Build', async () => {
    clearExistingKitConfigurationFile();
    cmt = await getExtension();
    await cmt.scanForKits();
    await cmt.selectKit();

    expect(await cmt.build()).to.be.eq(0);
    // How do we get the path to the executable or the output of executeable?

    // Get path for output.txt file and check if it exists
    const file = normalizePath(path.join(await cmt.binaryDir, 'output.txt'));
    expect(await fs.exists(file)).to.eq(true);

    const content = await fs.readFile(file);
    expect(content.toLocaleString()).to.not.eq('');

    /*
    // In my case it was the following, but it is environment specific.
    const jsonContent = JSON.parse(content.toString());
    expect(jsonContent['compiler']).to.eq('Microsoft Visual Studio');
    expect(jsonContent['cmake-version']).to.eq('3.9');
    //*/
  }).timeout(100000);
});
