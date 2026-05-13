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
 *
 * Each test suite will have the following tests:
 *  - Run ctest without parallel jobs
 *  - Run ctest with parallel jobs
 *  - Run ctest without parallel jobs. Use test suite delimiter
 *  - Run ctest with parallel jobs. Use test suite delimiter
 */
import { fs } from '@cmt/pr';
import {
    DefaultEnvironment,
    expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommandResult } from 'vscode-cmake-tools';

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
    const tests_dir_macro: string | undefined = used_preset?.['cacheVariables']?.['TESTS_DIR'];
    expect(tests_dir_macro).to.be.a('string').and.not.eq('', "Unable to find the TESTS_DIR cache variable in the configure preset!");
    // TESTS_DIR uses ${sourceDir}, which CMake expands to the directory containing CMakePresets.json
    // (i.e. the project folder). Resolve it manually so we don't drift from the preset when the path changes.
    const test_dir_path = path.normalize(tests_dir_macro!.replace('${sourceDir}', test_env.projectFolder.location));
    if (await fs.exists(test_dir_path)) {
        await fs.rmdir(test_dir_path);
    }
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
 * @returns The test environment
 */
async function commonSetup(configure_preset: string) {
    const build_loc = 'build';
    const exe_res = 'output_test.txt';

    const test_env: DefaultEnvironment = new DefaultEnvironment('test/end-to-end-tests/single-root-ctest/project-folder', build_loc, exe_res);
    try {
        test_env.projectFolder.buildDirectory.clear();

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await waitForSettingsChange();

        const platformPrefix = process.platform === 'win32' ? 'Windows-' : 'Linux-';
        const configurePreset = platformPrefix + configure_preset;
        // Force a real preset switch in case VS Code restored this preset before the driver existed.
        const alternateConfigurePreset = platformPrefix + (configure_preset === '2Successes' ? '2Successes1Failure' : '2Successes');
        await vscode.commands.executeCommand('cmake.setConfigurePreset', alternateConfigurePreset);
        await vscode.commands.executeCommand('cmake.setConfigurePreset', configurePreset);
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
        await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
        await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');

        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
        expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

        return test_env;
    } catch (e) {
        test_env.teardown();
        throw e;
    }
}

async function waitForSettingsChange() {
    // Let VS Code fire the configuration-change event before awaiting CMake Tools' tracked handlers.
    await new Promise(resolve => setTimeout(resolve, 250));
    await vscode.commands.executeCommand('cmake.getSettingsChangePromise');
}

async function updateCTestConfigurationValue<T>(ctestConfiguration: vscode.WorkspaceConfiguration, key: string, value: T | undefined) {
    const currentValue = ctestConfiguration.get<T | null>(key);
    if (currentValue === value || (currentValue === null && value === undefined)) {
        return;
    }

    await ctestConfiguration.update(key, value);
    await waitForSettingsChange();
}

async function updateCTestConfiguration(allowParallelJobs: boolean, testSuiteDelimiter: string | undefined) {
    const ctestConfiguration = vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri);

    await updateCTestConfigurationValue(ctestConfiguration, 'allowParallelJobs', allowParallelJobs);
    await updateCTestConfigurationValue(ctestConfiguration, 'testSuiteDelimiter', testSuiteDelimiter);
}

interface CTestConfigSnapshot {
    allowParallelJobs: boolean | undefined;
    testSuiteDelimiter: string | undefined;
}

/**
 * Captures the workspace-folder values of `cmake.ctest.allowParallelJobs` and
 * `cmake.ctest.testSuiteDelimiter` so they can be restored after the test mutations,
 * leaving the project's checked-in `.vscode/settings.json` untouched.
 */
async function snapshotCTestConfiguration(): Promise<CTestConfigSnapshot> {
    const ctestConfiguration = vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri);
    return {
        allowParallelJobs: ctestConfiguration.inspect<boolean>('allowParallelJobs')?.workspaceFolderValue,
        testSuiteDelimiter: ctestConfiguration.inspect<string>('testSuiteDelimiter')?.workspaceFolderValue
    };
}

