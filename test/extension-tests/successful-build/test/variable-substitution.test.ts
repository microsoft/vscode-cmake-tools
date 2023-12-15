import { CMakeCache, CacheEntryType, CacheEntry } from '@cmt/cache';
import { CMakeProject, ConfigureTrigger } from '@cmt/cmakeProject';
import paths from '@cmt/paths';
import { objectPairs, platformNormalizePath, makeHashString } from '@cmt/util';
import { clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
import * as path from 'path';

suite('Variable Substitution', () => {
    let cmakeProject: CMakeProject;
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', 'build', 'output.txt');
        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}");

        // This test will use all on the same kit.
        // No rescan of the tools is needed
        // No new kit selection is needed
        await clearExistingKitConfigurationFile();
        await cmakeProject.setKit(await getFirstSystemKit());

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await cmakeProject.asyncDispose();
        testEnv.teardown();
    });

    test('Check variable substitution', async () => {
        // Set new settings
        testEnv.config.updatePartial({
            configureSettings: {
                workspaceRoot: '${workspaceRoot}',
                workspaceFolder: '${workspaceFolder}',
                sourceDir: '${sourceDir}',
                workspaceHash: '${workspaceHash}',
                buildType: '${buildType}',
                buildKit: '${buildKit}',
                workspaceRootFolderName: '${workspaceRootFolderName}',
                workspaceFolderBasename: '${workspaceFolderBasename}',
                generator: '${generator}',
                userHome: '${userHome}',
                test1: true,
                test2: 123,
                test3: ["1", "2", "3"],
                test4: {"type": "PATH", "value": "/usr/bin"}
            },
            installPrefix: '${workspaceFolder}/build/dist'
        });

        // Configure
        //expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0, '[workspaceRoot] configure failed');
        await cmakeProject.configureInternal(ConfigureTrigger.runTests);
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
        const cache = await CMakeCache.fromPath(await cmakeProject.cachePath);

        // Check substitution for "workspaceRoot"
        let cacheEntry = cache.get('workspaceRoot') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[workspaceRoot] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('workspaceRoot', '[workspaceRoot] unexpected cache entry key name');
        expect(platformNormalizePath(cacheEntry.as<string>()))
            .to.eq(platformNormalizePath(testEnv.projectFolder.location), '[workspaceRoot] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceRoot] unexpected cache entry value type');

        // Check substitution for "workspaceFolder".
        cacheEntry = cache.get('workspaceFolder') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[workspaceFolder] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('workspaceFolder', '[workspaceFolder] unexpected cache entry key name');
        expect(platformNormalizePath(cacheEntry.as<string>()))
            .to.eq(platformNormalizePath(testEnv.projectFolder.location), '[workspaceFolder] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceFolder] unexpected cache entry value type');

        // Check substitution for "workspaceHash".
        cacheEntry = cache.get('workspaceHash') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[workspaceHash] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('workspaceHash', '[workspaceHash] unexpected cache entry key name');
        expect(cacheEntry.as<string>()).to.eq(makeHashString(testEnv.projectFolder.location), '[workspaceHash] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceHash] unexpected cache entry value type');

        // Check substitution for "buildType".
        cacheEntry = cache.get('buildType') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[buildType] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('buildType', '[buildType] unexpected cache entry key name');
        expect(cacheEntry.as<string>()).to.eq('Debug', '[buildType] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[buildType] unexpected cache entry value type');

        // Check substitution for "buildKit".
        cacheEntry = cache.get('buildKit') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[buildKit] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('buildKit', '[buildKit] unexpected cache entry key name');
        const kit = cmakeProject.activeKit;
        expect(cacheEntry.as<string>()).to.eq(kit!.name, '[buildKit] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[buildKit] unexpected cache entry value type');

        // Check substitution for "workspaceRootFolderName".
        cacheEntry = cache.get('workspaceRootFolderName') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[workspaceRootFolderName] unexpected cache entry type');
        expect(cacheEntry.key)
            .to.eq('workspaceRootFolderName', '[workspaceRootFolderName] unexpected cache entry key name');
        expect(cacheEntry.as<string>())
            .to.eq(path.basename(testEnv.projectFolder.location), '[workspaceRootFolderName] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceRootFolderName] unexpected cache entry value type');

        // Check substitution for "workspaceFolderBasename".
        cacheEntry = cache.get('workspaceFolderBasename') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[workspaceFolderBasename] unexpected cache entry type');
        expect(cacheEntry.key)
            .to.eq('workspaceFolderBasename', '[workspaceFolderBasename] unexpected cache entry key name');
        expect(cacheEntry.as<string>())
            .to.eq(path.basename(testEnv.projectFolder.location), '[workspaceFolderBasename] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[workspaceFolderBasename] unexpected cache entry value type');

        // Check substitution for "generator".
        cacheEntry = cache.get('generator') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[generator] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('generator', '[generator] unexpected cache entry key name');
        const generator = cache.get('CMAKE_GENERATOR') as CacheEntry;
        expect(cacheEntry.as<string>()).to.eq(generator.as<string>(), '[generator] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[generator] unexpected cache entry value type');

        // Check substitution for "userHome".
        cacheEntry = cache.get('userHome') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[userHome] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('userHome', '[userHome] unexpected cache entry key name');
        expect(cacheEntry.as<string>()).to.eq(paths.userHome, '[userHome] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[userHome] unexpected cache entry value type');

        // Check substitution within "cmake.installPrefix".
        cacheEntry = cache.get('CMAKE_INSTALL_PREFIX') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[cmakeInstallPrefix] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('CMAKE_INSTALL_PREFIX', '[cmakeInstallPrefix] unexpected cache entry key name');
        expect(platformNormalizePath(cacheEntry.as<string>()))
            .to.eq(platformNormalizePath(testEnv.projectFolder.buildDirectory.location.concat('/dist')),
                '[cmakeInstallPrefix] substitution incorrect');
        expect(typeof cacheEntry.value).to.eq('string', '[cmakeInstallPrefix] unexpected cache entry value type');

        cacheEntry = cache.get('test1') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.Bool);
        expect(cacheEntry.value).to.eq(true);

        cacheEntry = cache.get('test2') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String);
        expect(cacheEntry.value).to.eq('123');

        cacheEntry = cache.get('test3') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.String);
        expect(cacheEntry.value).to.eq('1;2;3');

        cacheEntry = cache.get('test4') as CacheEntry;
        expect(cacheEntry.type).to.eq(CacheEntryType.Path);
        expect(cacheEntry.value).to.eq('/usr/bin');
    }).timeout(100000);

    test('Check substitution for variant names', async () => {
        // Define test keys and expected values
        const testKeys = { buildType: 'debug-label', otherVariant: 'option1' };

        // Update configure settings
        const configSettings: { [key: string]: string } = {};
        await Promise.all(Object.keys(testKeys).map(async key => configSettings[key] = `\${variant:${key}}`));
        testEnv.config.updatePartial({ configureSettings: configSettings });

        // Configure and retrieve generated cache
        expect((await cmakeProject.configureInternal(ConfigureTrigger.runTests)).result).to.be.eq(0, '[variant] configure failed');
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, '[variant] cache not found');
        const cache = await CMakeCache.fromPath(await cmakeProject.cachePath);

        // Helper function for checking test keys in a cmake cache
        const checkTestKey = async (testKey: [string, string], testCache: CMakeCache) => {
            const [key, expected] = testKey;

            // Get cache entry for given test key
            const cacheEntry = testCache.get(key) as CacheEntry;

            // Check type and value of the retrieved cache entry
            expect(cacheEntry.type).to.eq(CacheEntryType.String, `[variant:${key}] unexpected cache entry type`);
            expect(cacheEntry.key).to.eql(key, `[variant:${key}] unexpected cache entry key name`);
            expect(cacheEntry.as<string>()).to.eql(expected, `[variant:${key}] incorrect substitution`);
            expect(typeof cacheEntry.value).to.eq('string', `[variant:${key}] unexpected cache entry value type`);
        };

        // Check test keys
        await Promise.all(objectPairs(testKeys).map(async testKey => checkTestKey(testKey, cache)));
    }).timeout(100000);

});
