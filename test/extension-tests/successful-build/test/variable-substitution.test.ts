import * as api from '@cmt/api';
import { CMakeCache } from '@cmt/cache';
import { CMakeTools, ConfigureTrigger } from '@cmt/cmakeTools';
import paths from '@cmt/paths';
import { objectPairs, platformNormalizePath, makeHashString } from '@cmt/util';
import { clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
import * as path from 'path';

suite('Variable Substitution', () => {
    let cmt: CMakeTools;
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
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

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await cmt.asyncDispose();
        testEnv.teardown();
    });

    test('Check variable substitution', async () => {
        // Set new settings
        testEnv.config.updatePartial({
            configureSettings: {
                workspaceRoot: '${workspaceRoot}',
                workspaceFolder: '${workspaceFolder}',
                workspaceHash: '${workspaceHash}',
                buildType: '${buildType}',
                buildKit: '${buildKit}',
                workspaceRootFolderName: '${workspaceRootFolderName}',
                workspaceFolderBasename: '${workspaceFolderBasename}',
                generator: '${generator}',
                userHome: '${userHome}'
            },
            installPrefix: '${workspaceFolder}/build/dist'
        });

        // Configure
        //expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0, '[workspaceRoot] configure failed');
        await cmt.configureInternal(ConfigureTrigger.runTests);
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
        const cache = await CMakeCache.fromPath(await cmt.cachePath);

        // Check substitution for "workspaceRoot"
        let cacheEntry = cache.get('workspaceRoot') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceRoot] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('workspaceRoot', '[workspaceRoot] unexpected cache entry key name');
        expect(platformNormalizePath(cacheEntry.as<string>()))
            .to.eq(platformNormalizePath(testEnv.projectFolder.location), '[workspaceRoot] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceRoot] unexpected cache entry value type');

        // Check substitution for "workspaceFolder".
        cacheEntry = cache.get('workspaceFolder') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceFolder] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('workspaceFolder', '[workspaceFolder] unexpected cache entry key name');
        expect(platformNormalizePath(cacheEntry.as<string>()))
            .to.eq(platformNormalizePath(testEnv.projectFolder.location), '[workspaceFolder] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceFolder] unexpected cache entry value type');

        // Check substitution for "workspaceHash".
        cacheEntry = cache.get('workspaceHash') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceHash] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('workspaceHash', '[workspaceHash] unexpected cache entry key name');
        expect(cacheEntry.as<string>()).to.eq(makeHashString(testEnv.projectFolder.location), '[workspaceHash] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceHash] unexpected cache entry value type');

        // Check substitution for "buildType".
        cacheEntry = cache.get('buildType') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[buildType] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('buildType', '[buildType] unexpected cache entry key name');
        expect(cacheEntry.as<string>()).to.eq('Debug', '[buildType] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[buildType] unexpected cache entry value type');

        // Check substitution for "buildKit".
        cacheEntry = cache.get('buildKit') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[buildKit] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('buildKit', '[buildKit] unexpected cache entry key name');
        const kit = cmt.activeKit;
        expect(cacheEntry.as<string>()).to.eq(kit!.name, '[buildKit] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[buildKit] unexpected cache entry value type');

        // Check substitution for "workspaceRootFolderName".
        cacheEntry = cache.get('workspaceRootFolderName') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceRootFolderName] unexpected cache entry type');
        expect(cacheEntry.key)
            .to.eq('workspaceRootFolderName', '[workspaceRootFolderName] unexpected cache entry key name');
        expect(cacheEntry.as<string>())
            .to.eq(path.basename(testEnv.projectFolder.location), '[workspaceRootFolderName] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceRootFolderName] unexpected cache entry value type');

        // Check substitution for "workspaceFolderBasename".
        cacheEntry = cache.get('workspaceFolderBasename') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[workspaceFolderBasename] unexpected cache entry type');
        expect(cacheEntry.key)
            .to.eq('workspaceFolderBasename', '[workspaceFolderBasename] unexpected cache entry key name');
        expect(cacheEntry.as<string>())
            .to.eq(path.basename(testEnv.projectFolder.location), '[workspaceFolderBasename] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceFolderBasename] unexpected cache entry value type');

        // Check substitution for "generator".
        cacheEntry = cache.get('generator') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[generator] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('generator', '[generator] unexpected cache entry key name');
        const generator = cache.get('CMAKE_GENERATOR') as api.CacheEntry;
        expect(cacheEntry.as<string>()).to.eq(generator.as<string>(), '[generator] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[generator] unexpected cache entry value type');

        // Check substitution for "userHome".
        cacheEntry = cache.get('userHome') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[userHome] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('userHome', '[userHome] unexpected cache entry key name');
        expect(cacheEntry.as<string>()).to.eq(paths.userHome, '[userHome] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[userHome] unexpected cache entry value type');

        // Check substitution within "cmake.installPrefix".
        cacheEntry = cache.get('CMAKE_INSTALL_PREFIX') as api.CacheEntry;
        expect(cacheEntry.type).to.eq(api.CacheEntryType.String, '[cmakeInstallPrefix] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('CMAKE_INSTALL_PREFIX', '[cmakeInstallPrefix] unexpected cache entry key name');
        expect(platformNormalizePath(cacheEntry.as<string>()))
            .to.eq(platformNormalizePath(testEnv.projectFolder.buildDirectory.location.concat('/dist')),
                '[cmakeInstallPrefix] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[cmakeInstallPrefix] unexpected cache entry value type');

    }).timeout(100000);

    test('Check substitution for variant names', async () => {
        // Define test keys and expected values
        const testKeys = { buildType: 'debug-label', otherVariant: 'option1' };

        // Update configure settings
        const configSettings: { [key: string]: string } = {};
        await Promise.all(Object.keys(testKeys).map(async key => configSettings[key] = `\${variant:${key}}`));
        testEnv.config.updatePartial({ configureSettings: configSettings });

        // Configure and retrieve generated cache
        expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0, '[variant] configure failed');
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, '[variant] cache not found');
        const cache = await CMakeCache.fromPath(await cmt.cachePath);

        // Helper function for checking test keys in a cmake cache
        const checkTestKey = async (testKey: [string, string], testCache: CMakeCache) => {
            const [key, expected] = testKey;

            // Get cache entry for given test key
            const cacheEntry = testCache.get(key) as api.CacheEntry;

            // Check type and value of the retrieved cache entry
            expect(cacheEntry.type).to.eq(api.CacheEntryType.String, `[variant:${key}] unexpected cache entry type`);
            expect(cacheEntry.key).to.eql(key, `[variant:${key}] unexpected cache entry key name`);
            expect(cacheEntry.as<string>()).to.eql(expected, `[variant:${key}] incorrect substitution`);
            expect(typeof cacheEntry.value).to.eq('string', `[variant:${key}] unexpected cache entry value type`);
        };

        // Check test keys
        await Promise.all(objectPairs(testKeys).map(async testKey => checkTestKey(testKey, cache)));
    }).timeout(100000);

});
