import { fs } from '@cmt/pr';
import {
    clearExistingKitConfigurationFile,
    DefaultEnvironment,
    expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Preset include functionality', () => {
    let testEnv: DefaultEnvironment;
    let compdb_cp_path: string;

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        // CMakePresets.json and CMakeUserPresets.json exist so will use presets by default
        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-UI/project-folder', build_loc, exe_res);
        compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'Linux1');
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
        await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
        await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');

        await clearExistingKitConfigurationFile();
    });

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
    });

    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'auto');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        if (testEnv) {
            testEnv.teardown();
        }
        if (await fs.exists(compdb_cp_path)) {
            await fs.unlink(compdb_cp_path);
        }
    });

    test('Configure and build included preset 1', async function (this: Mocha.Context) {
        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'LinuxIncluded1');
        await vscode.commands.executeCommand('cmake.build');

        const result = await testEnv.result.getResultAsJson();
        expect(result['cookie']).to.eq('passed-cookie');
    }).timeout(100000);

    test('Configure and build included preset 2', async function (this: Mocha.Context) {
        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'LinuxIncluded2');
        await vscode.commands.executeCommand('cmake.build');

        const result = await testEnv.result.getResultAsJson();
        expect(result['cookie']).to.eq('passed-cookie');
    }).timeout(100000);

    test('Configure CMakeUserPreset inheriting from CMakePreset', async function (this: Mocha.Context) {
        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'TestInheritFromPreset');
        expect(await vscode.commands.executeCommand('cmake.showConfigureCommand')).to.be.eq(0);
    }).timeout(100000);
});
