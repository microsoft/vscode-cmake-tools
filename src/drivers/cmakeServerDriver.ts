import { CMakeExecutable } from '@cmt/cmakeExecutable';
import { InputFileSet } from '@cmt/dirty';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cache from '@cmt/cache';
import {
    CMakeDriver,
    CMakePreconditionProblemSolver,
    CMakeServerClient,
    ExecutableTarget,
    GlobalSettingsContent,
    ProgressMessage,
    RichTarget,
    ServerError,
    ServerCodeModelContent,
    Target,
    NoGeneratorError
} from '@cmt/drivers/drivers';
import { Kit, CMakeGenerator } from '@cmt/kits/kit';
import { createLogger } from '@cmt/logging';
import * as proc from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import { ConfigurationReader } from '@cmt/config';
import { errorToString } from '@cmt/util';
import * as nls from 'vscode-nls';
import { BuildPreset, ConfigurePreset, TestPreset, PackagePreset, WorkflowPreset } from '@cmt/presets/preset';
import { CodeModelConfiguration, CodeModelContent, CodeModelFileGroup, CodeModelProject, CodeModelTarget } from '@cmt/drivers/codeModel';
import { ConfigureTrigger } from '@cmt/cmakeProject';
import { onConfigureSettingsChange } from '@cmt/ui/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('cms-driver');

export class CMakeServerDriver extends CMakeDriver {

    get isCacheConfigSupported(): boolean {
        return false;
    }

    async doCacheConfigure(): Promise<number> {
        throw new Error('Method not implemented.');
    }

    private constructor(cmake: CMakeExecutable, readonly config: ConfigurationReader, sourceDir: string, isMultiProject: boolean, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver) {
        super(cmake, config, sourceDir, isMultiProject, workspaceFolder, preconditionHandler);
        this.config.onChange('environment', () => this._restartClient());
        this.config.onChange('configureEnvironment', () => this._restartClient());
    }

    private _cmsClient: Promise<CMakeServerClient | null> = Promise.resolve(null);
    private _clientChangeInProgress: Promise<void> = Promise.resolve();
    private _globalSettings!: GlobalSettingsContent;
    private _cacheEntries = new Map<string, cache.CacheEntry>();
    private _cmakeInputFileSet = InputFileSet.createEmpty();

    private readonly _progressEmitter = new vscode.EventEmitter<ProgressMessage>();
    get onProgress() {
        return this._progressEmitter.event;
    }

    /**
     * The previous configuration environment. Used to detect when we need to
     * restart cmake-server
     */
    private _prevConfigureEnv = 'null';

    private codeModel: CodeModelContent | null = null;
    private convertServerCodeModel(serverCodeModel: null | ServerCodeModelContent): CodeModelContent | null {
        if (serverCodeModel) {
            const codeModel: CodeModelContent = { configurations: [] };
            for (const config of serverCodeModel.configurations) {
                const newConfig: CodeModelConfiguration = { name: config.name, projects: [] };
                for (const project of config.projects) {
                    const newProject: CodeModelProject = {
                        name: project.name,
                        sourceDirectory: project.sourceDirectory,
                        hasInstallRule: project.hasInstallRule,
                        targets: []
                    };
                    for (const target of project.targets) {
                        const newTarget: CodeModelTarget = {
                            name: target.name,
                            type: target.type,
                            sourceDirectory: target.sourceDirectory,
                            fullName: target.fullName,
                            artifacts: target.artifacts,
                            sysroot: target.sysroot,
                            fileGroups: []
                        };
                        const linkLanguageFlags: string | undefined = target.linkLanguageFlags;
                        if (target.fileGroups) {
                            newTarget.fileGroups = [];
                            for (const group of target.fileGroups) {
                                const newGroup: CodeModelFileGroup = {
                                    sources: group.sources,
                                    language: group.language,
                                    includePath: group.includePath,
                                    defines: group.defines,
                                    isGenerated: group.isGenerated,
                                    compileCommandFragments: group.compileFlags ? [group.compileFlags] : (linkLanguageFlags ? [linkLanguageFlags] : [])
                                };
                                newTarget.fileGroups.push(newGroup);
                            }
                        }
                        newProject.targets.push(newTarget);
                    }
                    newConfig.projects.push(newProject);
                }
                codeModel.configurations.push(newConfig);
            }
            return codeModel;
        }
        return null;
    }

