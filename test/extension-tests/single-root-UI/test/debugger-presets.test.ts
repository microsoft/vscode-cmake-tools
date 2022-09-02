import { DefaultEnvironment, expect } from '@test/util';
import * as vscode from 'vscode';

suite('Debug/Launch interface using Presets', () => {
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/extension-tests/single-root-UI/project-folder', build_loc, exe_res);
        testEnv.projectFolder.buildDirectory.clear();

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        await vscode.commands.executeCommand('cmake.setConfigurePreset', process.platform === 'win32' ? 'WindowsUser1' : 'LinuxUser1');
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');

        expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        testEnv.teardown();
    });

    test('Test call of debugger', async () => {
        const executablesTargets = await vscode.commands.executeCommand('cmake.executableTargets') as string[];
        expect(executablesTargets.length).to.be.not.eq(0);
        await vscode.commands.executeCommand('cmake.selectLaunchTarget', undefined, executablesTargets[0]);

        await vscode.commands.executeCommand('cmake.debugTarget');
    }).timeout(60000);
});