/**
 * Restores `cmake.ctest.*` to the values captured by `snapshotCTestConfiguration`. Passing
 * `undefined` to `update` clears the workspace-folder override so the project's checked-in
 * settings.json value takes effect again.
 */
async function restoreCTestConfiguration(snapshot: CTestConfigSnapshot) {
    const ctestConfiguration = vscode.workspace.getConfiguration('cmake.ctest', vscode.workspace.workspaceFolders![0].uri);
    await ctestConfiguration.update('allowParallelJobs', snapshot.allowParallelJobs);
    await ctestConfiguration.update('testSuiteDelimiter', snapshot.testSuiteDelimiter);
    await waitForSettingsChange();
}

// Snapshot captured once before any suite runs and restored once after every suite has finished.
// We intentionally avoid per-suite restoration: changing `cmake.ctest.*` triggers the extension's
// `refreshTests` cascade (see src/extension.ts), which attempts a build. Doing that in `suiteTeardown`
// (after `testEnv.teardown()`) leaves file handles dangling that cause `EBUSY` during the next suite's
// `BuildDirectoryHelper.clear()` on Windows. Restoring once at the very end bounds the cascade to a
// shutdown phase where no later suite is affected.
let initialCTestConfigSnapshot: CTestConfigSnapshot;

suite('CTest end-to-end tests', () => {
    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(30000);
        initialCTestConfigSnapshot = await snapshotCTestConfiguration();
    });

    suiteTeardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        // The settings change fired by the restore triggers `refreshTests` -> `preTest` -> build.
        // Because every suite has torn down its test environment by this point, the build can fail.
        // The on-disk `settings.json` was already updated by `cfg.update` above, so the cascade outcome
        // is irrelevant during shutdown — swallow it here, scoped to this teardown, so it cannot mask
        // failures elsewhere.
        try {
            await restoreCTestConfiguration(initialCTestConfigSnapshot);
        } catch {
            // Intentional: best-effort during global teardown.
        }
    });

    suite('Ctest: 2 successfull tests', () => {
    let testEnv: DefaultEnvironment;
    const usedConfigPreset: string = "2Successes";

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);
        testEnv = await commonSetup(usedConfigPreset);
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
        await updateCTestConfiguration(false, undefined);
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Run ctest without parallel jobs. Use test suite delimiter', async () => {
        await updateCTestConfiguration(false, "\\.");
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs', async () => {
        await updateCTestConfiguration(true, undefined);
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('OK', "Test_b result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs. Use test suite delimiter', async () => {
        await updateCTestConfiguration(true, "\\.");
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.be.eq(0);

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
        testEnv = await commonSetup(usedConfigPreset);
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
        await updateCTestConfiguration(false, undefined);
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest without parallel jobs. Use test suite delimiter', async () => {
        await updateCTestConfiguration(false, "\\.");
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs', async () => {
        await updateCTestConfiguration(true, undefined);
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('OK', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('OK', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs. Use test suite delimiter', async () => {
        await updateCTestConfiguration(true, "\\.");
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

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
        testEnv = await commonSetup(usedConfigPreset);
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
        await updateCTestConfiguration(false, undefined);
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest without parallel jobs. Use test suite delimiter', async () => {
        await updateCTestConfiguration(false, "\\.");
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs', async () => {
        await updateCTestConfiguration(true, undefined);
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);

    test('Run ctest with parallel jobs. Use test suite delimiter', async () => {
        await updateCTestConfiguration(true, "\\.");
        const ctestResult = await vscode.commands.executeCommand<CommandResult>('cmake.ctest');
        expect(ctestResult?.exitCode).to.not.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['test_a']).to.eq('KO', "Test_a result not found in output");
        expect(result['test_b']).to.eq('KO', "Test_b result not found in output");
        expect(result['test_c']).to.eq('KO', "Test_c result not found in output");
    }).timeout(100000);
});
});
