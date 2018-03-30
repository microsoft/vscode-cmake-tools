import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools} from '@cmt/cmake-tools';
import {normalizePath} from '@cmt/util';
import {DefaultEnvironment, expect} from '@test/util';

// tslint:disable:no-unused-expression

suite.only('[Toolchain Substitution]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder',
                                     'build',
                                     'output.txt',
                                     'Test Toolchain');
    cmt = await CMakeTools.create(testEnv.vsContext);

    // One time scan and selection
    // await clearExistingKitConfigurationFile();
    // await cmt.scanForKits();
    await cmt.selectKit();

    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test.only('Check substitution within toolchain kits', async () => {
        // Set preferred generators
        testEnv.setting.changeSetting('preferredGenerators', ['NMake Makefiles', 'Unix Makefiles', 'MinGW Makefiles']);

        // Configure
        expect(await cmt.configure()).to.be.eq(0, '[toolchain] configure failed');
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
        const cache = await CMakeCache.fromPath(await cmt.cachePath);

        const cacheEntry = cache.get('CMAKE_TOOLCHAIN_FILE') as api.CacheEntry;
        expect(cacheEntry).to.not.be.null;
        expect(cacheEntry.key).to.eq('CMAKE_TOOLCHAIN_FILE', '[toolchain] unexpected cache entry key name');
        expect(normalizePath(cacheEntry.as<string>()))
            .to.eq(normalizePath(testEnv.projectFolder.location.concat('/test-toolchain.cmake')),
                   '[toolchain] substitution incorrect');
      }).timeout(60000);
});
