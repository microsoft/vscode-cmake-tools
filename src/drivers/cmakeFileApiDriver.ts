import { CMakeCache, CacheEntry } from '@cmt/cache';
import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import { ConfigurationReader } from '@cmt/config';
import {
    createQueryFileForApi,
    loadCacheContent,
    loadCMakeFiles,
    loadConfigurationTargetMap,
    loadExtCodeModelContent,
    loadIndexFile,
    loadToolchains,
    CMakeDriver,
    CMakePreconditionProblemSolver,
    ExecutableTarget,
    Index,
    RichTarget,
    Target,
    NoGeneratorError
} from '@cmt/drivers/drivers';
import * as codeModel from '@cmt/drivers/codeModel';
import { CMakeGenerator, Kit } from '@cmt/kit';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as proc from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildPreset, ConfigurePreset, getValue, TestPreset, PackagePreset, WorkflowPreset } from '@cmt/preset';
import * as nls from 'vscode-nls';
import { DebuggerInformation } from '@cmt/debug/debuggerConfigureDriver';
import { CMakeOutputConsumer, StateMessage } from '@cmt/diagnostics/cmake';
import { ConfigureTrigger } from '@cmt/cmakeProject';
import { logCMakeDebuggerTelemetry } from '@cmt/debug/cmakeDebuggerTelemetry';
import { onConfigureSettingsChange } from '@cmt/ui/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cmakefileapi-driver');
/**
 * The CMake driver with FileApi of CMake >= 3.15.0
 */
export class CMakeFileApiDriver extends CMakeDriver {

    get isCacheConfigSupported(): boolean {
        return fs.existsSync(this.getCMakeFileApiPath());
    }

    private constructor(cmake: CMakeExecutable,
        readonly config: ConfigurationReader,
        sourceDir: string,
        isMultiProject: boolean,
        workspaceRootPath: string,
        preconditionHandler: CMakePreconditionProblemSolver) {
        super(cmake, config, sourceDir, isMultiProject, workspaceRootPath, preconditionHandler);
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
        workspaceRootPath: string,
        preconditionHandler: CMakePreconditionProblemSolver,
        preferredGenerators: CMakeGenerator[]): Promise<CMakeFileApiDriver> {
        log.debug(localize('creating.instance.of', 'Creating instance of {0}', "CMakeFileApiDriver"));
        return this.createDerived(new CMakeFileApiDriver(cmake, config, sourceDir, isMultiProject, workspaceRootPath, preconditionHandler),
            useCMakePresets,
            kit,
            configurePreset,
            buildPreset,
            testPreset,
            packagePreset,
            workflowPreset,
            preferredGenerators);
    }

    private _needsReconfigure = true;

    /**
     * Watcher for the CMake cache file on disk.
     */
    private readonly _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

    // Information from cmake file api
    private _cache: Map<string, CacheEntry> = new Map<string, CacheEntry>();
    private _cmakeFiles: string[] | null = null;
    private _generatorInformation: Index.GeneratorInformation | null = null;
    private _target_map: Map<string, Target[]> = new Map();

    async getGeneratorFromCache(cache_file_path: string): Promise<string | undefined> {
        const cache = await CMakeCache.fromPath(cache_file_path);

        return cache.get('CMAKE_GENERATOR')?.value;
    }

    async loadGeneratorInformationFromCache(cache_file_path: string) {
        const cache = await CMakeCache.fromPath(cache_file_path);

        this._generator = {
            name: cache.get('CMAKE_GENERATOR')?.value,
            platform: cache.get('CMAKE_GENERATOR_PLATFORM')?.value,
            toolset: cache.get('CMAKE_GENERATOR_TOOLSET')?.value
        } as CMakeGenerator;

        this._generatorInformation = {
            name: cache.get('CMAKE_GENERATOR')?.value,
            platform: cache.get('CMAKE_GENERATOR_PLATFORM')?.value
        };
    }

