import { fs } from '@cmt/pr';
import {
    clearExistingKitConfigurationFile,
    DefaultEnvironment,
    expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';
import paths from '@cmt/paths';

suite('Ctest run tests', () => {
    let testEnv: DefaultEnvironment;
    let compdb_cp_path: string;

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output_test.txt';

        // CMakePresets.json and CMakeUserPresets.json exist so will use presets by default
        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-ctest/project-folder', build_loc, exe_res);
        compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');

        await clearExistingKitConfigurationFile();
    });

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');

        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'Linux1');
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
        await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
        await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');

        await vscode.commands.executeCommand('cmake.build');
    });

    teardown(async function (this: Mocha.Context) {
        await fs.unlink(path.join(paths.tmpDir, 'test_a.txt'));
        await fs.unlink(path.join(paths.tmpDir, 'test_b.txt'));
        await fs.unlink(path.join(testEnv.projectFolder.location, testEnv.buildLocation, testEnv.executableResult));
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
        if (await fs.exists(compdb_cp_path)) {
            await fs.unlink(compdb_cp_path);
        }
    });

    test('Test of ctest without parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK');
        expect(result['test_b']).to.eq('OK');
    }).timeout(100000);

    test('Test of ctest without parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', ".");
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK');
        expect(result['test_b']).to.eq('OK');
    }).timeout(100000);

    test('Test of ctest with parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK');
        expect(result['test_b']).to.eq('OK');
    }).timeout(100000);

    test('Test of ctest with parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', ".");
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK');
        expect(result['test_b']).to.eq('OK');
    }).timeout(100000);
});
