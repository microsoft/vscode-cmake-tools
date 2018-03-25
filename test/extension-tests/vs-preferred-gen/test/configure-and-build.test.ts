import {CMakeTools} from '@cmt/cmake-tools';
import config from '@cmt/config';

import {clearExistingKitConfigurationFile, DefaultEnvironment, expect} from '@test/util';

suite('Build', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    if (process.env.HasVs != 'true') {
      this.skip();
    }
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/vs-preferred-gen/project-folder',
                                     'build',
                                     'output.txt',
                                     '^Visual ?Studio');
    cmt = await CMakeTools.create(testEnv.vsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    await clearExistingKitConfigurationFile();
    await cmt.scanForKits();
    await cmt.selectKit();

    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Configure ', async () => {
    expect(await cmt.configure()).to.be.eq(0);

    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
  }).timeout(60000);

  test('Build', async () => {
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['compiler']).to.eq('Microsoft Visual Studio');
  }).timeout(60000);


  test('Configure and Build', async () => {
    expect(await cmt.configure()).to.be.eq(0);
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['compiler']).to.eq('Microsoft Visual Studio');
  }).timeout(60000);

  test('Configure and Build', async () => {
    expect(await cmt.configure()).to.be.eq(0);
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['compiler']).to.eq('Microsoft Visual Studio');
  }).timeout(60000);

  test('Test setting watcher', async () => {
    expect(config.buildDirectory).to.be.eq('${workspaceRoot}/build');
    await testEnv.setting.changeSetting('buildDirectory', 'Hallo');
    expect(config.buildDirectory).to.be.eq('Hallo');
    testEnv.setting.restore();
    expect(config.buildDirectory).to.be.eq('${workspaceRoot}/build');
  });
});
