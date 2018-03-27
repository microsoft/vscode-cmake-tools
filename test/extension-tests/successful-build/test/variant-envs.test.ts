import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools} from '@cmt/cmake-tools';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect} from '@test/util';

suite('[Environment Variables in Variants]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
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

  test('Check for environment variables being passed to configure', async () => {
    // Set fake settings
    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[variantEnv] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry_ = cache.get('variantEnv');
    expect(cacheEntry_).to.not.be.eq(null, '[variantEnv] Cache entry was not present');
    const cacheEntry = cacheEntry_!;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[variantEnv] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('variantEnv', '[variantEnv] unexpected cache entry key name');
    expect(typeof cacheEntry.value).to.eq('string', '[variantEnv] unexpected cache entry value type');
    expect(cacheEntry.as<string>())
        .to.eq('0cbfb6ae-f2ec-4017-8ded-89df8759c502', '[variantEnv] incorrect environment variable');
  }).timeout(60000);
});
