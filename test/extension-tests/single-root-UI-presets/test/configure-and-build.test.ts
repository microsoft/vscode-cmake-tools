import {fs} from '@cmt/pr';
import {TestProgramResult} from '@test/helpers/testprogram/test-program-result';
import {logFilePath} from '@cmt/logging';
import {
  clearExistingKitConfigurationFile,
  DefaultEnvironment,
  expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * TODO: add a test switching between kits and presets (i.e., merging this test
 * with single-root-UI)
 *
 * Wasn't able to add such a test currently because of unresolvable timing issues.
 *
 * Tried to use vscode.workspace.getConfiguration to update cmake.useCMakePresets,
 * with or without a sleep after. Didn't work because the config listener is async,
 * and although command cmake.useCMakePresets returns correctly, the useCMakePrests
 * property in cmake-tools.ts and driver.ts doesn't update in time.
 *
 * Also tried to write to settings.json directly, with or without a sleep after.
 * Didn't work either, looks like the config listeners are not triggered correctly.
 */

// tslint:disable:no-unused-expression

suite('Build using Presets', async () => {
  let testEnv: DefaultEnvironment;
  let compdb_cp_path: string;

  suiteSetup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    // CMakePresets.json and CMakeUserPresets.json exist so will use presets by default
    testEnv = new DefaultEnvironment('test/extension-tests/single-root-UI-presets/project-folder', build_loc, exe_res);
    compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');

    await clearExistingKitConfigurationFile();
  });

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    await vscode.commands.executeCommand('cmake.setConfigurePreset', 'Linux1');
    await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
    await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(100000);
    const logPath = logFilePath();
    testEnv.clean();
    if (await fs.exists(logPath)) {
      if (this.currentTest?.state == "failed") {
        const logContent = await fs.readFile(logPath);
        logContent.toString().split('\n').forEach(line => {
          console.log(line);
        });
      }
      await fs.writeFile(logPath, "");
    }
  });

  suiteTeardown(async () => {
    if (testEnv) {
      testEnv.teardown();
    }
    if (await fs.exists(compdb_cp_path)) {
      await fs.unlink(compdb_cp_path);
    }
  });

  test('Configure', async () => {
    expect(await vscode.commands.executeCommand('cmake.useCMakePresets', vscode.workspace.workspaceFolders![0])).to.be.eq(true);

    expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
  }).timeout(100000);

  test('Build', async () => {
    expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);

  test('Configure and Build', async () => {
    expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
    expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);

  test('Configure and Build run target', async () => {
    expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);

    expect(await vscode.commands.executeCommand('cmake.build', undefined, 'runTestTarget')).to.be.eq(0);

    const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
    const result = await resultFile.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);

  test('Test preset switch',
       async function(this: Mocha.Context) {
         await vscode.commands.executeCommand('cmake.build');

         await vscode.commands.executeCommand('cmake.setConfigurePreset', 'LinuxUser1');
         await vscode.commands.executeCommand('cmake.build');

         const result = await testEnv.result.getResultAsJson();
         expect(result['cookie']).to.eq('passed-cookie');
       })
      .timeout(100000);

  test('Test build twice', async function(this: Mocha.Context) {
    console.log('1. Build');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    console.log('2. Build');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with clean', async function(this: Mocha.Context) {
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await vscode.commands.executeCommand('cmake.clean');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with clean configure', async function(this: Mocha.Context) {
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanConfigure');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with rebuild configure', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    await vscode.commands.executeCommand('cmake.build');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanRebuild');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test -all version of commands', async function(this: Mocha.Context) {
    // Run build twice first
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await vscode.commands.executeCommand('cmake.clean');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanAll');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanConfigure');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanConfigureAll');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanRebuild');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanRebuildAll');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
    await testEnv.result.getResultAsJson();
  }).timeout(400000);
});
