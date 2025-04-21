import { fs } from '@cmt/pr';
import { TestProgramResult } from '@test/helpers/testprogram/test-program-result';
import {
    clearExistingKitConfigurationFile,
    DefaultEnvironment,
    expect
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Build using Presets', () => {
    let testEnv: DefaultEnvironment;
    let compdb_cp_path: string;

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        // CMakePresets.json and CMakeUserPresets.json exist so will use presets by default
        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-UI/project-folder', build_loc, exe_res);
        compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');

        await clearExistingKitConfigurationFile();
    });

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'always');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'Linux1');
        await vscode.commands.executeCommand('cmake.setBuildPreset', '__defaultBuildPreset__');
        await vscode.commands.executeCommand('cmake.setTestPreset', '__defaultTestPreset__');
        await vscode.commands.executeCommand('cmake.setPackagePreset', '__defaultPackagePreset__');
        await vscode.commands.executeCommand('cmake.setWorkflowPreset', '__defaultWorkflowPreset__');

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
        if (await fs.exists(compdb_cp_path)) {
            await fs.unlink(compdb_cp_path);
        }
    });

    test('Configure', async () => {
        expect(await vscode.commands.executeCommand('cmake.useCMakePresets', vscode.workspace.workspaceFolders![0])).to.be.eq(true);

        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');

        // Read and parse the codemodel JSON file
        const replyDir = path.join(testEnv.projectFolder.buildDirectory.location, '.cmake', 'api', 'v1', 'reply');
        const files = await fs.readdir(replyDir);
        const codemodelFile = files.find(file => file.startsWith('codemodel'));
        if (!codemodelFile) {
            throw new Error('Codemodel file not found');
        }
        const codemodelPath = path.join(replyDir, codemodelFile);
        const codemodelContent = await fs.readFile(codemodelPath, 'utf8');
        const codemodel = JSON.parse(codemodelContent);

        // Extract the number of targets
        const targets = codemodel.configurations[0].targets;
        const numberOfTargets = targets.length;

        // Check if the number of targets is as expected
        expect(numberOfTargets).to.be.eq(33, `Expected 33 targets, but found ${numberOfTargets}`);

        // Verify the number of target files created in the CMake File API response directory
        const targetFiles = files.filter(file => file.startsWith('target'));
        const numberOfTargetFiles = targetFiles.length;
        expect(numberOfTargetFiles).to.be.eq(33, `Expected 33 target files, but found ${numberOfTargetFiles}`);
    }).timeout(100000);

    // from v3 on configure presets are not required to have a generator defined
    test('Configure >=v3 no fallback generator', async () => {
        await vscode.commands.executeCommand('cmake.setConfigurePreset', 'NoGenerator');
        expect(await vscode.commands.executeCommand('cmake.showConfigureCommand')).to.be.eq(0);

        // make sure that cmake configure was not invoked with the -G (Generator) flag by checking the logs
        const logDocuments = vscode.workspace.textDocuments.filter(document => document.languageId === 'Log');
        expect(logDocuments).lengthOf(1);
        const lines = logDocuments[0].getText().split('\n');
        for (const line of lines) {
            if (line.startsWith('[cmakefileapi-driver]')) {
                expect(line).not.contain('-G');
            }
        }

    });

    test('Build', async () => {
        expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['cookie']).to.eq('passed-cookie');
    }).timeout(100000);

    test('Configure and Build', async () => {
        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);
        expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

        const result = await testEnv.result.getResultAsJson();
        expect(result['cookie']).to.eq('passed-cookie');
    }).timeout(100000);

    test('Configure and Build run target', async () => {
        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);

        expect(await vscode.commands.executeCommand('cmake.build', undefined, 'runTestTarget')).to.be.eq(0);

        const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
        const result = await resultFile.getResultAsJson();
        expect(result['cookie']).to.eq('passed-cookie');
    }).timeout(100000);

    test('Test preset switch',
        async function (this: Mocha.Context) {
            await vscode.commands.executeCommand('cmake.build');

            await vscode.commands.executeCommand('cmake.setConfigurePreset', process.platform === 'win32' ? 'WindowsUser1' : 'LinuxUser1');
            await vscode.commands.executeCommand('cmake.build');

            const result = await testEnv.result.getResultAsJson();
            expect(result['cookie']).to.eq('passed-cookie');
        })
        .timeout(100000);

    test('Test build twice', async function (this: Mocha.Context) {
        console.log('1. Build');
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
        console.log('2. Build');
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
        await testEnv.result.getResultAsJson();
    }).timeout(100000);

    test('Test build twice with clean', async function (this: Mocha.Context) {
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
        await vscode.commands.executeCommand('cmake.clean');
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
        await testEnv.result.getResultAsJson();
    }).timeout(100000);

    test('Test build twice with clean configure', async function (this: Mocha.Context) {
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanConfigure');
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);

        await testEnv.result.getResultAsJson();
    }).timeout(100000);

    test('Test build twice with rebuild configure', async function (this: Mocha.Context) {
        // Select compiler build node dependent
        await vscode.commands.executeCommand('cmake.build');
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanRebuild');
        expect(await vscode.commands.executeCommand('cmake.build')).eq(0);

        await testEnv.result.getResultAsJson();
    }).timeout(100000);

    test('Test -all version of commands', async function (this: Mocha.Context) {
        // Run build twice first
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await vscode.commands.executeCommand('cmake.clean');
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanAll');
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanConfigure');
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanConfigureAll');
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanRebuild');
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await vscode.commands.executeCommand('cmake.cleanRebuildAll');
        expect(await vscode.commands.executeCommand('cmake.buildAll')).eq(0);
        await testEnv.result.getResultAsJson();
    }).timeout(400000);
});
