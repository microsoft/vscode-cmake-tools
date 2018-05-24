import {CMakeTools} from '@cmt/cmake-tools';
import {DefaultEnvironment, expect} from '@test/util';
import sinon = require('sinon');

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
});