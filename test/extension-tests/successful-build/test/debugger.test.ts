import {CMakeTools} from '@cmt/cmake-tools';
import {DefaultEnvironment, expect} from '@test/util';
import sinon = require('sinon');
import * as fs from 'fs';

// tslint:disable:no-unused-expression

suite('[Debug/Lauch interface]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);
    await cmt.scanForKits();

    testEnv.projectFolder.buildDirectory.clear();
    await cmt.selectKit();
    expect(await cmt.build()).to.be.eq(0);
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Test call of debugger', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);
    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    await cmt.debugTarget();
    sinon.assert.calledWith(testEnv.vs_debug_start_debugging);
  }).timeout(60000);

  test('Test launchTargetPath for use in other extensions or launch.json', async () => {
    const executablesTargets = await cmt.executableTargets;
    expect(executablesTargets.length).to.be.not.eq(0);

    await cmt.setLaunchTargetByName(executablesTargets[0].name);

    expect(await cmt.launchTargetPath()).to.be.eq(executablesTargets[0].path);
  });

  test.only('Test build on launch', async () => {
        const executablesTargets = await cmt.executableTargets;
        expect(executablesTargets.length).to.be.not.eq(0);
        await cmt.setLaunchTargetByName(executablesTargets[0].name);

        const launchProgrammPath = await cmt.launchTargetPath();
        expect(launchProgrammPath).to.be.not.null;
        const validPath: string = launchProgrammPath!;

        // Check that the compiled files does not exist
        fs.unlinkSync(validPath);
        expect(fs.existsSync(validPath)).to.be.false;

        await cmt.launchTargetPath();

        // Check that it is compiled as a new file
        expect(fs.existsSync(validPath)).to.be.true;
      }).timeout(60000);
});