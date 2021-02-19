import {CMakeTools} from '@cmt/cmake-tools';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit} from '@test/util';

suite('cmake', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', build_loc, exe_res);
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    await clearExistingKitConfigurationFile();
    await cmt.setKit(await getFirstSystemKit(cmt));

    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('No cmake present message', async () => {
    testEnv.config.updatePartial({cmakePath: 'cmake3'});
    await cmt.allTargetName;  // Using an cmaketools command which creates the instance once.

    expect(testEnv.errorMessagesQueue.length).to.eql(1);  // Expect only cmake error message
    expect(testEnv.errorMessagesQueue[0])
        .to.be.contains('Is it installed or settings contain the correct path (cmake.cmakePath)?');
  }).timeout(60000);
});
