import {DefaultEnvironment, expect, getFirstSystemKit} from '@test/util';
// import sinon = require('sinon');
import * as vscode from 'vscode';

// tslint:disable:no-unused-expression

suite('[Debug/Launch interface]', async () => {
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/multi-root-UI/project-folder2', build_loc, exe_res);

    const kit = await getFirstSystemKit();
    console.log("Using following kit in next test: ", kit);
    await vscode.commands.executeCommand('cmake.setKitByName', kit.name);
    testEnv.projectFolder.buildDirectory.clear();
    expect(await vscode.commands.executeCommand('cmake.buildAll')).to.be.eq(0);
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    testEnv.teardown();
  });

  test('Test call of debugger', async () => {
    const executablesTargets = await vscode.commands.executeCommand('cmake.executableTargets', vscode.workspace.workspaceFolders![0]) as string[];
    expect(executablesTargets.length).to.be.not.eq(0);
    await vscode.commands.executeCommand('cmake.selectLaunchTarget', undefined, executablesTargets[0]);

    await vscode.commands.executeCommand('cmake.debugTarget');
    // sinon.assert.calledOnce(testEnv.vs_debug_start_debugging);
  }).timeout(60000);

  test('Test call of debugger for all projects', async () => {
    const executablesTargets = await vscode.commands.executeCommand('cmake.executableTargets', vscode.workspace.workspaceFolders![0]) as string[];
    expect(executablesTargets.length).to.be.not.eq(0);
    await vscode.commands.executeCommand('cmake.selectLaunchTarget', vscode.workspace.workspaceFolders![0], executablesTargets[0]);

    const executablesTargets2 = await vscode.commands.executeCommand('cmake.executableTargets', vscode.workspace.workspaceFolders![1]) as string[];
    expect(executablesTargets2.length).to.be.not.eq(0);
    await vscode.commands.executeCommand('cmake.selectLaunchTarget', vscode.workspace.workspaceFolders![1], executablesTargets2[0]);

    await vscode.commands.executeCommand('cmake.debugTargetAll');
    // sinon.assert.calledTwice(testEnv.vs_debug_start_debugging);
  }).timeout(120000);
});