    private readonly _codeModelChanged = new vscode.EventEmitter<null | CodeModelContent>();
    get onCodeModelChanged() {
        return this._codeModelChanged.event;
    }

    async asyncDispose() {
        this._codeModelChanged.dispose();
        this._progressEmitter.dispose();

        await this.shutdownClient();
    }

    private async shutdownClient() {
        const cl = await this._cmsClient;
        if (cl) {
            await cl.shutdownAsync();
        }
    }

    private async getClient(): Promise<CMakeServerClient> {
        if (!(await this._cmsClient)) {
            this._cmsClient = this._startNewClient();
        }

        const client_started = await this._cmsClient;
        if (!(client_started)) {
            throw Error('Unable to start cms client');
        } else {
            return client_started;
        }
    }

    protected async doPreCleanConfigure(): Promise<void> {
        const old_cl = await this._cmsClient;
        this._cmsClient = (async () => {
            // Stop the server before we try to rip out any old files
            if (old_cl) {
                await old_cl.shutdownAsync();
            }
            await this._cleanPriorConfiguration();
            return this._startNewClient();
        })();
    }

    protected async doConfigure(args: string[], _trigger?: ConfigureTrigger, consumer?: proc.OutputConsumer, showCommandOnly?: boolean, _defaultConfigurePresetName?: string, configurePreset?: ConfigurePreset | null, _options?: proc.ExecutionOptions) {
        await this._clientChangeInProgress;
        const cl = await this.getClient();
        const sub = this.onMessage(msg => {
            if (consumer) {
                for (const line of msg.split('\n')) {
                    consumer.output(line);
                }
            }
        });

        if (showCommandOnly) {
            log.showChannel();
            log.info(proc.buildCmdStr(this.cmake.path, args));
        } else {
            try {
                if (!configurePreset) {
                    this._hadConfigurationChanged = false;
                }
                await cl.configure({ cacheArguments: args });
                await cl.compute();
            } catch (e) {
                if (e instanceof ServerError) {
                    log.error(localize('cmake.configure.error', 'Error during CMake configure: {0}', errorToString(e)));
                    return 1;
                } else {
                    throw e;
                }
            } finally {
                sub.dispose();
            }
            await this._refreshPostConfigure();
        }
        return 0;
    }

    protected async doPreBuild(): Promise<boolean> {
        return true;
    }

    protected async doPostBuild(): Promise<boolean> {
        await this._refreshPostConfigure();
        return true;
    }

    async _refreshPostConfigure(): Promise<void> {
        const client = await this.getClient();
        const cmake_inputs = await client.cmakeInputs();  // <-- 1. This line generates the error
        // Scan all the CMake inputs and capture their mtime so we can check for
        // out-of-dateness later
        this._cmakeInputFileSet = await InputFileSet.create(cmake_inputs);
        const clcache = await client.getCMakeCacheContent();
        this._cacheEntries = clcache.cache.reduce((acc, el) => {
            const entry_map: { [key: string]: cache.CacheEntryType | undefined } = {
                BOOL: cache.CacheEntryType.Bool,
                STRING: cache.CacheEntryType.String,
                PATH: cache.CacheEntryType.Path,
                FILEPATH: cache.CacheEntryType.FilePath,
                INTERNAL: cache.CacheEntryType.Internal,
                UNINITIALIZED: cache.CacheEntryType.Uninitialized,
                STATIC: cache.CacheEntryType.Static
            };
            const type = entry_map[el.type];
            if (type === undefined) {
                rollbar.error(localize('unknown.cache.entry.type', 'Unknown cache entry type {0}', el.type));
                return acc;
            }
            acc.set(el.key,
                new cache.CacheEntry(el.key, el.value, type, el.properties.HELPSTRING, el.properties.ADVANCED === '1'));
            return acc;
        }, new Map<string, cache.CacheEntry>());
        // Convert ServerCodeModel to general CodeModel.
        this.codeModel = this.convertServerCodeModel(await client.codemodel());
        this._codeModelChanged.fire(this.codeModel);
    }