    async doInit() {
        // The seems to be a difference between server mode and fileapi on load of a existing project
        // If the existing project is not generated by the IDE then the fileapi queries are missing.
        // but the generator information are needed to get the code model, cache and cmake files.
        // This workaround load the information from cache.
        // Make an exception when the current deduced generator differs from the one saved in cache.
        // We need to treat this case as if the cache is not present and let a reconfigure
        // refresh the cache information.
        const cacheExists: boolean = await fs.exists(this.cachePath);
        if (cacheExists && this.generator?.name === await this.getGeneratorFromCache(this.cachePath)) {
            await this.loadGeneratorInformationFromCache(this.cachePath);
            const code_model_exist = await this.updateCodeModel();
            if (!code_model_exist && this.config.configureOnOpen === true) {
                await this.doConfigure([], undefined, undefined);
            }
        } else {
            // Do not delete the cache if configureOnOpen is false, which signals a project that may be
            // expected to be configured from outside VSCode and deleting the cache breaks that scenario.
            // Since this setting will prevent configure anyway (until a configure command is invoked
            // or build/test will trigger automatic configuring), there is no need to delete the cache now
            // even if this is not a project configured from outside VSCode.
            if (cacheExists && this.config.configureOnOpen !== false) {
                // No need to remove the other CMake files for the generator change to work properly
                log.info(localize('removing', 'Removing {0}', this.cachePath));
                try {
                    await fs.unlink(this.cachePath);
                } catch {
                    log.warning(localize('unlink.failed', 'Failed to remove cache file {0}', this.cachePath));
                }
            }

            this._generatorInformation = this.generator;
        }
        if (!this.generator && !this.useCMakePresets) {
            throw new NoGeneratorError();
        }

        this._cacheWatcher.onDidChange(() => {
            log.debug(`Reload CMake cache: ${this.cachePath} changed`);
            rollbar.invokeAsync('Reloading CMake Cache', () => this.updateCodeModel());
        });
    }

    async doConfigureSettingsChange(): Promise<void> {
        this._needsReconfigure = true;
        await onConfigureSettingsChange();
    }
    async checkNeedsReconfigure(): Promise<boolean> {
        return this._needsReconfigure;
    }

    async doSetKit(cb: () => Promise<void>): Promise<void> {
        this._needsReconfigure = true;
        await cb();
        if (!this.generator) {
            throw new NoGeneratorError();
        }
    }

