import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools} from '@cmt/cmake-tools';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit} from '@test/util';
import * as path from 'path';

suite('[Environment]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
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

  test('Passing env-vars to CMake but not to the compiler', async () => {
    // Set fake settings
    testEnv.config.updatePartial({
      configureEnvironment: {
        _CONFIGURE_ENV: '${workspaceRootFolderName}',
      },
    });

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[configureEnvironment] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('configureEnvironment') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[configureEnvironment] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('configureEnvironment', '[configureEnvironment] unexpected cache entry key name');
    expect(cacheEntry.as<string>())
        .to.eq(path.basename(testEnv.projectFolder.location), '[configureEnvironment] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[configureEnvironment] unexpected cache entry value type');

    // Build
    expect(await cmt.build()).to.be.eq(0, '[configureEnvironment] build failed');
    const result = await testEnv.result.getResultAsJson();
    expect(result['configure-env']).to.eq('', '[configureEnvironment] env-var got passed to compiler');
  }).timeout(100000);

  test('Passing env-vars to the compiler but not to CMake', async () => {
    // Set fake settings
    testEnv.config.updatePartial({buildEnvironment: {_BUILD_ENV: '${workspaceRootFolderName}'}});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[buildEnvironment] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('buildEnvironment') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[buildEnvironment] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('buildEnvironment', '[buildEnvironment] unexpected cache entry key name');
    expect(cacheEntry.as<string>()).to.be.eq('', '[buildEnvironment] env-var got passed to CMake');
    expect(typeof cacheEntry.value).to.eq('string', '[buildEnvironment] unexpected cache entry value type');

    // Build
    expect(await cmt.build()).to.be.eq(0, '[buildEnvironment] build failed');
    const result = await testEnv.result.getResultAsJson();
    expect(result['build-env'])
        .to.eq(path.basename(testEnv.projectFolder.location), '[buildEnvironment] substitution incorrect');
  }).timeout(100000);

  test('Passing env-vars to CMake AND to the compiler', async () => {
    // Set fake settings
    testEnv.config.updatePartial({environment: {_ENV: '${workspaceRootFolderName}'}});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[environment] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('environment') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[environment] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('environment', '[environment] unexpected cache entry key name');
    expect(cacheEntry.as<string>())
        .to.eq(path.basename(testEnv.projectFolder.location), '[environment] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[environment] unexpected cache entry value type');

    // Build
    expect(await cmt.build()).to.be.eq(0, '[environment] build failed');
    const result = await testEnv.result.getResultAsJson();
    expect(result['env']).to.eq(path.basename(testEnv.projectFolder.location), '[environment] substitution incorrect');
  }).timeout(100000);
});
