import {DefaultEnvironment, expect, getFirstSystemKit, sleep} from '@test/util';
// import sinon = require('sinon');
import * as vscode from 'vscode';
import CMakeTools from '@cmt/cmake-tools';

// tslint:disable:no-unused-expression

suite('[Debug/Launch interface using Kits and Variants]', async () => {
  let testEnv: DefaultEnvironment;
  let cmakeTools: CMakeTools;

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/single-root-UI/project-folder', build_loc, exe_res);
    cmakeTools = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'false');
    // Wait for 5 sec since the config listener is async
    await sleep(5000);

    const kit = await getFirstSystemKit(cmakeTools);
    console.log("Using following kit in next test: ", kit);
    await vscode.commands.executeCommand('cmake.setKitByName', kit.name);
    testEnv.projectFolder.buildDirectory.clear();
    expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(30000);

    await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'true');
    // Wait for 5 sec since the config listener is async
    await sleep(5000);

    testEnv.teardown();
  });

  test('Test call of debugger', async () => {
    const executablesTargets = await vscode.commands.executeCommand('cmake.executableTargets') as string[];
    expect(executablesTargets.length).to.be.not.eq(0);
    await vscode.commands.executeCommand('cmake.selectLaunchTarget', undefined, executablesTargets[0]);

    await vscode.commands.executeCommand('cmake.debugTarget');
    // sinon.assert.calledWith(testEnv.vs_debug_start_debugging);
  }).timeout(60000);
});

suite('[Debug/Launch interface using Presets]', async () => {
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/single-root-UI/project-folder', build_loc, exe_res);
    testEnv.projectFolder.buildDirectory.clear();

    await vscode.commands.executeCommand('cmake.setConfigurePreset', 'LinuxUser1');
    await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
    await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');

    expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(30000);
    testEnv.teardown();
  });

  test('Test call of debugger', async () => {
    const executablesTargets = await vscode.commands.executeCommand('cmake.executableTargets') as string[];
    expect(executablesTargets.length).to.be.not.eq(0);
    await vscode.commands.executeCommand('cmake.selectLaunchTarget', undefined, executablesTargets[0]);

    await vscode.commands.executeCommand('cmake.debugTarget');
    // sinon.assert.calledWith(testEnv.vs_debug_start_debugging);
  }).timeout(60000);
});
