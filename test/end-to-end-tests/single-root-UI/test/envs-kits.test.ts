import { CMakeCache, CacheEntryType } from '@cmt/cache';
import { clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
import { fs } from '@cmt/pr';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Environment Variables in Variants', () => {
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-UI/project-folder', build_loc, exe_res);

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'never');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        // This test will use all on the same kit.
        // No rescan of the tools is needed
        // No new kit selection is needed
        await clearExistingKitConfigurationFile();

        const kit = await getFirstSystemKit();
        await vscode.commands.executeCommand('cmake.setKitByName', kit.name);

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'auto');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        const variantFileBackup = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
        if (await fs.exists(variantFileBackup)) {
            const variantFile = path.join(testEnv.projectFolder.location, '.vscode', 'cmake-variants.json');
            await fs.rename(variantFileBackup, variantFile);
        }

        testEnv.teardown();
    });

    test('Check for environment variables being passed to configure', async () => {
        // Set fake settings
        // Configure
        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0, '[variantEnv] configure failed');
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'expected cache not present');
        const cache = await CMakeCache.fromPath(testEnv.projectFolder.buildDirectory.cmakeCachePath);

        const cacheEntry_ = cache.get('variantEnv');
        expect(cacheEntry_).to.not.be.eq(null, '[variantEnv] Cache entry was not present');
        const cacheEntry = cacheEntry_!;
        expect(cacheEntry.type).to.eq(CacheEntryType.String, '[variantEnv] unexpected cache entry type');
        expect(cacheEntry.key).to.eq('variantEnv', '[variantEnv] unexpected cache entry key name');
        expect(typeof cacheEntry.value).to.eq('string', '[variantEnv] unexpected cache entry value type');
        expect(cacheEntry.as<string>()).to.eq('0cbfb6ae-f2ec-4017-8ded-89df8759c502', '[variantEnv] incorrect environment variable');
    }).timeout(100000);
});
