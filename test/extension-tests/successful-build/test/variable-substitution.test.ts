import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools} from '@cmt/cmake-tools';
import {normalizePath} from '@cmt/util';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect} from '@test/util';

import * as path from 'path';

suite('[Variable Substitution]', async () => {
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

  test('Check substitution for "workspaceRoot"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {workspaceRoot: '${workspaceRoot}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[workspaceRoot] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('workspaceRoot') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceRoot] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('workspaceRoot', '[workspaceRoot] unexpected cache entry key name');
    expect(normalizePath(cacheEntry.as<string>()))
        .to.eq(normalizePath(testEnv.projectFolder.location), '[workspaceRoot] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[workspaceRoot] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution for "buildType"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {buildType: '${buildType}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[buildType] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('buildType') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[buildType] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('buildType', '[buildType] unexpected cache entry key name');
    expect(cacheEntry.as<string>()).to.eq('Debug', '[buildType] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[buildType] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution for "workspaceRootFolderName"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {workspaceRootFolderName: '${workspaceRootFolderName}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[workspaceRootFolderName] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('workspaceRootFolderName') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceRootFolderName] unexpected cache entry type');
    expect(cacheEntry.key)
        .to.eq('workspaceRootFolderName', '[workspaceRootFolderName] unexpected cache entry key name');
    expect(cacheEntry.as<string>())
        .to.eq(path.basename(testEnv.projectFolder.location), '[workspaceRootFolderName] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[workspaceRootFolderName] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution for "generator"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {generator: '${generator}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[generator] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('generator') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[generator] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('generator', '[generator] unexpected cache entry key name');
    const generator = cache.get('CMAKE_GENERATOR') as api.CacheEntry;
    expect(cacheEntry.as<string>()).to.eq(generator.as<string>(), '[generator] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[generator] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution for "projectName"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {projectName: '${projectName}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[projectName] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('projectName') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[projectName] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('projectName', '[projectName] unexpected cache entry key name');
    expect(cacheEntry.as<string>()).to.eq('Unknown Project', '[projectName] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[projectName] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution for "userHome"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {userHome: '${userHome}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[userHome] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('userHome') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[userHome] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('userHome', '[userHome] unexpected cache entry key name');
    const user_dir = process.platform === 'win32' ? process.env['HOMEPATH']! : process.env['HOME']!;
    expect(cacheEntry.as<string>()).to.eq(user_dir, '[userHome] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[userHome] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution for variant names', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {buildLabel: '${buildLabel}', otherVariant: '${otherVariant}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[variant names] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('buildLabel') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[buildLabel] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('buildLabel', '[buildLabel] unexpected cache entry key name');
    expect(cacheEntry.as<string>()).to.eq('debug-label', '[buildLabel] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[buildLabel] unexpected cache entry value type');

    const cacheEntry2 = cache.get('otherVariant') as api.CacheEntry;
    expect(cacheEntry2.type).to.eq(api.CacheEntryType.String, '[otherVariant] unexpected cache entry type');
    expect(cacheEntry2.key).to.eq('otherVariant', '[otherVariant] unexpected cache entry key name');
    expect(cacheEntry2.as<string>()).to.eq('option1', '[otherVariant] substitution incorrect');
    expect(typeof cacheEntry2.value).to.eq('string', '[otherVariant] unexpected cache entry value type');
  }).timeout(60000);

  test('Check substitution within "cmake.installPrefix"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('installPrefix', '${workspaceRoot}/build/dist');

    // Configure
    expect(await cmt.configure()).to.be.eq(0, '[cmakeInstallPrefix] configure failed');
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('CMAKE_INSTALL_PREFIX') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[cmakeInstallPrefix] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('CMAKE_INSTALL_PREFIX', '[cmakeInstallPrefix] unexpected cache entry key name');
    expect(cacheEntry.as<string>())
        .to.eq(normalizePath(testEnv.projectFolder.buildDirectory.location.concat('/dist')),
               '[cmakeInstallPrefix] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[cmakeInstallPrefix] unexpected cache entry value type');
  }).timeout(60000);
});
