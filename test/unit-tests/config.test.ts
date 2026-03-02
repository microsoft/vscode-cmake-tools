import { ConfigurationReader, ExtensionConfigurationSettings } from '@cmt/config';
import { expect } from '@test/util';

function createConfig(conf: Partial<ExtensionConfigurationSettings>): ConfigurationReader {
    const ret = new ConfigurationReader({
        autoSelectActiveFolder: false,
        defaultActiveFolder: null,
        exclude: [],
        cmakePath: '',
        buildDirectory: '',
        installPrefix: null,
        sourceDirectory: '',
        saveBeforeBuild: true,
        buildBeforeRun: true,
        clearOutputBeforeBuild: true,
        configureSettings: {},
        cacheInit: null,
        preferredGenerators: [],
        generator: null,
        toolset: null,
        platform: null,
        configureArgs: [],
        buildArgs: [],
        buildToolArgs: [],
        parallelJobs: 0,
        ctestPath: '',
        cpackPath: '',
        ctest: {
            parallelJobs: 0,
            allowParallelJobs: false,
            testExplorerIntegrationEnabled: true,
            testSuiteDelimiter: '',
            testSuiteDelimiterMaxOccurrence: 0,
            failurePatterns: [],
            debugLaunchTarget: null
        },
        parseBuildDiagnostics: true,
        enabledOutputParsers: [],
        debugConfig: {},
        defaultVariants: {},
        ctestArgs: [],
        cpackArgs: [],
        ctestDefaultArgs: [],
        environment: {},
        configureEnvironment: {},
        buildEnvironment: {},
        testEnvironment: {},
        cpackEnvironment: {},
        mingwSearchDirs: [], // Deprecated in 1.14, replaced by additionalCompilerSearchDirs, but kept for backwards compatibility
        additionalCompilerSearchDirs: [],
        emscriptenSearchDirs: [],
        mergedCompileCommands: null,
        copyCompileCommands: null,
        loadCompileCommands: true,
        configureOnOpen: true,
        configureOnEdit: true,
        deleteBuildDirOnCleanConfigure: false,
        skipConfigureIfCachePresent: null,
        useCMakeServer: true,
        cmakeCommunicationMode: 'automatic',
        showSystemKits: true,
        ignoreKitEnv: false,
        additionalKits: [],
        pinnedCommands: [],
        buildTask: false,
        outputLogEncoding: 'auto',
        enableTraceLogging: false,
        loggingLevel: 'info',
        touchbar: {
            visibility: "default"
        },
        options: {
            advanced: {},
            statusBarVisibility: "visible"
        },
        useCMakePresets: 'never',
        useVsDeveloperEnvironment: 'auto',
        allowCommentsInPresetsFile: false,
        allowUnsupportedPresetsVersions: false,
        launchBehavior: 'reuseTerminal',
        ignoreCMakeListsMissing: false,
        automaticReconfigure: false,
        enableAutomaticKitScan: true,
        enableLanguageServices: true,
        preRunCoverageTarget: null,
        postRunCoverageTarget: null,
        coverageInfoFiles: [],
        useFolderPropertyInBuildTargetDropdown: true,
        setBuildTargetSameAsLaunchTarget: false,
        additionalBuildProblemMatchers: []
    });
    ret.updatePartial(conf);
    return ret;
}