    async doRefreshExpansions(cb: () => Promise<void>): Promise<void> {
        log.debug('Run doRefreshExpansions');
        const bindir_before = this.binaryDir;
        const srcdir_before = this.sourceDir;
        await cb();
        if (!bindir_before.length || !srcdir_before.length) {
            return;
        }
        const new_env = JSON.stringify(await this.getConfigureEnvironment());
        if (bindir_before !== this.binaryDir || srcdir_before !== this.sourceDir || new_env !== this._prevConfigureEnv) {
            // Directories changed. We need to restart the driver
            await this._restartClient();
        }
        this._prevConfigureEnv = new_env;
    }

    get targets(): RichTarget[] {
        if (!this.codeModel) {
            return [];
        }
        const build_config = this.codeModel.configurations.find(conf => conf.name === this.currentBuildType);
        if (!build_config) {
            log.error(localize('found.no.matching.code.model', 'Found no matching code model for the current build type. This shouldn\'t be possible'));
            return [];
        }
        const metaTargets = [{
            type: 'rich' as 'rich',
            name: this.allTargetName,
            filepath: localize('build.all.target', 'A special target to build all available targets'),
            targetType: 'META'
        }];
        if (build_config.projects.some(project => (project.hasInstallRule) ? project.hasInstallRule : false)) {
            metaTargets.push({
                type: 'rich' as 'rich',
                name: 'install',
                filepath: localize('install.all.target', 'A special target to install all available targets'),
                targetType: 'META'
            });
        }
        return build_config.projects.reduce<RichTarget[]>(
            (acc, project) => acc.concat(project.targets.map(t => ({
                type: 'rich' as 'rich',
                name: t.name,
                filepath: t.artifacts && t.artifacts.length
                    ? path.normalize(t.artifacts[0])
                    : localize('utility.target', 'Utility target'),
                targetType: t.type
            }))),
            metaTargets);
    }

    get executableTargets(): ExecutableTarget[] {
        return this.targets.filter(t => t.targetType === 'EXECUTABLE')
            .reduce(targetReducer, [])
            .map(t => ({ name: t.name, path: t.filepath }));
    }

    get uniqueTargets(): Target[] {
        return this.targets.reduce(targetReducer, []);
    }

    get cmakeFiles(): string[] {
        return this._cmakeInputFileSet.inputFiles.map(file => file.filePath);
    }

    get generatorName(): string | null {
        return this._globalSettings ? this._globalSettings.generator : null;
    }

    /**
     * Track if the user changes the settings of the configure via settings.json
     */
    private _hadConfigurationChanged = true;
    protected async doConfigureSettingsChange(): Promise<void> {
        this._hadConfigurationChanged = true;
        await onConfigureSettingsChange();
    }

    async checkNeedsReconfigure(): Promise<boolean> {
        if (this._hadConfigurationChanged) {
            return this._hadConfigurationChanged;
        }
        // If we have no input files, we probably haven't configured yet
        if (this._cmakeInputFileSet.inputFiles.length === 0) {
            return true;
        }
        return this._cmakeInputFileSet.checkOutOfDate();
    }

    get cmakeCacheEntries(): Map<string, cache.CacheEntry> {
        return this._cacheEntries;
    }

