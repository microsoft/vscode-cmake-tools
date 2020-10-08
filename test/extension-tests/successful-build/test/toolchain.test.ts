import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools, ConfigureTrigger} from '@cmt/cmake-tools';
import {readKitsFile, kitsForWorkspaceDirectory, USER_KITS_FILEPATH} from '@cmt/kit';
import {platformNormalizePath} from '@cmt/util';
import {DefaultEnvironment, expect} from '@test/util';

suite('[Toolchain Substitution]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);
    if (process.platform === 'win32')
      this.skip();

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    const user_kits = await readKitsFile(USER_KITS_FILEPATH);
    const ws_kits= await kitsForWorkspaceDirectory(testEnv.projectFolder.location);
    const kits = user_kits.concat(ws_kits);
    const tc_kit = kits.find(k => k.name === 'Test Toolchain');
    expect(tc_kit).to.not.eq(undefined);

    // Set preferred generators
    testEnv.config.updatePartial({preferredGenerators: ['Unix Makefiles']});
    await cmt.setKit(tc_kit!);

    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Check substitution within toolchain kits', async () => {
    // Configure
    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0, '[toolchain] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('CMAKE_TOOLCHAIN_FILE') as api.CacheEntry;
    // tslint:disable-next-line:no-unused-expression
    expect(cacheEntry).to.not.be.null;
    expect(cacheEntry.key).to.eq('CMAKE_TOOLCHAIN_FILE', '[toolchain] unexpected cache entry key name');
    expect(platformNormalizePath(cacheEntry.as<string>()))
        .to.eq(platformNormalizePath(testEnv.projectFolder.location.concat('/test-toolchain.cmake')),
               '[toolchain] substitution incorrect');
  }).timeout(100000);
});
