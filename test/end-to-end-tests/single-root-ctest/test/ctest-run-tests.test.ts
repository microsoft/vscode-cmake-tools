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
    const usedConfigPreset: string = "AllTestsSuccessfull";

    async function getCMakePresetsAsJson() {
        const preset_location: string = path.join(testEnv.projectFolder.location, "CMakePresets.json");
        expect(fs.existsSync(preset_location)).to.eq(true, `CMakePresets.json file ${ preset_location } was not found`);
        const content = fs.readFile(preset_location);
        expect(content.toLocaleString()).to.not.eq('');
        return JSON.parse(content.toString());
    }

    async function getSpecificPreset(presets_content: any, preset_name: string) {
        expect(presets_content['configurePresets']).to.not.eq('', "Unable to find configurePresets section!");
        const all_conf_presets = presets_content['configurePresets'];
        for (let index = 0; index < all_conf_presets.length; index++) {
            const conf_preset = all_conf_presets[index];
            expect(conf_preset['name']).to.not.eq('', "Unable to find name of the current configure preset!");
            if (conf_preset['name'] === preset_name) {
                return conf_preset;
            }
        }
        return undefined;
    }

    async function cleanUpTestResultFiles() {
        const used_preset = await getSpecificPreset(await getCMakePresetsAsJson(), usedConfigPreset);
        expect(used_preset['cacheVariables']['TESTS_DIR']).to.not.eq('', "Unable to find the TESTS_DIR cache variable in the configure preset!");
        expect(used_preset['cacheVariables']['TESTS_DIR'].split('/')[0]).to.eq(paths.tmpDir, "WARNING: The TEST_DIR variable does not seem to point to the temporary directory!");
        const tests_dir_name = used_preset['cacheVariables']['TESTS_DIR'].split('/')[-1];
        console.log("tests_dir_name is %s", tests_dir_name);
        const test_dir: string = path.join(paths.tmpDir, "vscode-cmake-tools-tests");
        await fs.rmdir(test_dir);
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

        await vscode.commands.executeCommand('cmake.setConfigurePreset', usedConfigPreset);
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