    private async _setKitAndRestart(need_clean: boolean, cb: () => Promise<void>) {
        this._cmakeInputFileSet = InputFileSet.createEmpty();
        const client = await this._cmsClient;
        if (client) {
            await client.shutdownAsync();
        }
        if (need_clean) {
            await this._cleanPriorConfiguration();
        }
        await cb();
        if (!this.generator) {
            throw new NoGeneratorError();
        }

        await this._restartClient();
    }

    doSetKit(cb: () => Promise<void>): Promise<void> {
        this._clientChangeInProgress = this._setKitAndRestart(false, cb);
        return this._clientChangeInProgress;
    }

    doSetConfigurePreset(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
        this._clientChangeInProgress = this._setKitAndRestart(need_clean, cb);
        return this._clientChangeInProgress;
    }

    doSetBuildPreset(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    doSetTestPreset(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    doSetPackagePreset(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    doSetWorkflowPreset(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    private async _restartClient(): Promise<void> {
        this._cmsClient = this._doRestartClient();
        const client = await this.getClient();
        this._globalSettings = await client.getGlobalSettings();
    }

    private async _doRestartClient(): Promise<CMakeServerClient> {
        const old_client = await this._cmsClient;
        if (old_client) {
            await old_client.shutdownAsync();
        }
        return this._startNewClient();
    }

    private async _startNewClient() {
        if (!this.generator) {
            throw new NoGeneratorError();
        }

        return CMakeServerClient.start({
            tmpdir: path.join(this.workspaceFolder!, '.vscode'),
            binaryDir: this.binaryDir,
            sourceDir: this.sourceDir,
            cmakePath: this.cmake.path,
            environment: await this.getConfigureEnvironment(),
            onDirty: async () => {
                // cmake-server has dirty check issues, so we implement our own dirty
                // checking. Maybe in the future this can be useful for auto-configuring
                // on file changes?
            },
            onOtherOutput: async msg => this._onMessageEmitter.fire(msg),
            onMessage: async msg => {
                this._onMessageEmitter.fire(msg.message);
            },
            onProgress: async prog => {
                this._progressEmitter.fire(prog);
            },
            generator: this.generator
        });
    }

    private readonly _onMessageEmitter = new vscode.EventEmitter<string>();
    get onMessage() {
        return this._onMessageEmitter.event;
    }

    async onStop(): Promise<void> {
        const client = await this._cmsClient;
        if (client) {
            if (this.configInProgress()) {
                client.shutdownServer();
            }
            await client.shutdownAsync();
            this._cmsClient = Promise.resolve(null);
        }
    }

    protected async doInit(): Promise<void> {
        await this._restartClient();
    }

    get codeModelContent(): ServerCodeModelContent | null {
        return null;
    }

    static async create(cmake: CMakeExecutable,
        config: ConfigurationReader,
        sourceDir: string,
        isMultiProject: boolean,
        useCMakePresets: boolean,
        kit: Kit | null,
        configurePreset: ConfigurePreset | null,
        buildPreset: BuildPreset | null,
        testPreset: TestPreset | null,
        packagePreset: PackagePreset | null,
        workflowPreset: WorkflowPreset | null,
        workspaceFolder: string,
        preconditionHandler: CMakePreconditionProblemSolver,
        preferredGenerators: CMakeGenerator[]): Promise<CMakeServerDriver> {
        return this.createDerived(new CMakeServerDriver(cmake, config, sourceDir, isMultiProject, workspaceFolder, preconditionHandler),
            useCMakePresets,
            kit,
            configurePreset,
            buildPreset,
            testPreset,
            packagePreset,
            workflowPreset,
            preferredGenerators);
    }

}

/**
 * Helper function for Array.reduce
 *
 * @param set the accumulator
 * @t the RichTarget currently being examined.
 */
function targetReducer(set: RichTarget[], t: RichTarget): RichTarget[] {
    if (!set.find(t2 => t.name === t2.name && t.filepath === t2.filepath && t.targetType === t2.targetType)) {
        set.push(t);
    }
    return set;
}