    async doSetConfigurePreset(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
        this._needsReconfigure = true;
        if (need_clean) {
            await this._cleanPriorConfiguration();
        }
        await cb();
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

    async asyncDispose() {
        this._codeModelChanged.dispose();
        this._cacheWatcher.dispose();
    }

    protected async doPreCleanConfigure(): Promise<void> {
        await this._cleanPriorConfiguration();
    }

    async doCacheConfigure(): Promise<number> {
        this._needsReconfigure = true;
        await this.updateCodeModel();
        return 0;
    }

    async doConfigure(args_: string[], trigger?: ConfigureTrigger, outputConsumer?: proc.OutputConsumer, showCommandOnly?: boolean, defaultConfigurePresetName?: string, configurePreset?: ConfigurePreset | null, options?: proc.ExecutionOptions, debuggerInformation?: DebuggerInformation): Promise<number> {
        const binaryDir = configurePreset?.binaryDir ?? this.binaryDir;
        const api_path = this.getCMakeFileApiPath(binaryDir);
        await createQueryFileForApi(api_path);

        // Dup args so we can modify them
        const args = Array.from(args_);
        let has_gen = false;
        for (const arg of args) {
            if (arg.startsWith("-DCMAKE_GENERATOR:STRING=")) {
                has_gen = true;
            }
        }
        // -S and -B were introduced in CMake 3.13 and this driver assumes CMake >= 3.15
        args.push(`-S${util.lightNormalizePath(this.sourceDir)}`);
        args.push(`-B${util.lightNormalizePath(binaryDir)}`);

        if (!has_gen) {
            const generator = (configurePreset) ? {
                name: configurePreset.generator,
                platform: configurePreset.architecture ? getValue(configurePreset.architecture) : undefined,
                toolset: configurePreset.toolset ? getValue(configurePreset.toolset) : undefined

            } : this.generator;
            if (generator) {
                if (generator.name) {
                    args.push('-G');
                    args.push(generator.name);
                }
                if (generator.toolset) {
                    args.push('-T');
                    args.push(generator.toolset);
                }
                if (generator.platform) {
                    args.push('-A');
                    args.push(generator.platform);
                }
            }
        }

        const cmake = this.cmake.path;
        if (debuggerInformation) {
            args.push("--debugger");
            args.push("--debugger-pipe");
            args.push(`${debuggerInformation.pipeName}`);
            if (debuggerInformation.dapLog) {
                args.push("--debugger-dap-log");
                args.push(debuggerInformation.dapLog);
            }
        }

        if (showCommandOnly) {
            log.showChannel();
            log.info(proc.buildCmdStr(this.cmake.path, args));
            return 0;
        } else {
            log.debug(`Configuring using ${this.useCMakePresets ? 'preset' : 'kit'}`);
            log.debug('Invoking CMake', cmake, 'with arguments', JSON.stringify(args));
            const env = await this.getConfigureEnvironment(configurePreset, options?.environment);

            const child = this.executeCommand(cmake, args, outputConsumer, {
                environment: env,
                cwd: options?.cwd ?? binaryDir
            });
            this.configureProcess = child;

            if (debuggerInformation) {
                if (outputConsumer instanceof CMakeOutputConsumer) {
                    while (!outputConsumer.stateMessages.includes(StateMessage.WaitingForDebuggerClient)) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }

                    // if there isn't a `debuggerIsReady` callback provided, this means that this invocation was
                    // started by a command, rather than by a launch configuration, and the debug session will start from here.
                    if (debuggerInformation.debuggerIsReady) {
                        // This cmake debug invocation came from a launch configuration. All telemetry is handled in the createDebugAdapterDescriptor handler.
                        debuggerInformation.debuggerIsReady();
                    } else {
                        const cmakeDebugType = "configure";
                        logCMakeDebuggerTelemetry(trigger ?? "", cmakeDebugType);
                        await vscode.debug.startDebugging(undefined, {
                            name: localize("cmake.debug.name", "CMake Debugger"),
                            request: "launch",
                            type: "cmake",
                            cmakeDebugType,
                            pipeName: debuggerInformation.pipeName,
                            fromCommand: true
                        });
                    }
                }
            }

            const result = await child.result;
            this.configureProcess = null;
            log.trace(result.stderr);
            log.trace(result.stdout);
            if (result.retc === 0) {
                if (!configurePreset || (configurePreset && defaultConfigurePresetName && configurePreset.name === defaultConfigurePresetName)) {
                    this._needsReconfigure = false;
                }
                await this.updateCodeModel(binaryDir);
            }
            return result.retc === null ? -1 : result.retc;
        }
    }

    async doPostBuild(): Promise<boolean> {
        await this.updateCodeModel();
        return true;
    }

    private getCMakeFileApiPath(binaryDir?: string) {
        return path.join(binaryDir ?? this.binaryDir, '.cmake', 'api', 'v1');
    }
    private getCMakeReplyPath(binaryDir?: string) {
        const api_path = this.getCMakeFileApiPath(binaryDir);
        return path.join(api_path, 'reply');
    }

