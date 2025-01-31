import { DefaultEnvironment, expect } from '@test/util';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// From vscode: src/vs/workbench/contrib/testing/common/testTypes.ts
const enum TestResultState {
    Unset = 0,
    Queued = 1,
    Running = 2,
    Passed = 3,
    Failed = 4,
    Skipped = 5,
    Errored = 6
};

suite('Coverage integration', () => {
    let testEnv: DefaultEnvironment;

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-UI/project-folder', build_loc, exe_res);

        if (process.platform === 'win32') {
            // MSVC compiler does not produce gcov based coverage data
            return this.skip();
        }

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        testEnv.projectFolder.buildDirectory.clear();
        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'LinuxUser2');
        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
        expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);
    });

    suiteTeardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        testEnv.teardown();
    });

    test('Bad Run test with coverage', async () => {
        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('preRunCoverageTarget', 'non-existing-target');

        let testResult: any = await vscode.commands.executeCommand('testing.coverage.uri', vscode.Uri.file(testEnv.projectFolder.location));
        expect(testResult['tasks'][0].hasCoverage).to.be.eq(false);
        expect(testResult['items'][2].computedState).to.be.eq(TestResultState.Unset);

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('preRunCoverageTarget', 'init-target');
        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('postRunCoverageTarget', 'non-existing-target');

        testResult = await vscode.commands.executeCommand('testing.coverage.uri', vscode.Uri.file(testEnv.projectFolder.location));
        if (testResult !== undefined) {
            // May or may not be undefined in this case evidently based on platform
            expect(testResult['tasks'][0].hasCoverage).to.be.eq(false);
            expect(testResult['items'][2].computedState).to.be.eq(TestResultState.Unset);
        }
    }).timeout(60000);

    test('Good Run test with coverage', async () => {
        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('preRunCoverageTarget', 'init-coverage');
        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('postRunCoverageTarget', 'capture-coverage');

        const testResult: any = await vscode.commands.executeCommand('testing.coverage.uri', vscode.Uri.file(testEnv.projectFolder.location));
        expect(testResult['tasks'][0].hasCoverage).to.be.eq(true);
        expect(testResult['items'][2].computedState).to.be.eq(TestResultState.Passed);
        expect(fs.existsSync(path.join(testEnv.projectFolder.location, testEnv.buildLocation, 'lcov.info'))).to.be.true;
    }).timeout(60000);
});
