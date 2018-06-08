import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools} from '@cmt/cmake-tools';
import {normalizePath} from '@cmt/util';
import {DefaultEnvironment, expect} from '@test/util';

suite('[Toolchain Substitution]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);
    if (process.platform === 'win32')
      this.skip();

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder',
                                     'build',
                                     'output.txt',
                                     /Test Toolchain/);
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    // Set preferred generators
    testEnv.config.updatePartial({preferredGenerators: ['Unix Makefiles']});
    await cmt.selectKit();

    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Check substitution within toolchain kits', async () => {
    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[toolchain] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('CMAKE_TOOLCHAIN_FILE') as api.CacheEntry;
    // tslint:disable-next-line:no-unused-expression
    expect(cacheEntry).to.not.be.null;
    expect(cacheEntry.key).to.eq('CMAKE_TOOLCHAIN_FILE', '[toolchain] unexpected cache entry key name');
    expect(normalizePath(cacheEntry.as<string>()))
        .to.eq(normalizePath(testEnv.projectFolder.location.concat('/test-toolchain.cmake')),
               '[toolchain] substitution incorrect');
  }).timeout(100000);
});
