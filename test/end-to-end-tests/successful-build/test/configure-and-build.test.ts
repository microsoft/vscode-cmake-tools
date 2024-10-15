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
        expect((await cmakeProject.configureInternal(ConfigureTrigger.runTests)).result).to.be.eq(0);
        await cmakeProject.setDefaultTarget('runTestTarget');
        expect(await cmakeProject.build()).to.be.eq(0);
        const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
        const result = await resultFile.getResultAsJson();
        expect(result['cookie']).to.eq('cache-init-cookie');
    }).timeout(100000);

    // test('Test kit switch after missing preferred generator #512', async function (this: Mocha.Context) {
    //     // Select compiler build node dependent
    //     const os_compilers: { [osName: string]: { kitLabel: RegExp; generator: string }[] } = {
    //         linux: [
    //             { kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles' },
    //             { kitLabel: /^Generator switch test GCC no generator$/, generator: '' }
    //         ],
    //         win32: [
    //             {kitLabel: /^Generator switch test VS 2019/, generator: 'Visual Studio 16 2019'},
    //             {kitLabel: /^Generator switch test VS 2019 no generator/, generator: ''}
    //         ]
    //     };
    //     if (!(workername in os_compilers)) {
    //         this.skip();
    //     }
    //     // Remove all preferred generator (Remove config dependenies, auto detection)
    //     testEnv.config.updatePartial({ preferredGenerators: [] });
    //     const compiler = os_compilers[workername];

    //     // Run configure kit
    //     testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    //     await cmakeProject.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));
    //     await cmakeProject.build();

    //     // Run Configure kit without preferred generator
    //     testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    //     await cmakeProject.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
    //     await cmakeProject.build();
    //     // Keep result1 for a later comparison
    //     const result1 = await testEnv.result.getResultAsJson();

    //     // Test return to previous kit
    //     testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    //     await cmakeProject.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));
    //     await cmakeProject.build();

    //     const result2 = await testEnv.result.getResultAsJson();
    //     expect(result2['cmake-generator']).to.eql(compiler[0].generator);

    //     // result1 (for no preferred generator given) should be the same as
    //     // a list of default preferred generators: Ninja + Unix Makefiles.
    //     // These defaults take effect only when no other preferred generator
    //     // is deduced from other sources: settings (cmake.generator, cmake.preferredGenerators)
    //     // or kits preferred generator in cmake-tools-kits.json.
    //     testEnv.config.updatePartial({ preferredGenerators: ["Ninja", "Unix Makefiles"] });
    //     testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    //     await cmakeProject.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
    //     await cmakeProject.build();

    //     const result3 = await testEnv.result.getResultAsJson();
    //     expect(result1['cmake-generator']).to.eql(result3['cmake-generator']);
    // }).timeout(100000);

    test('Test kit switch between different preferred generators and same compiler',
        async function (this: Mocha.Context) {
            // Select compiler build node dependent
            const os_compilers: { [osName: string]: { kitLabel: RegExp; generator: string }[] } = {
                linux: [
                    { kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles' },
                    { kitLabel: /^Generator switch test GCC Ninja$/, generator: 'Ninja' }
                ],
                win32: [
                    {kitLabel: /^Generator switch test VS 2019/, generator: 'Visual Studio 16 2019'},
                    {kitLabel: /^Generator switch test VS 2019 Ninja/, generator: 'Ninja'}
                ]
            };
            if (!(workername in os_compilers)) {
                this.skip();
            }
            const compiler = os_compilers[workername];

            testEnv.config.updatePartial({ preferredGenerators: [] });
            testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
            await cmakeProject.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));

            let retc = await cmakeProject.build();
            expect(retc).eq(0);

            testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
            await cmakeProject.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
            retc = await cmakeProject.build();

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
                {kitLabel: /^Generator switch test VS 2019/, generator: 'Visual Studio 16 2019'},
                {kitLabel: /^Generator switch test VS 2019 no generator/, generator: 'Ninja'}
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
        let retc = (await cmakeProject.cleanConfigure(ConfigureTrigger.runTests)).result;
        expect(retc).to.eq(0);
        expect(await fs.exists(compdb_cp_path), 'File still shouldn\'t be there').to.be.false;
        newSettings.copyCompileCommands = compdb_cp_path;
        testEnv.config.updatePartial(newSettings);
        retc = (await cmakeProject.configureInternal(ConfigureTrigger.runTests)).result;
        expect(retc).to.eq(0);
        expect(await fs.exists(compdb_cp_path), 'File wasn\'t copied').to.be.true;
    }).timeout(100000);
});
