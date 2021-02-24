
import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeTools, ConfigureTrigger} from '@cmt/cmake-tools';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit} from '@test/util';
import {fs} from '@cmt/pr';
import * as path from 'path';

// tslint:disable:no-unused-expression

suite('[Environment Variables in Variants]', async () => {
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
    const variantFileBackup = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
    if (await fs.exists(variantFileBackup)) {
      const variantFile = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
      await fs.rename(variantFileBackup, variantFile);
    }

    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
  });

  test('Check for environment variables being passed to configure', async () => {
    // Set fake settings
    // Configure
    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0, '[variantEnv] configure failed');
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
  }).timeout(100000);

  test('Replace default variant', async () => {
    const variantFile = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
    const variantFileBackup = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json.backup');
    await fs.rename(variantFile, variantFileBackup);
    expect(await fs.exists(variantFile)).to.be.false;

    // Set fake settings
    testEnv.config.updatePartial({
      defaultVariants: {
        buildType: {
          default: 'debug-label',
          choices: {
            'debug-label': {short: 'debug-label short', buildType: 'Debug'},
            'not-debug': {short: 'not-debug short', buildType: 'Release'}
          }
        },
        otherVariant: {
          default: 'option1',
          choices: {
            option1: {short: 'option1 short', env: {TEST_VARIANT_ENV: '0xCAFE'}},
            option2: {short: 'option2 short'}
          }
        }
      }
    });

    try {
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
      expect(cacheEntry.as<string>()).to.eq('0xCAFE', '[variantEnv] incorrect environment variable');
    } finally {
      // Restore the vairants file to before the test
      await fs.rename(variantFileBackup, variantFile);
    }
  }).timeout(100000);
});