suite('Configuration', () => {
    test('Create a read from a configuration', () => {
        const conf = createConfig({ parallelJobs: 13 });
        expect(conf.parallelJobs).to.eq(13);
    });

    test('Update a configuration', () => {
        const conf = createConfig({ parallelJobs: 22 });
        expect(conf.parallelJobs).to.eq(22);
        conf.updatePartial({ parallelJobs: 4 });
        expect(conf.parallelJobs).to.eq(4);
    });

    test('Listen for config changes', async () => {
        const conf = createConfig({ parallelJobs: 22 });
        let jobs = conf.parallelJobs;
        expect(jobs).to.eq(22);
        await new Promise<void>(resolve => {
            conf.onChange('parallelJobs', j => {
                jobs = j;
                resolve();
            });
            conf.updatePartial({ parallelJobs: 3 });
        });
        expect(jobs).to.eq(3);
    });

    async function didItComplete(promise: Promise<any>, timeout: number): Promise<boolean> {
        try {
            await new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                    reject();
                }, timeout);
                void promise.then(() => {
                    resolve();
                });
            });
            return true;
        } catch {
            return false;
        }
    }

    test('Listen only fires for changing properties', async () => {
        const conf = createConfig({ parallelJobs: 3 });
        let changed = new Promise<void>(_ => {});  // never resolves
        conf.onChange('parallelJobs', _ => {
            changed = Promise.resolve();    // resolved
        });
        conf.updatePartial({ buildDirectory: 'foo' });
        let completed = await didItComplete(changed, 1000);
        expect(!completed, 'Update event should not fire');

        conf.updatePartial({ parallelJobs: 4 });
        completed = await didItComplete(changed, 1000);
        expect(completed, 'Update event should fire');
    });

    test('Unchanged values in partial update are unaffected', () => {
        const conf = createConfig({ parallelJobs: 5 });
        conf.updatePartial({ buildDirectory: 'Foo' });
        expect(conf.parallelJobs).to.eq(5);
    });

    test('buildDirectory plain string form returns the string', () => {
        const conf = createConfig({ buildDirectory: '/my/build/path' });
        expect(conf.buildDirectory(false)).to.eq('/my/build/path');
    });

    test('buildDirectory object form returns singleConfig when isMultiConfig is false', () => {
        const conf = createConfig({
            buildDirectory: {
                singleConfig: '/build/single-${buildType}',
                multiConfig: '/build/multi'
            }
        });
        expect(conf.buildDirectory(false, undefined, false)).to.eq('/build/single-${buildType}');
    });

    test('buildDirectory object form returns multiConfig when isMultiConfig is true', () => {
        const conf = createConfig({
            buildDirectory: {
                singleConfig: '/build/single-${buildType}',
                multiConfig: '/build/multi'
            }
        });
        expect(conf.buildDirectory(false, undefined, true)).to.eq('/build/multi');
    });

    test('buildDirectory object form with only singleConfig falls back for multi-config generator', () => {
        const conf = createConfig({
            buildDirectory: { singleConfig: '/build/single' }
        });
        // No multiConfig set, should fall back to singleConfig
        expect(conf.buildDirectory(false, undefined, true)).to.eq('/build/single');
    });

    test('buildDirectory object form with only multiConfig falls back for single-config generator', () => {
        const conf = createConfig({
            buildDirectory: { multiConfig: '/build/multi' }
        });
        // No singleConfig set, should fall back to multiConfig
        expect(conf.buildDirectory(false, undefined, false)).to.eq('/build/multi');
    });

    test('buildDirectory object form with empty object falls back to default', () => {
        const conf = createConfig({
            buildDirectory: {}
        });
        expect(conf.buildDirectory(false, undefined, false)).to.eq('${workspaceFolder}/build');
    });

    test('buildDirectory object form defaults to singleConfig when isMultiConfig is undefined', () => {
        const conf = createConfig({
            buildDirectory: {
                singleConfig: '/build/single',
                multiConfig: '/build/multi'
            }
        });
        // When isMultiConfig is not provided, defaults to false (single-config)
        expect(conf.buildDirectory(false)).to.eq('/build/single');
    });

    test('buildDirectory plain string form works with multiProject=false', () => {
        // Note: we cannot test multiProject=true with a non-default value here because
        // isDefaultValue() checks the real vscode.workspace.getConfiguration (not configData),
        // which always reports the default in the test host environment.
        const conf = createConfig({ buildDirectory: '/custom/build' });
        expect(conf.buildDirectory(false)).to.eq('/custom/build');
    });
});
