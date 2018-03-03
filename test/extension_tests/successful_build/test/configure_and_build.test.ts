import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {expect} from 'chai';
import sinon = require('sinon');
import * as vscode from 'vscode';

import {clearExistingKitConfigurationFile, getExtension} from '../../../test_helpers';
import { CMakeTools } from '../../../../src/cmake-tools';


suite('Build', async() => {
  let cmt : CMakeTools;
  let sandbox: sinon.SinonSandbox;

  suiteSetup(async() => {
    clearExistingKitConfigurationFile();
    // clean build folder
    sandbox = sinon.sandbox.create();

    sandbox.stub(vscode.window, "showQuickPick").callsFake(
      function(items: string[]) : Thenable<string | undefined> {
      return Promise.resolve(items[1]); // How do we make it plattform independent?
    });
  });
  suiteTeardown(async() => {
    sandbox.restore();
    await cmt.stop();

  })

  test('Configure ', async() => {
    cmt = await getExtension();
    await cmt.scanForKits();
    await cmt.selectKit();

    expect(await cmt.configure()).to.be.eq(0);
  }).timeout(100000);

  test.only('Build', async() => {
    clearExistingKitConfigurationFile();
    cmt = await getExtension();
    await cmt.scanForKits();
    await cmt.selectKit();

    expect(await cmt.build()).to.be.eq(0);
    // How do we get the path to the executable or the output of executeable?
  }).timeout(100000);
});