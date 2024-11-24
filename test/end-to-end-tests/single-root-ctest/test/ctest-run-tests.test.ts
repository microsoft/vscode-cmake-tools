/**
 * This test suite will test the ctest command with different test results.
 *
 * Each test suite is defined in the project-folder's CMakePresets.json file through CMake cache variables:
 *  - TESTS_DIR: The directory where the test results will be stored
 *  - TESTS_OUTPUT_FILES: A list of file names that will contain the test results
 *  - TESTS_NAMES: A list of names of the tests to run
 *  - TESTS_SUCCESS: A list of the expected results of the tests
 *
 * All of those lists should have the same size.
 *
 * Each invocation of the ctest command will run the tests defined in the TESTS_NAMES list, storing their TESTS_OUTPUT_FILES
 * in the TESTS_DIR directory and will make the test command ends according to the TESTS_SUCCESS list.
 * After each invocation of the ctest command, the test results will be concatenated in the output_test.txt file in JSon format so that
 * the test suite can check the results.
 */
import { fs } from '@cmt/pr';
import {
    DefaultEnvironment,
    expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';
import paths from '@cmt/paths';

/**
 * Given a CMakePresets.json content, this function will return the configure preset with the given name
 *
 * @param presets_content: The content of the CMakePresets.json file as a JSON object
 * @param preset_name: The name of the configure preset to find
 * @returns The configure preset with the given name or undefined if not found
 */
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

/**
 * This function removes the test result files and the test directory
 */
async function cleanUpTestResultFiles(test_env: DefaultEnvironment, configure_preset: string) {
    const used_preset = await getSpecificPreset(await getCMakePresetsAsJson(test_env), configure_preset);
    expect(used_preset['cacheVariables']['TESTS_DIR']).to.not.eq('', "Unable to find the TESTS_DIR cache variable in the configure preset!");
    const test_dir_path = used_preset['cacheVariables']['TESTS_DIR'];
    expect("/" + test_dir_path.split('/')[1]).to.eq(paths.tmpDir, `WARNING: The TESTS_DIR variable (${test_dir_path}) does not seem to point to the temporary directory (${paths.tmpDir})!`);
    await fs.rmdir(test_dir_path);
    const output_test_path: string = path.join(test_env.projectFolder.location, test_env.buildLocation, test_env.executableResult);
    if (await fs.exists(output_test_path)) {
        await fs.unlink(output_test_path);
    }
}

/**
 *
 * @returns The content of the CMakePresets.json file as a JSON object
 */
async function getCMakePresetsAsJson(test_env: DefaultEnvironment) {
    const preset_location: string = path.join(test_env.projectFolder.location, "CMakePresets.json");
    expect(fs.existsSync(preset_location)).to.eq(true, `CMakePresets.json file ${preset_location} was not found`);
    const content = await fs.readFile(preset_location);
    expect(content.toLocaleString()).to.not.eq('');
    return JSON.parse(content.toString());
}

/**
 * This function will setup the test environment by setting the configure, build, test, package and workflow presets
 * before building the project
 *
 * @param configure_preset: The name of the configure preset to use
 */
async function commonSetup(configure_preset: string) {
    await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
    await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

    await vscode.commands.executeCommand('cmake.setConfigurePreset', configure_preset);
    await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
    await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
    await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
    await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');

    await vscode.commands.executeCommand('cmake.build');
}

suite('Ctest: 2 successfull tests', () => {
    let testEnv: DefaultEnvironment;
    const usedConfigPreset: string = "2Successes";

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output_test.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-ctest/project-folder', build_loc, exe_res);
        testEnv.projectFolder.buildDirectory.clear();

        await commonSetup(usedConfigPreset);
    });

    setup(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles(testEnv, usedConfigPreset);
    });

    teardown(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles(testEnv, usedConfigPreset);
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
    });

    test('Run ctest without parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Run ctest without parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);
});

suite('Ctest: 2 successfull tests 1 failing test', () => {
    let testEnv: DefaultEnvironment;
    const usedConfigPreset: string = "2Successes1Failure";

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output_test.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-ctest/project-folder', build_loc, exe_res);
        testEnv.projectFolder.buildDirectory.clear();

        await commonSetup(usedConfigPreset);
    });

    setup(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles(testEnv, usedConfigPreset);
    });

    teardown(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles(testEnv, usedConfigPreset);
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
    });

    test('Run ctest without parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest without parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);
});

suite('Ctest: 3 failing tests', () => {
    let testEnv: DefaultEnvironment;
    const usedConfigPreset: string = "3Failures";

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output_test.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-ctest/project-folder', build_loc, exe_res);
        testEnv.projectFolder.buildDirectory.clear();

        await commonSetup(usedConfigPreset);
    });

    setup(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles(testEnv, usedConfigPreset);
    });

    teardown(async function (this: Mocha.Context) {
        await cleanUpTestResultFiles(testEnv, usedConfigPreset);
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
    });

    test('Run ctest without parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest without parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', false);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', undefined);
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs. Use test suite delimiter', async () => {
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('allowParallelJobs', true);
        await vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri).update('testSuiteDelimiter', "\\.");
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
        expect(await vscode.commands.executeCommand('cmake.ctest')).to.be.eq(-1);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);
});
