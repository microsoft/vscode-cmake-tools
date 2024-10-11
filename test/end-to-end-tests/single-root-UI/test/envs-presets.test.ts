import { CMakeCache, CacheEntryType } from '@cmt/cache';
import { DefaultEnvironment, expect } from '@test/util';
import * as vscode from 'vscode';

suite('Environment Variables in Presets', () => {
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-UI/project-folder', build_loc, exe_res);
        testEnv.projectFolder.buildDirectory.clear();

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        await vscode.commands.executeCommand('cmake.setConfigurePreset', process.platform === 'win32' ? 'WindowsUser1' : 'LinuxUser1');
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
        await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
        await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);

        testEnv.projectFolder.buildDirectory.clear();
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