    private toolchainWarningProvided: boolean = false;
    private async updateCodeModel(binaryDir?: string): Promise<boolean> {
        const reply_path = this.getCMakeReplyPath(binaryDir);
        const indexFile = await loadIndexFile(reply_path);
        if (indexFile) {
            this._generatorInformation = indexFile.cmake.generator;

            // load cache
            const cache_obj = indexFile.objects.find((value: Index.ObjectKind) => value.kind === 'cache');
            if (!cache_obj) {
                throw Error('No cache object found');
            }

            this._cache = await loadCacheContent(path.join(reply_path, cache_obj.jsonFile));

            // load targets
            const codemodel_obj = indexFile.objects.find((value: Index.ObjectKind) => value.kind === 'codemodel');
            if (!codemodel_obj) {
                throw Error('No code model object found');
            }
            this._target_map = await loadConfigurationTargetMap(reply_path, codemodel_obj.jsonFile);
            this._codeModelContent = await loadExtCodeModelContent(reply_path, codemodel_obj.jsonFile);

            // load toolchains
            const toolchains_obj = indexFile.objects.find((value: Index.ObjectKind) => value.kind === 'toolchains');

            // The "toolchains" object kind wasn't introduced until CMake 3.20, so
            // it's not fatal if it's missing in the response.
            if (!toolchains_obj) {
                if (!this.toolchainWarningProvided) {
                    this.toolchainWarningProvided = true;
                    log.info(localize(
                        'toolchains.object.unsupported',
                        'This version of CMake does not support the "toolchains" object kind. Compiler paths will be determined by reading CMakeCache.txt.'));
                }
            } else {
                if (this._codeModelContent) {
                    this._codeModelContent.toolchains = await loadToolchains(path.join(reply_path, toolchains_obj.jsonFile));
                }
            }

            // load cmake files if available
            const cmakefiles_obj = indexFile.objects.find((value: Index.ObjectKind) => value.kind === 'cmakeFiles');
            if (cmakefiles_obj) {
                this._cmakeFiles = await loadCMakeFiles(path.join(reply_path, cmakefiles_obj.jsonFile));
            } else {
                this._cmakeFiles = [];
            }

            this._codeModelChanged.fire(this._codeModelContent);
        }
        return indexFile !== null;
    }

    private _codeModelContent: codeModel.CodeModelContent | null = null;
    get codeModelContent() {
        return this._codeModelContent;
    }

    get cmakeCacheEntries(): Map<string, CacheEntry> {
        return this._cache;
    }
    get generatorName(): string | null {
        return this._generatorInformation ? this._generatorInformation.name : null;
    }
    get targets(): Target[] {
        const targets = this._target_map.get(this.currentBuildType);
        if (targets) {
            const metaTargets = [{
                type: 'rich' as 'rich',
                name: this.allTargetName,
                filepath: localize('build.all.target', 'A special target to build all available targets'),
                targetType: 'META'
            }];
            return [...metaTargets, ...targets].filter((value, idx, self) => self.findIndex(e => value.name === e.name) === idx);
        } else {
            return [];
        }
    }

    /**
     * List of unique targets known to CMake
     */
    get uniqueTargets(): Target[] {
        return this.targets.reduce(targetReducer, []);
    }

    get executableTargets(): ExecutableTarget[] {
        return this.uniqueTargets.filter(t => t.type === 'rich' && (t as RichTarget).targetType === 'EXECUTABLE')
            .map(t => ({
                name: t.name,
                path: (t as RichTarget).filepath
            }));
    }

    get cmakeFiles(): string[] {
        return this._cmakeFiles || [];
    }

    private readonly _codeModelChanged = new vscode.EventEmitter<null | codeModel.CodeModelContent>();
    get onCodeModelChanged() {
        return this._codeModelChanged.event;
    }
}

/**
 * Helper function for Array.reduce
 *
 * @param set the accumulator
 * @t the RichTarget currently being examined.
 */
function targetReducer(set: Target[], t: Target): Target[] {
    if (!set.find(t2 => compareTargets(t, t2))) {
        set.push(t);
    }
    return set;
}

function compareTargets(a: Target, b: Target): boolean {
    let same = false;
    if (a.type === b.type) {
        same = a.name === b.name;
        if (a.type === 'rich' && b.type === 'rich') {
            same = same && (a.filepath === b.filepath);
            same = same && (a.targetType === b.targetType);
        }
    }

    return same;
}
