import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {clearExistingKitConfigurationFile} from '../../../test-helpers';
import {DefaultEnvironment} from '../../../helpers/test/default-environment';

import * as api from '../../../../src/api';
import * as path from 'path';
import {CMakeCache} from '../../../../src/cache';
import {CMakeTools} from '../../../../src/cmake-tools';
import {normalizePath} from '../../../../src/util';

suite('[Variable Substitution]', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    // if (process.env.HasVs != 'true') {
    //   this.skip();
    // }
    this.timeout(100000);

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder');
    cmt = await CMakeTools.create(testEnv.vsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    await clearExistingKitConfigurationFile();
    await cmt.scanForKits();
    await cmt.selectKit();

    testEnv.projectFolder.buildDirectory.clear();

    /*
    testEnv.setting.changeSetting('configureSettings', {
      workspaceRoot: '${workspaceRoot}',
      buildType: '${buildType}',
      workspaceRootFolderName: '${workspaceRootFolderName}',
      generator: '${generator}',
      projectName: '${projectName}',
      userHome: '${userHome}',
      buildLabel: '${buildLabel}'
    });
    */
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Check substitution within "cmake.installPrefix"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('installPrefix', '${workspaceRoot}/build/dist');

    // Configure
    expect(await cmt.configure()).to.be.eq(0);
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('CMAKE_INSTALL_PREFIX') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[cmakeInstallPrefix] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('CMAKE_INSTALL_PREFIX', '[cmakeInstallPrefix] unexpected cache entry key name');
    expect(cacheEntry.as<string>())
        .to.eq(normalizePath(testEnv.projectFolder.buildDirectory.location.concat('/dist')),
               '[cmakeInstallPrefix] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[cmakeInstallPrefix] unexpected cache entry value type');
  }).timeout(30000);

  test('Check substitution for "workspaceRoot"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {workspaceRoot: '${workspaceRoot}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0);
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('workspaceRoot') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceRoot] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('workspaceRoot', '[workspaceRoot] unexpected cache entry key name');
    expect(normalizePath(cacheEntry.as<string>()))
        .to.eq(normalizePath(testEnv.projectFolder.location), '[workspaceRoot] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[workspaceRoot] unexpected cache entry value type');
  }).timeout(30000);

  test('Check substitution for "buildType"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {buildType: '${buildType}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0);
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('buildType') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[buildType] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('buildType', '[buildType] unexpected cache entry key name');
    expect(cacheEntry.as<string>()).to.eq('Debug', '[buildType] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[buildType] unexpected cache entry value type');
  }).timeout(30000);

  test('Check substitution for "workspaceRootFolderName"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {workspaceRootFolderName: '${workspaceRootFolderName}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0);
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('workspaceRootFolderName') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceRootFolderName] unexpected cache entry type');
    expect(cacheEntry.key)
        .to.eq('workspaceRootFolderName', '[workspaceRootFolderName] unexpected cache entry key name');
    expect(cacheEntry.as<string>()).to.eq(path.basename(testEnv.projectFolder.location), '[workspaceRootFolderName] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[workspaceRootFolderName] unexpected cache entry value type');
  }).timeout(30000);

  test('Check substitution for "generator"', async () => {
    // Set fake settings
    testEnv.setting.changeSetting('configureSettings', {generator: '${generator}'});

    // Configure
    expect(await cmt.configure()).to.be.eq(0);
    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
    const cache = await CMakeCache.fromPath(await cmt.cachePath);

    const cacheEntry = cache.get('generator') as api.CacheEntry;
    expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[generator] unexpected cache entry type');
    expect(cacheEntry.key).to.eq('generator', '[generator] unexpected cache entry key name');
    const generator = cache.get('CMAKE_GENERATOR') as api.CacheEntry;
    expect(cacheEntry.as<string>()).to.eq(generator.as<string>(), '[generator] substitution incorrect');
    expect(typeof cacheEntry.value).to.eq('string', '[generator] unexpected cache entry value type');
  }).timeout(30000);
});
