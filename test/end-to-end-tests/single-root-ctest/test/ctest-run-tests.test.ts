import { fs } from '@cmt/pr';
import {
    DefaultEnvironment,
    expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';
import paths from '@cmt/paths';

suite('Ctest run tests', () => {
    let testEnv: DefaultEnvironment;

    async function cleanUpTestResultFiles() {
        const file_a_path: string = path.join(paths.tmpDir, 'test_a.txt');
        if (await fs.exists(file_a_path)) {
            await fs.unlink(file_a_path);
        }
        const file_b_path: string = path.join(paths.tmpDir, 'test_b.txt');
        if (await fs.exists(file_b_path)) {
            await fs.unlink(file_b_path);
        }
        const output_test_path: string = path.join(testEnv.projectFolder.location, testEnv.buildLocation, testEnv.executableResult);
        if (await fs.exists(output_test_path)) {
            await fs.unlink(output_test_path);
        }
    }

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output_test.txt';

        // CMakePresets.json exist so will use presets by default
        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-ctest/project-folder', build_loc, exe_res);
        testEnv.projectFolder.buildDirectory.clear();

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'Linux1');
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
        await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
        await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');

        await vscode.commands.executeCommand('cmake.build');
    });

    setup(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles();
    });

    teardown(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles();
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
    });

    test('Test of ctest without parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Test of ctest without parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Test of ctest with parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Test of ctest with parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);
});
