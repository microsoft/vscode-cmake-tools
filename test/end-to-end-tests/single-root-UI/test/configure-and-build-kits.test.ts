import { fs } from '@cmt/pr';
import { TestProgramResult } from '@test/helpers/testprogram/test-program-result';
import {
    clearExistingKitConfigurationFile,
    DefaultEnvironment,
    expect,
    getFirstSystemKit,
    getMatchingSystemKit
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

const workername: string = process.platform;

suite('Build using Kits and Variants', () => {
    let testEnv: DefaultEnvironment;
    let compdb_cp_path: string;

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/single-root-UI/project-folder', build_loc, exe_res);
        compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');

        await vscode.workspace.getConfiguration('cmake', vscode.workspace.workspaceFolders![0].uri).update('useCMakePresets', 'never');
        await vscode.commands.executeCommand('cmake.getSettingsChangePromise');

        // This test will use all on the same kit.
        // No rescan of the tools is needed
        // No new kit selection is needed
        await clearExistingKitConfigurationFile();
        await vscode.commands.executeCommand('cmake.scanForKits');
    });

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const kit = await getFirstSystemKit();
        await vscode.commands.executeCommand('cmake.setKitByName', kit.name);
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
        expect(await vscode.commands.executeCommand('cmake.useCMakePresets', vscode.workspace.workspaceFolders![0])).to.be.eq(false);
        expect(await vscode.commands.executeCommand('cmake.configure')).to.be.eq(0);

        expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
    }).timeout(100000);

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

        await vscode.commands.executeCommand('cmake.setDefaultTarget', undefined, 'runTestTarget');
        expect(await vscode.commands.executeCommand('cmake.build')).to.be.eq(0);

        const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
        const result = await resultFile.getResultAsJson();
        expect(result['cookie']).to.eq('passed-cookie');
    }).timeout(100000);

    test('Test kit switch after missing preferred generator', async function (this: Mocha.Context) {
        // Select compiler build node dependent
        const os_compilers: { [osName: string]: { kitLabel: RegExp; compiler: string }[] } = {
            linux: [{ kitLabel: /^GCC \d/, compiler: 'GNU' }, { kitLabel: /^Clang \d/, compiler: 'Clang' }],
            win32: [{ kitLabel: /^Visual Studio/, compiler: 'MSVC' }, { kitLabel: /^Clang \d/, compiler: 'Clang' }]
        };
        if (!(workername in os_compilers)) {
            this.skip();
        }
        const compiler = os_compilers[workername];

        // Run test
        testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
        await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(undefined, compiler[0].kitLabel)).name);

        await vscode.commands.executeCommand('cmake.build');

        testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
        await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(undefined, compiler[1].kitLabel)).name);

        await vscode.commands.executeCommand('cmake.build');
        const result1 = await testEnv.result.getResultAsJson();
        expect(result1['compiler']).to.eql(compiler[1].compiler);
    }).timeout(100000);

    test('Test kit switch between different preferred generators and compilers',
        async function (this: Mocha.Context) {
            // Select compiler build node dependent
            const os_compilers: { [osName: string]: { kitLabel: RegExp; compiler: string }[] } = {
                linux: [{ kitLabel: /^GCC \d/, compiler: 'GNU' }, { kitLabel: /^Clang \d/, compiler: 'Clang' }],
                win32: [{ kitLabel: /^Visual Studio/, compiler: 'MSVC' }, { kitLabel: /^Clang \d/, compiler: 'Clang' }]
            };
            if (!(workername in os_compilers)) {
                this.skip();
            }
            const compiler = os_compilers[workername];

            testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
            await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(undefined, compiler[0].kitLabel)).name);
            await vscode.commands.executeCommand('cmake.build');

            testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
            await vscode.commands.executeCommand('cmake.setKitByName', (await getMatchingSystemKit(undefined, compiler[1].kitLabel)).name);
            await vscode.commands.executeCommand('cmake.build');

            const result1 = await testEnv.result.getResultAsJson();
            expect(result1['compiler']).to.eql(compiler[1].compiler);
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
