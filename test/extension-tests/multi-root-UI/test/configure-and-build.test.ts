import {fs} from '@cmt/pr';
import {TestProgramResult} from '@test/helpers/testprogram/test-program-result';
import {logFilePath} from '@cmt/logging';
import {
  clearExistingKitConfigurationFile,
  DefaultEnvironment,
  expect,
  getFirstSystemKit,
  getMatchingSystemKit
} from '@test/util';
import * as fs_ from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import CMakeTools from '@cmt/cmake-tools';

// tslint:disable:no-unused-expression

let workername: string = process.platform;

if (process.env.APPVEYOR_BUILD_WORKER_IMAGE) {
  workername = process.env.APPVEYOR_BUILD_WORKER_IMAGE;
}

if (process.env.TRAVIS_OS_NAME) {
  workername = process.env.TRAVIS_OS_NAME;
}

suite('Build', async () => {
  let testEnv: DefaultEnvironment;
  let compdb_cp_path: string;
  let cmakeTools : CMakeTools;

  suiteSetup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/multi-root-UI/project-folder2', build_loc, exe_res);
    compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');
    cmakeTools = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    await vscode.commands.executeCommand('cmake.scanForKits');
    await clearExistingKitConfigurationFile();
  });

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const kit = await getFirstSystemKit(cmakeTools);
    console.log("Using following kit in next test: ", kit);
    await vscode.commands.executeCommand('cmake.setKitByName', kit.name);
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
    expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
    // Didn't configure this folder
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(false, 'cache present');
  }).timeout(100000);

  test('ConfigureAll', async () => {
    expect(await vscode.commands.executeCommand('cmake.configureAll')).to.be.eq(0);

    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
  }).timeout(200000);

  test('Build', async () => {
    expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

    expect(fs_.existsSync(path.join(testEnv.projectFolder.buildDirectory.location, testEnv.executableResult))).to.eql(false, 'Wrong folder built');
  }).timeout(200000);

  test('BuildAll', async () => {
    expect(await vscode.commands.executeCommand('cmake.buildAll')).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(200000);

  test('ConfigureAll and BuildAll', async () => {
    expect(await vscode.commands.executeCommand('cmake.configureAll')).to.be.eq(0);
    expect(await vscode.commands.executeCommand('cmake.buildAll')).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(200000);

  test('Configure and Build run target for all projects', async () => {
    expect(await vscode.commands.executeCommand('cmake.configureAll')).to.be.eq(0);

    await vscode.commands.executeCommand('cmake.setDefaultTarget', vscode.workspace.workspaceFolders![0], 'runTestTarget');
    await vscode.commands.executeCommand('cmake.setDefaultTarget', vscode.workspace.workspaceFolders![1], 'runTestTarget');
    expect(await vscode.commands.executeCommand('cmake.buildAll')).to.be.eq(0);

    const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
    const result = await resultFile.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(200000);

  test('Test kit switch after missing preferred generator', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    const os_compilers: {[osName: string]: {kitLabel: RegExp, compiler: string}[]} = {
      linux: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^Clang \d/, compiler: 'Clang'}],
      win32: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^VisualStudio/, compiler: 'MSVC'}]
    };
    if (!(workername in os_compilers))
      this.skip();
    const compiler = os_compilers[workername];

    // Run test
    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(cmakeTools, compiler[0].kitLabel)).name);

    await vscode.commands.executeCommand('cmake.buildAll');

    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(cmakeTools, compiler[1].kitLabel)).name);

    await vscode.commands.executeCommand('cmake.buildAll');
    const result = await testEnv.result.getResultAsJson();
    expect(result['compiler']).to.eql(compiler[1].compiler);
  }).timeout(100000);

  test('Test kit switch between different preferred generators and compilers',
       async function(this: Mocha.Context) {
         // Select compiler build node dependent
         const os_compilers: {[osName: string]: {kitLabel: RegExp, compiler: string}[]} = {
           linux: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^Clang \d/, compiler: 'Clang'}],
           win32: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^VisualStudio/, compiler: 'MSVC'}]
         };
         if (!(workername in os_compilers))
           this.skip();
         const compiler = os_compilers[workername];

         testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
         await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(cmakeTools, compiler[0].kitLabel)).name);
         await vscode.commands.executeCommand('cmake.buildAll');

         testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
         await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(cmakeTools, compiler[1].kitLabel)).name);
         await vscode.commands.executeCommand('cmake.buildAll');

         const result = await testEnv.result.getResultAsJson();
         expect(result['compiler']).to.eql(compiler[1].compiler);
       })
      .timeout(100000);

  test('Test build twice', async function(this: Mocha.Context) {
    console.log('1. Build');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    console.log('2. Build');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
  }).timeout(100000);

  test('Test build twice with clean', async function(this: Mocha.Context) {
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await vscode.commands.executeCommand('cmake.clean');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
  }).timeout(100000);

  test('Test build twice with clean configure', async function(this: Mocha.Context) {
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanConfigure');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
  }).timeout(100000);

  test('Test build twice with rebuild configure', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    await vscode.commands.executeCommand('cmake.build');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
    await vscode.commands.executeCommand('cmake.cleanRebuild');
    expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
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
