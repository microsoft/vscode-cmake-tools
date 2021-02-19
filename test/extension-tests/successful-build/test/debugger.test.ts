import {CMakeTools} from '@cmt/cmake-tools';
import {DefaultEnvironment, expect, getFirstSystemKit} from '@test/util';
//import sinon = require('sinon');
import * as fs from 'fs';
import * as path from 'path';

// tslint:disable:no-unused-expression

suite('[Debug/Launch interface]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);
    await cmt.setKit(await getFirstSystemKit(cmt));
    testEnv.projectFolder.buildDirectory.clear();
    expect(await cmt.build()).to.be.eq(0);
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Test call of debugger', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);
    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    await cmt.debugTarget();
    //sinon.assert.calledWith(testEnv.vs_debug_start_debugging);
  }).timeout(60000);

  test('Test buildTargetName for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    expect(await cmt.buildTargetName()).to.be.eq(await cmt.allTargetName);

    await cmt.setDefaultTarget(executablesTargets[0].name);
    expect(await cmt.buildTargetName()).to.be.eq(executablesTargets[0].name);
  });

  test('Test launchTargetPath for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.launchTargetPath()).to.be.eq(executablesTargets[0].path);
  });

  test('Test launchTargetDirectory for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.launchTargetDirectory()).to.be.eq(path.dirname(executablesTargets[0].path));
  });

  test('Test launchTargetFilename for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.launchTargetFilename()).to.be.eq(path.basename(executablesTargets[0].path));
  });

  test('Test getLaunchTargetPath for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.getLaunchTargetPath()).to.be.eq(executablesTargets[0].path);
  });

  test('Test getLaunchTargetDirectory for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.getLaunchTargetDirectory()).to.be.eq(path.dirname(executablesTargets[0].path));
  });

  test('Test getLaunchTargetFilename for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.getLaunchTargetFilename()).to.be.eq(path.basename(executablesTargets[0].path));
  });

  test('Test build on launch (default)', async () => {
    testEnv.config.updatePartial({buildBeforeRun: undefined});

    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);
    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    const launchProgramPath = await cmt.launchTargetPath();
    expect(launchProgramPath).to.be.not.null;
    const validPath: string = launchProgramPath!;

    // Check that the compiled files does not exist
    fs.unlinkSync(validPath);
    expect(fs.existsSync(validPath)).to.be.false;

    // Check that the 'get' version does not rebuild the target
    await cmt.getLaunchTargetPath();
    expect(fs.existsSync(validPath)).to.be.false;

    // Check that the original version does rebuild the target
    await cmt.launchTargetPath();
    expect(fs.existsSync(validPath)).to.be.false;
  }).timeout(60000);

  test('Test build on launch on by config', async () => {
    testEnv.config.updatePartial({buildBeforeRun: true});

    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);
    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    const launchProgramPath = await cmt.launchTargetPath();
    expect(launchProgramPath).to.be.not.null;
    const validPath: string = launchProgramPath!;

    // Check that the compiled files does not exist
    fs.unlinkSync(validPath);
    expect(fs.existsSync(validPath)).to.be.false;

    await cmt.launchTargetPath();

    // Check that it is compiled as a new file
    expect(fs.existsSync(validPath)).to.be.true;
  }).timeout(60000);

  test('Test build on launch off by config', async () => {
    testEnv.config.updatePartial({buildBeforeRun: false});

    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);
    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    const launchProgramPath = await cmt.launchTargetPath();
    expect(launchProgramPath).to.be.not.null;
    const validPath: string = launchProgramPath!;

    // Check that the compiled files does not exist
    fs.unlinkSync(validPath);
    expect(fs.existsSync(validPath)).to.be.false;

    await cmt.launchTargetPath();

    // Check that it is compiled as a new file
    expect(fs.existsSync(validPath)).to.be.false;
  }).timeout(60000);

  test('Test launch target', async () => {
    testEnv.config.updatePartial({buildBeforeRun: false});

    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);
    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    const launchProgramPath = await cmt.launchTargetPath();
    expect(launchProgramPath).to.be.not.null;

    // Remove file if not exists
    const createdFileOnExecution = path.join(path.dirname(launchProgramPath!), 'test.txt');
    if (fs.existsSync(createdFileOnExecution)) {
      fs.unlinkSync(createdFileOnExecution);
    }

    const terminal = await cmt.launchTarget();
    expect(terminal).of.be.not.null;
    expect(terminal!.name).of.be.eq('CMake/Launch');

    // Needed to get launch target result
    await new Promise(res => setTimeout(res, 3000));

    // Check that it is compiled as a new file
    expect(fs.existsSync(createdFileOnExecution)).to.be.true;
  }).timeout(60000);
});

