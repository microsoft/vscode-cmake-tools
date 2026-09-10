/* eslint-disable no-unused-expressions */
import { CMakeProject, ConfigureTrigger } from '@cmt/cmakeProject';
import { fs } from '@cmt/pr';
import { TestProgramResult } from '@test/helpers/testprogram/test-program-result';
import { ExtensionConfigurationSettings } from '@cmt/config';
import {
    clearExistingKitConfigurationFile,
    DefaultEnvironment,
    expect,
    getFirstSystemKit,
    getMatchingProjectKit
} from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

const workername: string = process.platform;

suite('Build', () => {
    let cmakeProject: CMakeProject;
    let testEnv: DefaultEnvironment;
    let compdb_cp_path: string;

    suiteSetup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/successful-build/project-folder', build_loc, exe_res);
        compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');
        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}/");

        // This test will use all on the same kit.
        // No rescan of the tools is needed
        // No new kit selection is needed
        await clearExistingKitConfigurationFile();
        await cmakeProject.asyncDispose();
    });

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}/");
        const kit = await getFirstSystemKit();
        await cmakeProject.setKit(kit);
        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(100000);
        await cmakeProject.asyncDispose();
    });

    suiteTeardown(async () => {
        if (testEnv) {
            testEnv.teardown();
        }
        if (await fs.exists(compdb_cp_path)) {
            await fs.unlink(compdb_cp_path);
        }
    });

    test('Configure with cache-initializer', async () => {
        testEnv.config.updatePartial({ cacheInit: 'TestCacheInit.cmake' });
        expect((await cmakeProject.configureInternal(ConfigureTrigger.runTests)).exitCode).to.be.eq(0);
        await cmakeProject.setDefaultTarget('runTestTarget');
        expect((await cmakeProject.build()).exitCode).to.be.eq(0);
        const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
        const result = await resultFile.getResultAsJson();
        expect(result['cookie']).to.eq('cache-init-cookie');
    }).timeout(100000);

    test('Test kit switch between different preferred generators and same compiler',
        async function (this: Mocha.Context) {
            // Select compiler build node dependent
            const os_compilers: { [osName: string]: { kitLabel: RegExp; generator: string }[] } = {
                linux: [
                    { kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles' },
                    { kitLabel: /^Generator switch test GCC Ninja$/, generator: 'Ninja' }
                ],
                win32: [
                    {kitLabel: /^Generator switch test VS 2022/, generator: 'Visual Studio 17 2022'},
                    {kitLabel: /^Generator switch test VS 2022 Ninja/, generator: 'Ninja'}
                ]
            };
            if (!(workername in os_compilers)) {
                this.skip();
            }
            const compiler = os_compilers[workername];

            testEnv.config.updatePartial({ preferredGenerators: [] });
            testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
            await cmakeProject.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));

            let retc = (await cmakeProject.build()).exitCode;
            expect(retc).eq(0);

            testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
            await cmakeProject.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
            retc = (await cmakeProject.build()).exitCode;

            expect(retc).eq(0);
            const result1 = await testEnv.result.getResultAsJson();
            expect(result1['cmake-generator']).to.eql(compiler[1].generator);
        })
        .timeout(100000);

    test('Test kit switch kits after configure', async function (this: Mocha.Context) {
        // Select compiler build node dependent
        const os_compilers: { [osName: string]: { kitLabel: RegExp; generator: string }[] } = {
            linux: [
                { kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles' },
                { kitLabel: /^Generator switch test GCC Ninja$/, generator: 'Ninja' }
            ],
            win32: [
                {kitLabel: /^Generator switch test VS 2022/, generator: 'Visual Studio 17 2022'},
                {kitLabel: /^Generator switch test VS 2022 no generator/, generator: 'Ninja'}
            ]
        };
        if (!(workername in os_compilers)) {
            this.skip();
        }
        const compiler = os_compilers[workername];

        testEnv.config.updatePartial({ preferredGenerators: [] });
        testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
        await cmakeProject.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));
        await cmakeProject.build();

        testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
        await cmakeProject.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
        await cmakeProject.configureInternal(ConfigureTrigger.runTests);

        testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
        await cmakeProject.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));
        await cmakeProject.build();

        const result1 = await testEnv.result.getResultAsJson();
        expect(result1['cmake-generator']).to.eql(compiler[0].generator);
    }).timeout(200000);

    test('Copy compile_commands.json to a pre-determined path', async () => {
        expect(await fs.exists(compdb_cp_path), 'File shouldn\'t be there!').to.be.false;
        const newSettings: Partial<ExtensionConfigurationSettings> = {};
        if (process.platform === 'win32') {
            newSettings.generator = 'Ninja';  // VS generators don't create compile_commands.json
            testEnv.config.updatePartial(newSettings);
        }
        let retc = (await cmakeProject.cleanConfigure(ConfigureTrigger.runTests)).exitCode;
        expect(retc).to.eq(0);
        expect(await fs.exists(compdb_cp_path), 'File still shouldn\'t be there').to.be.false;
        newSettings.copyCompileCommands = compdb_cp_path;
        testEnv.config.updatePartial(newSettings);
        retc = (await cmakeProject.configureInternal(ConfigureTrigger.runTests)).exitCode;
        expect(retc).to.eq(0);
        expect(await fs.exists(compdb_cp_path), 'File wasn\'t copied').to.be.true;
    }).timeout(100000);

    // Regression test for #4794: clicking Run Test / Build with an unsaved CMakeLists.txt used to
    // fail with "Configuration is already in progress". Saving the file (either by the command's own
    // maybeAutoSaveAll() or by VS Code's testing.saveBeforeStart) fires the save-watcher, which
    // started a redundant automatic reconfigure that raced the command's own configure. The watcher
    // reconfigure is now (a) suppressed outright during a command-initiated save, (b) debounced so
    // an imminent build/test/configure command can take ownership before it runs, and (c) cancelled
    // outright the moment any command-initiated configure begins.
    test('automatic reconfigure after a CMake file save yields to command-initiated configures (#4794)', async () => {
        testEnv.config.updatePartial({ configureOnEdit: true });
        // Ensure the project is configured so a driver (and its cmakeFiles list) exists.
        expect((await cmakeProject.configureInternal(ConfigureTrigger.runTests)).exitCode).to.eq(0);

        const cmakeListsUri = vscode.Uri.file(path.join(testEnv.projectFolder.location, 'CMakeLists.txt'));
        // Comfortably longer than the 500ms automatic-reconfigure debounce.
        const waitPastDebounce = () => new Promise<void>(resolve => setTimeout(resolve, 2000));

        let reconfigures = 0;
        const sub = cmakeProject.onReconfigured(() => {
            reconfigures++;
        });
        try {
            // A command-initiated save (flag set by maybeAutoSaveAll) must not auto-reconfigure at all.
            (cmakeProject as any)._suppressCMakeFileReconfigure = true;
            await cmakeProject.doCMakeFileChangeReconfigure(cmakeListsUri);
            await waitPastDebounce();
            expect(reconfigures).to.eq(0, 'a command-initiated save must not trigger the watcher reconfigure');

            // If a command takes ownership after a normal save has already scheduled the debounced
            // reconfigure, the scheduled reconfigure must be skipped when its timer fires.
            (cmakeProject as any)._suppressCMakeFileReconfigure = false;
            await cmakeProject.doCMakeFileChangeReconfigure(cmakeListsUri); // schedules the debounced reconfigure
            (cmakeProject as any)._suppressCMakeFileReconfigure = true;     // command now owns the configure
            await waitPastDebounce();
            expect(reconfigures).to.eq(0, 'a scheduled reconfigure must yield once a command owns the configure');

            // A command-initiated configure must cancel a pending (already scheduled) automatic
            // reconfigure. This is what makes the Test Explorer flow deterministic rather than a timing
            // bet: VS Code's testing.saveBeforeStart schedules the reconfigure, then the test's configure
            // runs and cancels it — regardless of how long the debounce is (#4794).
            (cmakeProject as any)._suppressCMakeFileReconfigure = false;
            await cmakeProject.doCMakeFileChangeReconfigure(cmakeListsUri); // schedules the debounced reconfigure
            expect((cmakeProject as any).automaticReconfigureTimer, 'a normal save should schedule the debounced reconfigure').to.not.be.undefined;
            expect((await cmakeProject.configureInternal(ConfigureTrigger.runTests)).exitCode).to.eq(0);
            expect((cmakeProject as any).automaticReconfigureTimer, 'a command-initiated configure must cancel the pending automatic reconfigure').to.be.undefined;
            await waitPastDebounce();

            // A plain user save (no command in flight) still auto-reconfigures after the debounce.
            const reconfiguresBeforePlainSave = reconfigures;
            const reconfigured = new Promise<void>(resolve => {
                const once = cmakeProject.onReconfigured(() => {
                    once.dispose();
                    resolve();
                });
            });
            await cmakeProject.doCMakeFileChangeReconfigure(cmakeListsUri);
            await reconfigured;
            expect(reconfigures).to.be.greaterThan(reconfiguresBeforePlainSave, 'a normal user save should still trigger an automatic reconfigure');
        } finally {
            sub.dispose();
        }
    }).timeout(120000);
});
