/**
 * Defines base class for CMake drivers
 */ /** */

import * as path from 'path';
import * as vscode from 'vscode';

import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import * as codepages from '@cmt/codePageTable';
import { ConfigureTrigger, DiagnosticsConfiguration } from "@cmt/cmakeProject";
import { CompileCommand } from '@cmt/compilationDatabase';
import { ConfigurationReader, checkBuildOverridesPresent, checkConfigureOverridesPresent, checkTestOverridesPresent, checkPackageOverridesPresent, defaultNumJobs } from '@cmt/config';
import { CMakeBuildConsumer, CompileOutputConsumer } from '@cmt/diagnostics/build';
import { CMakeOutputConsumer } from '@cmt/diagnostics/cmake';
import { RawDiagnosticParser } from '@cmt/diagnostics/util';
import { ProgressMessage } from '@cmt/drivers/drivers';
import * as expand from '@cmt/expand';
import { CMakeGenerator, effectiveKitEnvironment, Kit, kitChangeNeedsClean, KitDetect, getKitDetect, getVSKitEnvironment } from '@cmt/kit';
import * as logging from '@cmt/logging';
import paths from '@cmt/paths';
import { fs } from '@cmt/pr';
import * as proc from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import * as telemetry from '@cmt/telemetry';
import * as util from '@cmt/util';
import { ConfigureArguments, VariantOption } from '@cmt/variant';
import * as nls from 'vscode-nls';
import { majorVersionSemver, minorVersionSemver, parseTargetTriple, TargetTriple } from '@cmt/triple';
import * as preset from '@cmt/preset';
import * as codeModel from '@cmt/drivers/codeModel';
import { Environment, EnvironmentUtils } from '@cmt/environmentVariables';
import { CMakeTask, CMakeTaskProvider, CustomBuildTaskTerminal } from '@cmt/cmakeTaskProvider';
import { getValue } from '@cmt/preset';
import { CacheEntry } from '@cmt/cache';
import { CMakeBuildRunner } from '@cmt/cmakeBuildRunner';
import { DebuggerInformation } from '@cmt/debug/debuggerConfigureDriver';
import { onBuildSettingsChange, onTestSettingsChange, onPackageSettingsChange } from '@cmt/ui/util';
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('driver');

export class NoGeneratorError extends Error {
    message: string = localize('no.usable.generator.found', 'No usable generator found.');
}

export enum CMakePreconditionProblems {
    ConfigureIsAlreadyRunning,
    BuildIsAlreadyRunning,
    NoSourceDirectoryFound,
    MissingCMakeListsFile
}

interface CompilerInfo {
    name: string;
    version: string;
}

export enum ConfigureResultType {
    NormalOperation,
    ForcedCancel,
    ConfigureInProgress,
    BuildInProgress,
    NoCache,
    NoConfigurePreset,
    Other
}

export interface ConfigureResult {
    result: number;
    resultType: ConfigureResultType;
}

export type CMakePreconditionProblemSolver = (e: CMakePreconditionProblems, config?: ConfigurationReader) => Promise<void>;

function nullableValueToString(arg: any | null | undefined): string {
    return arg === null ? 'empty' : arg;
}

/**
 * Description of an executable CMake target, defined via `add_executable()`.
 */
export interface ExecutableTarget {
    /**
     * The name of the target.
     */
    name: string;
    /**
     * The absolute path to the build output.
     */
    path: string;
}

/**
 * A target with a name, but no output. This may be created via `add_custom_command()`.
 */
export interface NamedTarget {
    type: 'named';
    name: string;
}

/**
 * A target with a name, path, and type.
 */
export interface RichTarget {
    type: 'rich';
    name: string;
    filepath: string;
    targetType: string;
}

export type Target = NamedTarget | RichTarget;

/**
 * Base class for CMake drivers.
 *
 * CMake drivers are separated because different CMake version warrant different
 * communication methods. Older CMake versions need to be driven by the command
 * line, but newer versions may be controlled via CMake server, which provides
 * a much richer interface.
 *
 * This class defines the basis for what a driver must implement to work.
 */
export abstract class CMakeDriver implements vscode.Disposable {
    /**
     * Do the configuration process for the current project.
     *
     * @returns The exit code from CMake
     */
    protected abstract doConfigure(extra_args: string[], trigger?: ConfigureTrigger, consumer?: proc.OutputConsumer, showCommandOnly?: boolean, defaultConfigurePresetName?: string, configurePreset?: preset.ConfigurePreset | null, options?: proc.ExecutionOptions, debuggerInformation?: DebuggerInformation): Promise<number>;
    protected abstract doCacheConfigure(): Promise<number>;

    private _isConfiguredAtLeastOnce = false;
    protected get isConfiguredAtLeastOnce(): boolean {
        return this._isConfiguredAtLeastOnce;
    }

    protected async doPreCleanConfigure(): Promise<void> {
        return Promise.resolve();
    }

    protected doPreBuild(): Promise<boolean> {
        return Promise.resolve(true);
    }

    protected doPostBuild(): Promise<boolean> {
        return Promise.resolve(true);
    }

    /**
     * Check if using cached configuration is supported.
     */
    protected abstract get isCacheConfigSupported(): boolean;

    /**
     * Check if we need to reconfigure, such as if an important file has changed
     */
    abstract checkNeedsReconfigure(): Promise<boolean>;
    /**
     * Event registration for code model updates
     *
     * This event is fired after update of the code model, like after cmake configuration.
     */
    abstract onCodeModelChanged: vscode.Event<codeModel.CodeModelContent | null>;

    /**
     * List of targets known to CMake
     */
    abstract get targets(): Target[];

    abstract get codeModelContent(): codeModel.CodeModelContent | null;

    /**
     * List of executable targets known to CMake
     */
    abstract get executableTargets(): ExecutableTarget[];

    /**
     * List of unique targets known to CMake
     */
    abstract get uniqueTargets(): Target[];

    /**
     * List of all files (CMakeLists.txt and included .cmake files) used by CMake
     * during configuration
     */
    abstract get cmakeFiles(): string[];

    /**
     * Do any necessary disposal for the driver. For the CMake Server driver,
     * this entails shutting down the server process and closing the open pipes.
     *
     * The reason this is separate from the regular `dispose()` is so that the
     * driver shutdown may be `await`ed on to ensure full shutdown.
     */
    abstract asyncDispose(): Promise<void>;

    /**
     * Construct the driver. Concrete instances should provide their own creation
     * routines.
     */
    protected constructor(public cmake: CMakeExecutable,
        readonly config: ConfigurationReader,
        protected sourceDirUnexpanded: string, // The un-expanded original source directory path, where the CMakeLists.txt exists.
        private readonly isMultiProject: boolean,
        private readonly __workspaceFolder: string,
        readonly preconditionHandler: CMakePreconditionProblemSolver) {
        this.sourceDir = this.sourceDirUnexpanded;
        // We have a cache of file-compilation terminals. Wipe them out when the
        // user closes those terminals.
        vscode.window.onDidCloseTerminal(closed => {
            for (const [key, term] of this._compileTerms) {
                if (term === closed) {
                    log.debug(localize('user.closed.file.compilation.terminal', 'User closed a file compilation terminal'));
                    this._compileTerms.delete(key);
                    break;
                }
            }
        });
    }

    /**
     * The source directory, where the root CMakeLists.txt lives.
     *
     * @note This is distinct from the config values, since we do variable
     * substitution.
     */
    protected __sourceDir = '';

    get sourceDir(): string {
        return this.__sourceDir;
    }

    protected set sourceDir(value: string) {
        this.__sourceDir = value;
    }

    /**
     * Dispose the driver. This disposes some things synchronously, but also
     * calls the `asyncDispose()` method to start any asynchronous shutdown.
     */
    dispose() {
        log.debug(localize('disposing.base.cmakedriver', 'Disposing base CMakeDriver'));
        for (const term of this._compileTerms.values()) {
            term.dispose();
        }
        for (const sub of [this._settingsSub, this._argsSub, this._envSub, this._buildArgsSub, this._buildEnvSub, this._testArgsSub, this._testEnvSub, this._packEnvSub, this._generalEnvSub]) {
            sub.dispose();
        }
        rollbar.invokeAsync(localize('async.disposing.cmake.driver', 'Async disposing CMake driver'), () => this.asyncDispose());
    }

    /**
     * The environment variables required by the current kit
     */
    private _kitEnvironmentVariables = EnvironmentUtils.create();

    /**
     * Compute the environment variables that apply with substitutions by expansionOptions
     */
    async computeExpandedEnvironment(toExpand: Environment, expanded: Environment): Promise<Environment> {
        const env = EnvironmentUtils.create();
        const opts = this.expansionOptions;

        for (const entry of Object.entries(toExpand)) {
            env[entry[0]] = await expand.expandString(entry[1], { ...opts, envOverride: expanded });
        }

        return env;
    }

    /**
     * Get the environment variables that should be set at CMake-configure time.
     */
    async getConfigureEnvironment(configurePreset?: preset.ConfigurePreset | null, extraEnvironmentVariables?: Environment): Promise<Environment> {
        let envs;
        if (this.useCMakePresets) {
            envs = EnvironmentUtils.create(configurePreset ? configurePreset.environment : this._configurePreset?.environment);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.configureEnvironment, envs)]);
        } else {
            envs = this._kitEnvironmentVariables;
            /* NOTE: By mergeEnvironment one by one to enable expanding self containd variable such as PATH properly */
            /* If configureEnvironment and environment both configured different PATH, doing this will preserve them all */
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.configureEnvironment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this._variantEnv, envs)]);
        }
        if (extraEnvironmentVariables) {
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(extraEnvironmentVariables, envs)]);
        }
        return envs;
    }

    /**
     * Get the environment variables that should be set at CMake-build time.
     */
    async getCMakeBuildCommandEnvironment(in_env?: Environment): Promise<Environment> {
        if (this.useCMakePresets) {
            let envs = EnvironmentUtils.merge([in_env, this._buildPreset?.environment]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.buildEnvironment, envs)]);
            return envs;
        } else {
            let envs = EnvironmentUtils.merge([in_env, this._kitEnvironmentVariables]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.buildEnvironment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this._variantEnv, envs)]);
            return envs;
        }
    }

    /**
     * Get the environment variables that should be set at CTest and running program time.
     */
    async getCTestCommandEnvironment(): Promise<Environment> {
        if (this.useCMakePresets) {
            let envs = EnvironmentUtils.create(this._testPreset?.environment);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.testEnvironment, envs)]);

            if (this.useCMakePresets && this.testPreset !== null && checkTestOverridesPresent(this.config)) {
                log.info(localize('test.with.overrides', 'NOTE: You are testing with preset {0}, but there are some overrides being applied from your VS Code settings.', this.testPreset.displayName ?? this.testPreset.name));
            }

            return envs;
        } else {
            let envs = this._kitEnvironmentVariables;
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.testEnvironment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this._variantEnv, envs)]);
            return envs;
        }
    }

    /**
     * Get the environment variables that should be set at CPack and packaging time.
     */
    async getCPackCommandEnvironment(): Promise<Environment> {
        if (this.useCMakePresets) {
            let envs = EnvironmentUtils.create(this._packagePreset?.environment);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.environment, envs)]);
            envs = EnvironmentUtils.merge([envs, await this.computeExpandedEnvironment(this.config.cpackEnvironment, envs)]);

            if (this.useCMakePresets && this.packagePreset !== null && checkPackageOverridesPresent(this.config)) {
                log.info(localize('package.with.overrides', 'NOTE: You are packaging with preset {0}, but there are some overrides being applied from your VS Code settings.', this.packagePreset.displayName ?? this.packagePreset.name));
            }

            return envs;
        } else {
            return {};
        }
    }

    get onProgress(): vscode.Event<ProgressMessage> {
        return (_cb: (ev: ProgressMessage) => any) => new util.DummyDisposable();
    }

    /**
     * The current Kit. Starts out `null`, but once set, is never `null` again.
     * We do some separation here to protect ourselves: The `_baseKit` property
     * is `private`, so derived classes cannot change it, except via
     * `_setBaseKit`, which only allows non-null kits. This prevents the derived
     * classes from resetting the kit back to `null`.
     */
    private _kit: Kit | null = null;

    private _kitDetect: KitDetect | null = null;

    private _useCMakePresets: boolean = true;

    get useCMakePresets(): boolean {
        return this._useCMakePresets;
    }

    private _configurePreset: preset.ConfigurePreset | null = null;

    private _buildPreset: preset.BuildPreset | null = null;

    private _testPreset: preset.TestPreset | null = null;

    get testPreset(): preset.TestPreset | null {
        return this._testPreset;
    }

    private _packagePreset: preset.PackagePreset | null = null;

    get packagePreset(): preset.PackagePreset | null {
        return this._packagePreset;
    }

    private _workflowPreset: preset.WorkflowPreset | null = null;

    get workflowPreset(): preset.WorkflowPreset | null {
        return this._workflowPreset;
    }

    /**
     * Get the vscode root workspace folder.
     *
     * @returns Returns the vscode root workspace folder. Returns `null` if no folder is open or the folder uri is not a
     * `file://` scheme.
     */
    get workspaceFolder() {
        return this.__workspaceFolder;
    }

    protected variantKeywordSettings: Map<string, string> | null = null;

    /**
     * The options that will be passed to `expand.expandString` for this driver.
     */
    get expansionOptions(): expand.ExpansionOptions {
        const ws_root = util.lightNormalizePath(this.workspaceFolder || '.');
        const target: Partial<TargetTriple> = parseTargetTriple(this._kitDetect?.triple ?? '') ?? {};
        const version = this._kitDetect?.version ?? '0.0';

        // Fill in default replacements
        const vars: expand.KitContextVars = {
            buildKit: this._kit ? this._kit.name : '__unknownkit__',
            buildType: this.currentBuildType,
            generator: this.generatorName || 'null',
            workspaceFolder: ws_root,
            workspaceFolderBasename: path.basename(ws_root),
            workspaceHash: util.makeHashString(ws_root),
            workspaceRoot: ws_root,
            workspaceRootFolderName: path.basename(ws_root),
            userHome: paths.userHome,
            buildKitVendor: this._kitDetect?.vendor ?? '__unknown_vendor__',
            buildKitTriple: this._kitDetect?.triple ?? '__unknown_triple__',
            buildKitVersion: version,
            buildKitHostOs: process.platform,
            buildKitTargetOs: target.targetOs ?? '__unknown_target_os__',
            buildKitTargetArch: target.targetArch ?? '__unknown_target_arch__',
            buildKitVersionMajor: majorVersionSemver(version),
            buildKitVersionMinor: minorVersionSemver(version),
            sourceDir: this.sourceDir,
            // DEPRECATED EXPANSION: Remove this in the future:
            projectName: 'ProjectName'
        };

        // Update Variant replacements
        const variantVars: { [key: string]: string } = {};
        if (this.variantKeywordSettings) {
            // allows to expansion of variant option keyword and replace it by the variant option short name
            this.variantKeywordSettings.forEach((value: string, key: string) => variantVars[key] = value);
        }

        return { vars, variantVars };
    }

    static sourceDirExpansionOptions(workspaceFolderFspath: string | null): expand.ExpansionOptions {
        const ws_root = util.lightNormalizePath(workspaceFolderFspath || '.');

        // Fill in default replacements
        const vars: expand.MinimalPresetContextVars = {
            generator: 'generator',
            workspaceFolder: ws_root,
            workspaceFolderBasename: path.basename(ws_root),
            sourceDir: '${sourceDir}',
            workspaceHash: util.makeHashString(ws_root),
            workspaceRoot: ws_root,
            workspaceRootFolderName: path.basename(ws_root),
            userHome: paths.userHome
        };

        return { vars };
    }

    getEffectiveSubprocessEnvironment(opts?: proc.ExecutionOptions): Environment {
        const cur_env = process.env;
        const kit_env = (this.config.ignoreKitEnv) ? EnvironmentUtils.create() : this._kitEnvironmentVariables;
        return EnvironmentUtils.merge([cur_env, kit_env, opts?.environment]);
    }

    executeCommand(command: string, args?: string[], consumer?: proc.OutputConsumer, options?: proc.ExecutionOptions): proc.Subprocess {
        const environment = this.getEffectiveSubprocessEnvironment(options);
        const exec_options = { ...options, environment };
        return proc.execute(command, args, consumer, exec_options);
    }

    /**
     * File compilation terminals. This is a map, rather than a single terminal
     * instance for two reasons:
     *
     * 1. Different compile commands may require different environment variables.
     * 2. Different compile commands may require different working directories.
     *
     * The key of each terminal is generated deterministically in `runCompileCommand()`
     * based on the CWD and environment of the compile command.
     */
    private readonly _compileTerms = new Map<string, vscode.Terminal>();

    /**
     * Launch the given compilation command in an embedded terminal.
     * @param cmd The compilation command from a compilation database to run
     */
    async runCompileCommand(cmd: CompileCommand): Promise<vscode.Terminal> {
        const env = await this.getCMakeBuildCommandEnvironment();

        if (this.useCMakePresets && this._buildPreset && checkBuildOverridesPresent(this.config)) {
            log.info(localize('compile.with.overrides', 'NOTE: You are compiling with preset {0}, but there are some overrides being applied from your VS Code settings.', this._buildPreset.displayName ?? this._buildPreset.name));
        }

        const key = `${cmd.directory}${JSON.stringify(env)}`;
        let existing = this._compileTerms.get(key);
        if (existing && this.config.clearOutputBeforeBuild) {
            this._compileTerms.delete(key);
            existing.dispose();
            existing = undefined;
        }
        if (!existing) {
            const shellPath = process.platform === 'win32' ? 'cmd.exe' : undefined;
            const term = vscode.window.createTerminal({
                name: localize('file.compilation', 'File Compilation'),
                cwd: cmd.directory,
                env,
                shellPath
            });
            this._compileTerms.set(key, term);
            existing = term;
        }
        existing.show();
        existing.sendText(cmd.command + '\r\n');
        return existing;
    }

    /**
     * Remove the prior CMake configuration files.
     */
    protected async _cleanPriorConfiguration() {
        const build_dir = this.binaryDir;
        const cache = this.cachePath;
        const cmake_files = path.join(build_dir, 'CMakeFiles');
        if (await fs.exists(cache)) {
            log.info(localize('removing', 'Removing {0}', cache));
            try {
                await fs.unlink(cache);
            } catch {
                log.error(localize('unlink.failed', 'Failed to remove cache file {0}', this.cachePath));
            }
        }
        if (await fs.exists(cmake_files)) {
            log.info(localize('removing', 'Removing {0}', cmake_files));
            await fs.rmdir(cmake_files);
        }
    }

    /**
     * Change the current configure preset. This lets the driver reload, if necessary.
     * @param configurePreset The new configure preset
     */
    async setConfigurePreset(configurePreset: preset.ConfigurePreset | null): Promise<void> {
        if (configurePreset) {
            log.info(localize('switching.to.config.preset', 'Switching to configure preset: {0}', configurePreset.name));

            const newBinaryDir = configurePreset.binaryDir;
            const needs_clean = this.binaryDir === newBinaryDir && preset.configurePresetChangeNeedsClean(configurePreset, this._configurePreset);
            await this.doSetConfigurePreset(needs_clean, async () => {
                await this._setConfigurePreset(configurePreset);
            });
        } else {
            log.info(localize('unsetting.config.preset', 'Unsetting configure preset'));

            await this.doSetConfigurePreset(false, async () => {
                await this._setConfigurePreset(configurePreset);
            });
        }
    }

    private async _setConfigurePreset(configurePreset: preset.ConfigurePreset | null): Promise<void> {
        this._configurePreset = configurePreset;
        log.debug(localize('cmakedriver.config.preset.set.to', 'CMakeDriver configure preset set to {0}', configurePreset?.name || null));

        this._binaryDir = configurePreset?.binaryDir || '';

        if (configurePreset) {
            if (configurePreset.generator) {
                this._generator = {
                    name: configurePreset.generator,
                    platform: configurePreset.architecture ? getValue(configurePreset.architecture) : undefined,
                    toolset: configurePreset.toolset ? getValue(configurePreset.toolset) : undefined
                };
            } else {
                log.debug(localize('no.generator', 'No generator specified'));
            }
        } else {
            this._generator = null;
        }
    }

    /**
     * Change the current build preset
     * @param buildPreset The new build preset
     */
    async setBuildPreset(buildPreset: preset.BuildPreset | null): Promise<void> {
        if (buildPreset) {
            log.info(localize('switching.to.build.preset', 'Switching to build preset: {0}', buildPreset.name));
        } else {
            log.info(localize('unsetting.build.preset', 'Unsetting build preset'));
        }

        await this.doSetBuildPreset(async () => {
            await this._setBuildPreset(buildPreset);
        });
    }

    private async _setBuildPreset(buildPreset: preset.BuildPreset | null): Promise<void> {
        this._buildPreset = buildPreset;
        log.debug(localize('cmakedriver.build.preset.set.to', 'CMakeDriver build preset set to {0}', buildPreset?.name || null));
    }

    /**
     * Change the current test preset
     * @param testPreset The new test preset
     */
    async setTestPreset(testPreset: preset.TestPreset | null): Promise<void> {
        if (testPreset) {
            log.info(localize('switching.to.test.preset', 'Switching to test preset: {0}', testPreset.name));
        } else {
            log.info(localize('unsetting.test.preset', 'Unsetting test preset'));
        }

        await this.doSetTestPreset(async () => {
            await this._setTestPreset(testPreset);
        });
    }

    private async _setTestPreset(testPreset: preset.TestPreset | null): Promise<void> {
        this._testPreset = testPreset;
        log.debug(localize('cmakedriver.test.preset.set.to', 'CMakeDriver test preset set to {0}', testPreset?.name || null));
    }

    /**
     * Change the current package preset
     * @param packagePreset The new package preset
     */
    async setPackagePreset(packagePreset: preset.PackagePreset | null): Promise<void> {
        if (packagePreset) {
            log.info(localize('switching.to.package.preset', 'Switching to package preset: {0}', packagePreset.name));
        } else {
            log.info(localize('unsetting.package.preset', 'Unsetting package preset'));
        }

        await this.doSetPackagePreset(async () => {
            await this._setPackagePreset(packagePreset);
        });
    }

    private async _setPackagePreset(packagePreset: preset.PackagePreset | null): Promise<void> {
        this._packagePreset = packagePreset;
        log.debug(localize('cmakedriver.package.preset.set.to', 'CMakeDriver package preset set to {0}', packagePreset?.name || null));
    }

    /**
     * Change the current workflow preset
     * @param workflowPreset The new workflow preset
     */
    async setWorkflowPreset(workflowPreset: preset.WorkflowPreset | null): Promise<void> {
        if (workflowPreset) {
            log.info(localize('switching.to.workflow.preset', 'Switching to workflow preset: {0}', workflowPreset.name));
        } else {
            log.info(localize('unsetting.workflow.preset', 'Unsetting workflow preset'));
        }

        await this.doSetWorkflowPreset(async () => {
            await this._setWorkflowPreset(workflowPreset);
        });
    }

    private async _setWorkflowPreset(workflowPreset: preset.WorkflowPreset | null): Promise<void> {
        this._workflowPreset = workflowPreset;
        log.debug(localize('cmakedriver.workflow.preset.set.to', 'CMakeDriver workflow preset set to {0}', workflowPreset?.name || null));
    }

    /**
     * Ensure that variables are up to date (e.g. sourceDirectory, buildDirectory, env, installDirectory)
     */
    async refreshSettings() {
        await this._refreshExpansions();
    }

    /**
     * Change the current kit. This lets the driver reload, if necessary.
     * @param kit The new kit
     */
    async setKit(kit: Kit, preferredGenerators: CMakeGenerator[]): Promise<void> {
        if (this.useCMakePresets) {
            log.info(localize('skip.set.kit', 'Using preset, skip setting kit: {0}', kit.name));
            return;
        }

        log.info(localize('switching.to.kit', 'Switching to kit: {0}', kit.name));

        const oldBinaryDir = this.binaryDir;
        const needsCleanIfKitChange = kitChangeNeedsClean(kit, this._kit);
        await this.doSetKit(async () => {
            await this._setKit(kit, preferredGenerators);
            await this._refreshExpansions();
            const scope = this.workspaceFolder ? vscode.Uri.file(this.workspaceFolder) : undefined;
            const newBinaryDir = util.lightNormalizePath(await expand.expandString(this.config.buildDirectory(this.isMultiProject, scope), this.expansionOptions));
            if (needsCleanIfKitChange && (newBinaryDir === oldBinaryDir)) {
                await this._cleanPriorConfiguration();
            }
        });
    }

    private async _setKit(kit: Kit, preferredGenerators: CMakeGenerator[]): Promise<void> {
        this._kit = Object.seal({ ...kit });
        this._kitDetect = await getKitDetect(this._kit);
        log.debug(localize('cmakedriver.kit.set.to', 'CMakeDriver Kit set to {0}', kit.name));
        this._kitEnvironmentVariables = await effectiveKitEnvironment(kit, this.expansionOptions);

        if (kit.preferredGenerator) {
            preferredGenerators.push(kit.preferredGenerator);
        }

        // If no preferred generator is defined by the current kit or the user settings,
        // it's time to consider the defaults.
        if (preferredGenerators.length === 0) {
            preferredGenerators.push({ name: "Ninja" });
            preferredGenerators.push({ name: "Unix Makefiles" });
        }

        // Use the "best generator" selection logic only if the user did not define already
        // in settings (via "cmake.generator") a particular generator to be used.
        if (this.config.generator) {
            this._generator = {
                name: this.config.generator,
                platform: this.config.platform || undefined,
                toolset: this.config.toolset || undefined
            };
        } else {
            this._generator = await this.findBestGenerator(preferredGenerators);
        }
    }

    protected abstract doSetConfigurePreset(needsClean: boolean, cb: () => Promise<void>): Promise<void>;
    protected abstract doSetBuildPreset(cb: () => Promise<void>): Promise<void>;
    protected abstract doSetTestPreset(cb: () => Promise<void>): Promise<void>;
    protected abstract doSetPackagePreset(cb: () => Promise<void>): Promise<void>;
    protected abstract doSetWorkflowPreset(cb: () => Promise<void>): Promise<void>;

    protected abstract doSetKit(cb: () => Promise<void>): Promise<void>;

    protected get generator(): CMakeGenerator | null {
        return this._generator;
    }
    protected _generator: CMakeGenerator | null = null;
    /**
     * The CMAKE_BUILD_TYPE to use
     */
    private _variantBuildType: string = 'Debug';

    /**
     * The arguments to pass to CMake during a configuration according to the current variant
     */
    private _variantConfigureSettings: ConfigureArguments = {};

    /**
     * Determine if we set BUILD_SHARED_LIBS to TRUE or FALSE
     */
    private _variantLinkage: ('static' | 'shared' | null) = null;

    /**
     * Environment variables defined by the current variant
     */
    private _variantEnv: Environment = EnvironmentUtils.create();

    /**
     * Change the current options from the variant.
     * @param opts The new options
     * @param keywordSetting Variant Keywords for identification of a variant option
     */
    async setVariant(opts: VariantOption, keywordSetting: Map<string, string> | null) {
        log.debug(localize('setting.new.variant', 'Setting new variant {0}', opts.short || '(Unnamed)'));
        this._variantBuildType = opts.buildType || this._variantBuildType;
        this._variantConfigureSettings = opts.settings || this._variantConfigureSettings;
        this._variantLinkage = opts.linkage || null;
        this._variantEnv = EnvironmentUtils.create(opts.env);
        this.variantKeywordSettings = keywordSetting || null;
        await this._refreshExpansions();
    }

    protected doRefreshExpansions(cb: () => Promise<void>): Promise<void> {
        return cb();
    }

    private async _refreshExpansions(configurePreset?: preset.ConfigurePreset | null) {
        return this.doRefreshExpansions(async () => {
            this.sourceDir = await util.normalizeAndVerifySourceDir(this.sourceDirUnexpanded, CMakeDriver.sourceDirExpansionOptions(this.workspaceFolder));

            const opts = this.expansionOptions;
            opts.envOverride = await this.getConfigureEnvironment(configurePreset);

            if (!this.useCMakePresets) {
                const scope = this.workspaceFolder ? vscode.Uri.file(this.workspaceFolder) : undefined;
                this._binaryDir = util.lightNormalizePath(await expand.expandString(this.config.buildDirectory(this.isMultiProject, scope), opts));

                const installPrefix = this.config.installPrefix;
                if (installPrefix) {
                    this._installDir = util.lightNormalizePath(await expand.expandString(installPrefix, opts));
                }
            }
        });
    }

    /**
     * Path to where the root CMakeLists.txt file should be
     */
    get mainListFile(): string {
        const file = path.join(this.sourceDir, 'CMakeLists.txt');
        return util.lightNormalizePath(file);
    }

    /**
     * Directory where build output is stored.
     */
    get binaryDir(): string {
        return this._binaryDir;
    }
    private _binaryDir = '';

    /**
     * Directory where the targets will be installed.
     */
    private get installDir(): string | null {
        return this._installDir;
    }
    private _installDir: string | null = null;

    /**
     * @brief Get the path to the CMakeCache file in the build directory
     */
    get cachePath(): string {
        // TODO: Cache path can change if build dir changes at runtime
        const file = path.join(this.binaryDir, 'CMakeCache.txt');
        return util.lightNormalizePath(file);
    }

    /**
     * Get the current build type, according to the current selected variant.
     *
     * This is the value passed to CMAKE_BUILD_TYPE or --config for multiconf
     */
    get currentBuildType(): string {
        if (this.useCMakePresets) {
            if ((this.isMultiConfig || this.isMultiConfFast) && this._buildPreset?.configuration) {
                return this._buildPreset.configuration;
            }
            const buildType = this._configurePreset?.cacheVariables?.['CMAKE_BUILD_TYPE'];
            if (util.isString(buildType)) {
                return buildType;
            } else if (buildType && typeof buildType === 'object' && util.isString(buildType.value)) {
                return buildType.value;
            }
            return 'Debug'; // Default to debug
        } else {
            return this._variantBuildType;
        }
    }

    private _isMultiConfig: boolean = false;
    get isMultiConfig(): boolean {
        return this._isMultiConfig;
    }
    set isMultiConfig(v: boolean) {
        this._isMultiConfig = v;
    }

    get isMultiConfFast(): boolean {
        return this.generatorName ? util.isMultiConfGeneratorFast(this.generatorName) : false;
    }

    /**
     * Get the name of the current CMake generator, or `null` if we have not yet
     * configured the project.
     */
    abstract get generatorName(): string | null;

    get allTargetName(): string {
        const gen = this.generatorName;
        if (gen && (gen.includes('Visual Studio') || gen.toLowerCase().includes('xcode'))) {
            return 'ALL_BUILD';
        } else {
            return 'all';
        }
    }

    /**
     * The ID of the current compiler, as best we can tell
     */
    get compilerID(): string | null {
        const entries = this.cmakeCacheEntries;
        const languages = ['CXX', 'C', 'CUDA'];
        for (const lang of languages) {
            const entry = entries.get(`CMAKE_${lang}_COMPILER`);
            if (!entry) {
                continue;
            }
            const compiler = entry.value as string;
            if (compiler.endsWith('cl.exe')) {
                return 'MSVC';
            } else if (/g(cc|\+\+)/.test(compiler)) {
                return 'GNU';
            } else if (/clang(\+\+)?[^/]*/.test(compiler)) {
                return 'Clang';
            }
        }
        return null;
    }

    get linkerID(): string | null {
        const entries = this.cmakeCacheEntries;
        const entry = entries.get('CMAKE_LINKER');
        if (!entry) {
            return null;
        }
        const linker = entry.value as string;
        if (linker.endsWith('link.exe')) {
            return 'MSVC';
        } else if (linker.endsWith('ld')) {
            return 'GNU';
        }
        return null;
    }

    get cmakePathFromPreset(): string | undefined {
        if (!this.useCMakePresets) {
            return;
        }
        return this._configurePreset?.cmakeExecutable;
    }

    public async testHaveCommand(program: string, args: string[] = ['--version']): Promise<boolean> {
        const child = this.executeCommand(program, args, undefined, { silent: true });
        try {
            const result = await child.result;
            log.trace(localize('command.version.test.return.code', '{0} returned code {1}', `"${program} ${args.join(' ')}"`, nullableValueToString(result.retc)));
            return result.retc === 0;
        } catch (e: any) {
            const e2: NodeJS.ErrnoException = e;
            log.debug(localize('command.version.test.return.code', '{0} returned code {1}', `"${program} ${args.join(' ')}"`, nullableValueToString(e2.code)));
            if (e2.code === 'ENOENT') {
                return false;
            }
            throw e;
        }
    }

    isCommonGenerator(genName: string): boolean {
        return genName === 'Ninja' || genName === 'Ninja Multi-Config' ||
            genName === 'MinGW Makefiles' || genName === 'NMake Makefiles' ||
            genName === 'Unix Makefiles' || genName === 'MSYS Makefiles';
    }

    /**
     * Picks the best generator to use on the current system
     */
    async findBestGenerator(preferredGenerators: CMakeGenerator[]): Promise<CMakeGenerator | null> {
        log.debug(localize('trying.to.detect.generator', 'Trying to detect generator supported by system'));
        const platform = process.platform;

        for (const gen of preferredGenerators) {
            const gen_name = gen.name;
            const generator_present = await (async (): Promise<boolean> => {
                if (gen_name === 'Ninja' || gen_name === 'Ninja Multi-Config') {
                    return await this.testHaveCommand('ninja') || this.testHaveCommand('ninja-build');
                }
                if (gen_name === 'MinGW Makefiles') {
                    return platform === 'win32' && this.testHaveCommand('mingw32-make');
                }
                if (gen_name === 'NMake Makefiles') {
                    return platform === 'win32' && this.testHaveCommand('nmake', ['/?']);
                }
                if (gen_name === 'Unix Makefiles') {
                    return this.testHaveCommand('make');
                }
                if (gen_name === 'MSYS Makefiles') {
                    return platform === 'win32' && this.testHaveCommand('make');
                }
                return false;
            })();
            if (!generator_present) {
                const vsMatch = /^(Visual Studio \d{2} \d{4})($|\sWin64$|\sARM$)/.exec(gen.name);
                if (platform === 'win32' && vsMatch) {
                    return {
                        name: vsMatch[1],
                        platform: gen.platform || vsMatch[2],
                        toolset: gen.toolset
                    };
                }
                if (gen.name.toLowerCase().startsWith('xcode') && platform === 'darwin') {
                    return gen;
                }
                // If it is not a common generator that we can find, but it is a known cmake generator (cmakeGenerators), return it.
                if (this.cmakeGenerators.indexOf(gen.name) >= 0 && !this.isCommonGenerator(gen.name)) {
                    return gen;
                }
                continue;
            } else {
                return gen;
            }
        }
        return null;
    }

    private isConfigInProgress: boolean = false;

    public configOrBuildInProgress(): boolean {
        return this.configInProgress() || this.cmakeBuildRunner.isBuildInProgress();
    }

    public configInProgress(): boolean {
        return this.isConfigInProgress;
    }

    /**
     * Perform a clean configure. Deletes cached files before running the config
     * @param consumer The output consumer
     */
    public async cleanConfigure(trigger: ConfigureTrigger, extra_args: string[], consumer?: proc.OutputConsumer, debuggerInformation?: DebuggerInformation): Promise<ConfigureResult> {
        if (this.isConfigInProgress) {
            await this.preconditionHandler(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
            return { result: -1, resultType: ConfigureResultType.ForcedCancel };
        }
        if (this.cmakeBuildRunner.isBuildInProgress()) {
            await this.preconditionHandler(CMakePreconditionProblems.BuildIsAlreadyRunning);
            return { result: -1, resultType: ConfigureResultType.ConfigureInProgress };
        }
        this.isConfigInProgress = true;
        await this.doPreCleanConfigure();
        this.isConfigInProgress = false;

        return this.configure(trigger, extra_args, consumer, debuggerInformation);
    }

    async testCompilerVersion(program: string, cwd: string, arg: string | undefined, regexp: RegExp, captureGroup: number): Promise<string | undefined> {
        const args = [];
        if (arg) {
            args.push(arg);
        }
        const child = this.executeCommand(program, args, undefined, { silent: true, cwd });
        try {
            const result = await child.result;
            log.trace(localize('command.version.test.return.code', '{0} returned code {1}', `"${program} ${arg}"`, nullableValueToString(result.retc)));
            // Various compilers will output into stdout, others in stderr.
            // It's safe to concat them into one string to search in, since it's enough to analyze
            // the first match (stderr can't print a different version than stdout).
            const versionLine = result.stderr.concat(result.stdout);
            const match = regexp.exec(versionLine);
            // Make sure that all the regexp in compilerAllowList are written in a way that match[2] is the indeed the version.
            // This number may change in future as we add more cases and index 2 might be difficult to ensure for all of them.
            return match ? match[captureGroup] : "error";
        } catch (e: any) {
            const e2: NodeJS.ErrnoException = e;
            log.debug(localize('compiler.version.return.code', '{0} returned code {1}', `"${program} ${arg}"`, nullableValueToString(e2.code)));
            return "error";
        }
    }

    private readonly compilerAllowList = [
        // Most common version output (gcc and family):
        //     gcc -v: gcc version 9.3.0 (Ubuntu 9.3.0-17ubuntu1~20.04)
        {
            name: "gcc",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "cc",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "g++",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "cpp",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "c++",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "dcc",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "eccp",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "edgcpfe",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "mcc",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "tcc",
            versionSwitch: "-v",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        // cl does not have a version switch but it outputs the compiler version on stderr
        // when no source files arguments are given
        {
            name: "cl",
            versionSwitch: undefined,
            versionOutputRegexp: ".* Compiler Version (.*) for .*",
            captureGroup: 1
        },
        // gpp --version: gpp 2.25
        {
            name: "gpp",
            versionSwitch: "--version",
            versionOutputRegexp: "gpp ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "icc",
            versionSwitch: "-V",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "kcc",
            versionSwitch: "-V",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "pgc++",
            versionSwitch: "-V",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "aCC",
            versionSwitch: "-V",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "armcc",
            versionSwitch: "--version_number",
            versionOutputRegexp: ".*",
            captureGroup: 1
        },
        {
            name: "bcc32",
            versionSwitch: "--version",
            versionOutputRegexp: ".* C\\+\\+ ([^\\s]+) for .*",
            captureGroup: 1
        },
        {
            name: "bcc32c",
            versionSwitch: "--version",
            versionOutputRegexp: ".* C\\+\\+ ([^\\s]+) for .*",
            captureGroup: 1
        },
        {
            name: "bcc64",
            versionSwitch: "--version",
            versionOutputRegexp: ".* C\\+\\+ ([^\\s]+) for .*",
            captureGroup: 1
        },
        {
            name: "bcca",
            versionSwitch: "--version",
            versionOutputRegexp: ".* C\\+\\+ ([^\\s]+) for .*",
            captureGroup: 1
        },
        {
            name: "bccios",
            versionSwitch: "--version",
            versionOutputRegexp: ".* C\\+\\+ ([^\\s]+) for .*",
            captureGroup: 1
        },
        {
            name: "bccosx",
            versionSwitch: "--version",
            versionOutputRegexp: ".* C\\+\\+ ([^\\s]+) for .*",
            captureGroup: 1
        },
        // clang -v: clang version 10.0.0-4ubuntu1
        // or        clang version 5.0.0 (tags/RELEASE_500/final)
        {
            name: "clang",
            versionSwitch: "-v",
            versionOutputRegexp: "(Apple LLVM|clang) version ([^\\s-]+)",
            captureGroup: 2
        },
        {
            name: "clang-cl",
            versionSwitch: "-v",
            versionOutputRegexp: "(Apple LLVM|clang) version ([^\\s-]+)",
            captureGroup: 2
        },
        {
            name: "clang++",
            versionSwitch: "-v",
            versionOutputRegexp: "(Apple LLVM|clang) version ([^\\s-]+)",
            captureGroup: 2
        },
        {
            name: "armclang",
            versionSwitch: "-v",
            versionOutputRegexp: "(Apple LLVM|clang) version ([^\\s-]+)",
            captureGroup: 2
        },
        {
            name: "openCC",
            versionSwitch: "--version",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        {
            name: "pathCC",
            versionSwitch: "--version",
            versionOutputRegexp: "version ([^\\s]+)",
            captureGroup: 1
        },
        // We don't know of version switches for the following compilers so define only the compiler name
        {
            name: "dmc",
            versionSwitch: undefined,
            versionOutputRegexp: undefined
        },
        {
            name: "tpp",
            versionSwitch: undefined,
            versionOutputRegexp: undefined
        },
        {
            name: "vac++",
            versionSwitch: undefined,
            versionOutputRegexp: undefined
        },
        {
            name: "xlc++",
            versionSwitch: undefined,
            versionOutputRegexp: undefined
        }
    ];

    async getCompilerVersion(compilerPath: string): Promise<CompilerInfo> {
        // Compiler name and path as coming from the kit.
        const compilerName = path.parse(compilerPath).name;
        const compilerDir = path.parse(compilerPath).dir;

        // Find an equivalent in the compilers allowed list.
        // To avoid finding "cl" instead of "clang" or "g++" instead of "clang++",
        // sort the array from lengthier to shorter, so that the find operation
        // would return the most precise match.
        // The find condition must be "includes" instead of "equals"
        // (which wouldn't otherwise need the sort) to avoid implementing separate handling
        // for compiler file name prefixes and suffixes related to targeted architecture.
        const sortedCompilerAllowList = this.compilerAllowList.sort((a, b) => b.name.length - a.name.length);
        const compiler = sortedCompilerAllowList.find(comp => compilerName.includes(comp.name));

        // Mask any unrecognized compiler as "other" to hide private information
        let allowedCompilerName = compiler ? compiler.name : "other";

        // If we recognize the compiler or not, we can still include information about triplet names cross compilers
        if (compilerName.includes("aarch64")) {
            allowedCompilerName += "-aarch64";
        } else if (compilerName.includes("arm64")) {
            allowedCompilerName += "-arm64";
        } else if (compilerName.includes("arm")) {
            allowedCompilerName += "-arm";
        }
        if (compilerName.includes("eabi")) {
            allowedCompilerName += "-eabi";
        }

        // If we don't have a regexp, we can't obtain the compiler version information.
        // With an undefined switch we still can get the version information (if regexp is defined),
        // since some compilers can output their version without a specific switch.
        let version;
        if (compiler?.versionOutputRegexp) {
            version = await this.testCompilerVersion(compilerName, compilerDir, compiler?.versionSwitch, RegExp(compiler.versionOutputRegexp, "mgi"), compiler.captureGroup) || "unknown";
        } else {
            version = "unknown";
        }

        return { name: allowedCompilerName, version };
    }

    /**
     * The list of generators CMake supports as of 3.21
     */
    private readonly cmakeGenerators = [
        "Visual Studio 17 2022",
        "Visual Studio 16 2019",
        "Visual Studio 15 2017",
        "Visual Studio 14 2015",
        "Visual Studio 12 2013",
        "Visual Studio 11 2012",
        "Visual Studio 10 2010",
        "Visual Studio 9 2008",
        "Borland Makefiles",
        "NMake Makefiles",
        "NMake Makefiles JOM",
        "MSYS Makefiles",
        "MinGW Makefiles",
        "Green Hills MULTI",
        "Unix Makefiles",
        "Ninja",
        "Ninja Multi-Config",
        "Watcom WMake",
        "CodeBlocks - MinGW Makefiles",
        "CodeBlocks - NMake Makefiles",
        "CodeBlocks - NMake Makefiles JOM",
        "CodeBlocks - Ninja",
        "CodeBlocks - Unix Makefiles",
        "CodeLite - MinGW Makefiles",
        "CodeLite - NMake Makefiles",
        "CodeLite - Ninja",
        "CodeLite - Unix Makefiles",
        "Eclipse CDT4 - NMake Makefiles",
        "Eclipse CDT4 - MinGW Makefiles",
        "Eclipse CDT4 - Ninja",
        "Eclipse CDT4 - Unix Makefiles",
        "Kate - MinGW Makefiles",
        "Kate - NMake Makefiles",
        "Kate - Ninja",
        "Kate - Unix Makefiles",
        "Sublime Text 2 - MinGW Makefiles",
        "Sublime Text 2 - NMake Makefiles",
        "Sublime Text 2 - Ninja",
        "Sublime Text 2 - Unix Makefiles"
    ];

    private getGeneratorNameForTelemetry(generator: string | null = this.generatorName): string {
        if (generator) {
            return this.cmakeGenerators.find(g => generator.startsWith(g)) ?? 'other';
        }
        return 'other';
    }

    private countHiddenPresets(presets: preset.Preset[]): number {
        let count = 0;
        for (const p of presets) {
            if (p.hidden) {
                count++;
            }
        }
        return count;
    }

    public shouldUseCachedConfiguration(trigger: ConfigureTrigger): boolean {
        return (this.isCacheConfigSupported && !this.isConfiguredAtLeastOnce &&
            trigger === ConfigureTrigger.configureWithCache && !this.config.configureOnOpen) ?
            true : false;
    }

    public async generateConfigArgsFromPreset(configPreset: preset.ConfigurePreset): Promise<string[]> {
        // Cache flags will construct the command line for cmake.
        const init_cache_flags = this.generateInitCacheFlags();
        // Make sure that we expand the config.configureArgs. Right now, preset args are expanded upon switching to the preset.
        return init_cache_flags.concat(preset.configureArgs(configPreset), await Promise.all(this.config.configureArgs.map(async (value) => expand.expandString(value, { ...this.expansionOptions, envOverride: await this.getConfigureEnvironment()}))));
    }

    public async generateConfigArgsFromSettings(extra_args: string[] = [], withoutCmakeSettings: boolean = false): Promise<string[]> {
        // Cache flags will construct the command line for cmake.
        const init_cache_flags = this.generateInitCacheFlags();
        const initial_common_flags = extra_args.concat(this.config.configureArgs);
        const common_flags = initial_common_flags.includes("--warn-unused-cli") ? initial_common_flags : initial_common_flags.concat("--no-warn-unused-cli");
        const define_flags = withoutCmakeSettings ? [] : this.generateCMakeSettingsFlags();
        const final_flags = common_flags.concat(define_flags, init_cache_flags);

        // Get expanded configure environment
        const expanded_configure_env = await this.getConfigureEnvironment();

        // Expand all flags
        const opts = this.expansionOptions;
        const expanded_flags_promises = final_flags.map(
            async (value: string) => expand.expandString(value, { ...opts, envOverride: expanded_configure_env }));
        return Promise.all(expanded_flags_promises);
    }

    async configure(trigger: ConfigureTrigger, extra_args: string[], consumer?: proc.OutputConsumer, debuggerInformation?: DebuggerInformation, withoutCmakeSettings: boolean = false, showCommandOnly?: boolean, presetOverride?: preset.ConfigurePreset, options?: proc.ExecutionOptions): Promise<ConfigureResult> {
        // Check if the configuration is using cache in the first configuration and adjust the logging messages based on that.
        const shouldUseCachedConfiguration: boolean = this.shouldUseCachedConfiguration(trigger);

        if (trigger === ConfigureTrigger.configureWithCache && !shouldUseCachedConfiguration) {
            log.debug(localize('no.cached.config', "No cached config could be used for IntelliSense"));
            return { result: -2, resultType: ConfigureResultType.NoCache };
        }
        if (this.isConfigInProgress) {
            await this.preconditionHandler(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
            return { result: -1, resultType: ConfigureResultType.ConfigureInProgress };
        }
        if (this.cmakeBuildRunner.isBuildInProgress()) {
            await this.preconditionHandler(CMakePreconditionProblems.BuildIsAlreadyRunning);
            return { result: -1, resultType: ConfigureResultType.BuildInProgress };
        }
        this.isConfigInProgress = true;
        try {
            // _beforeConfigureOrBuild needs to refresh expansions early because it reads various settings
            // (example: cmake.sourceDirectory).
            await this._refreshExpansions(presetOverride);
            if (!showCommandOnly) {
                if (!shouldUseCachedConfiguration) {
                    log.debug(localize('start.configure', 'Start configure'), extra_args);
                } else {
                    log.debug(localize('use.cached.configuration', 'Use cached configuration'), extra_args);
                }
            }

            const pre_check_ok = await this._beforeConfigureOrBuild(showCommandOnly);
            if (!pre_check_ok) {
                return { result: -2, resultType: ConfigureResultType.Other };
            }

            let expanded_flags: string[];
            let defaultPresetName: string | undefined;
            if (this.useCMakePresets) {
                defaultPresetName = this._configurePreset?.name;
                const configurePreset: preset.ConfigurePreset | undefined | null = (trigger === ConfigureTrigger.taskProvider) ? presetOverride : this._configurePreset;
                if (!configurePreset) {
                    log.debug(localize('no.config.Preset', 'No configure preset selected'));
                    return { result: -3, resultType: ConfigureResultType.NoConfigurePreset };
                }
                // For now, fields in presets are expanded when the preset is selected
                expanded_flags = await this.generateConfigArgsFromPreset(configurePreset);

                if (!showCommandOnly && !shouldUseCachedConfiguration && checkConfigureOverridesPresent(this.config)) {
                    log.info(localize('configure.with.overrides', 'NOTE: You are configuring with preset {0}, but there are some overrides being applied from your VS Code settings.', configurePreset.displayName ?? configurePreset.name));
                }
            } else {
                expanded_flags = await this.generateConfigArgsFromSettings(extra_args, withoutCmakeSettings);
            }
            if (!shouldUseCachedConfiguration) {
                log.trace(localize('cmake.flags.are', 'CMake flags are {0}', JSON.stringify(expanded_flags)));
            }

            // A more complete round of expansions
            await this._refreshExpansions(presetOverride);

            const timeStart: number = new Date().getTime();
            let retc: number;
            if (shouldUseCachedConfiguration) {
                retc = await this.doCacheConfigure();
                this._isConfiguredAtLeastOnce = true;
                return { result: retc, resultType: ConfigureResultType.NormalOperation };
            } else {
                retc = await this.doConfigure(expanded_flags, trigger, consumer, showCommandOnly, defaultPresetName, presetOverride, options, debuggerInformation);
                this._isConfiguredAtLeastOnce = true;
            }
            const timeEnd: number = new Date().getTime();

            const cmakeVersion = this.cmake.version;
            let telemetryProperties: telemetry.Properties;
            if (this.useCMakePresets) {
                telemetryProperties = {
                    CMakeExecutableVersion: cmakeVersion ? util.versionToString(cmakeVersion) : '',
                    CMakeGenerator: this.getGeneratorNameForTelemetry(presetOverride?.generator || this.generatorName),
                    Preset: this.useCMakePresets ? 'true' : 'false',
                    Trigger: trigger,
                    ShowCommandOnly: showCommandOnly ? 'true' : 'false'
                };
            } else {
                telemetryProperties = {
                    CMakeExecutableVersion: cmakeVersion ? util.versionToString(cmakeVersion) : '',
                    CMakeGenerator: this.getGeneratorNameForTelemetry(),
                    ConfigType: this.isMultiConfFast ? 'MultiConf' : this.currentBuildType || '',
                    Toolchain: this._kit?.toolchainFile ? 'true' : 'false', // UseToolchain?
                    Trigger: trigger,
                    ShowCommandOnly: showCommandOnly ? 'true' : 'false'
                };
            }

            if (this._kit?.compilers) {
                let cCompilerVersion;
                let cppCompilerVersion;
                if (this._kit.compilers["C"]) {
                    cCompilerVersion = await this.getCompilerVersion(this._kit.compilers["C"]);
                }

                if (this._kit.compilers["CXX"]) {
                    cppCompilerVersion = await this.getCompilerVersion(this._kit.compilers["CXX"]);
                }

                if (cCompilerVersion) {
                    telemetryProperties.CCompilerName = cCompilerVersion.name;
                    telemetryProperties.CCompilerVersion = cCompilerVersion.version;
                }

                if (cppCompilerVersion) {
                    telemetryProperties.CppCompilerName = cppCompilerVersion.name;
                    telemetryProperties.CppCompilerVersion = cppCompilerVersion.version;
                }
            } else if (this._kit?.visualStudio && this._kit.visualStudioArchitecture) {
                const env = await getVSKitEnvironment(this._kit);
                const dirs = env?.['Path']?.split(';') ?? [];
                let compilerPath = '';
                for (const dir of dirs) {
                    if (dir.indexOf('MSVC') > 0) {
                        compilerPath = path.join(dir, 'cl.exe');
                        break;
                    }
                }
                if (compilerPath) {
                    const compiler = await this.getCompilerVersion(compilerPath);
                    telemetryProperties.CCompilerVersion = compiler.version;
                    telemetryProperties.CppCompilerVersion = compiler.version;
                } else {
                    telemetryProperties.CCompilerVersion = 'unknown';
                    telemetryProperties.CppCompilerVersion = 'unknown';
                }
                telemetryProperties.CCompilerName = 'cl';
                telemetryProperties.CppCompilerName = 'cl';
            }

            if (this._kit?.visualStudioArchitecture) {
                telemetryProperties.VisualStudioArchitecture = this._kit?.visualStudioArchitecture;
            }

            const telemetryMeasures: telemetry.Measures = {
                Duration: timeEnd - timeStart
            };
            if (this.useCMakePresets && this.workspaceFolder) {
                const configurePresets = preset.configurePresets(this.workspaceFolder);
                const userConfigurePresets = preset.userConfigurePresets(this.workspaceFolder);
                const buildPresets = preset.buildPresets(this.workspaceFolder);
                const userBuildPresets = preset.userBuildPresets(this.workspaceFolder);
                const testPresets = preset.testPresets(this.workspaceFolder);
                const userTestPresets = preset.userTestPresets(this.workspaceFolder);
                const packagePresets = preset.packagePresets(this.workspaceFolder);
                const userPackagePresets = preset.userPackagePresets(this.workspaceFolder);
                const workflowPresets = preset.workflowPresets(this.workspaceFolder);
                const userWorkflowPresets = preset.userWorkflowPresets(this.workspaceFolder);
                telemetryMeasures['ConfigurePresets'] = configurePresets.length;
                telemetryMeasures['HiddenConfigurePresets'] = this.countHiddenPresets(configurePresets);
                telemetryMeasures['UserConfigurePresets'] = userConfigurePresets.length;
                telemetryMeasures['HiddenUserConfigurePresets'] = this.countHiddenPresets(userConfigurePresets);
                telemetryMeasures['BuildPresets'] = buildPresets.length;
                telemetryMeasures['HiddenBuildPresets'] = this.countHiddenPresets(buildPresets);
                telemetryMeasures['UserBuildPresets'] = userBuildPresets.length;
                telemetryMeasures['HiddenUserBuildPresets'] = this.countHiddenPresets(userBuildPresets);
                telemetryMeasures['TestPresets'] = testPresets.length;
                telemetryMeasures['HiddenTestPresets'] = this.countHiddenPresets(testPresets);
                telemetryMeasures['UserTestPresets'] = userTestPresets.length;
                telemetryMeasures['HiddenUserTestPresets'] = this.countHiddenPresets(userTestPresets);
                telemetryMeasures['PackagePresets'] = packagePresets.length;
                telemetryMeasures['HiddenPackagePresets'] = this.countHiddenPresets(packagePresets);
                telemetryMeasures['UserPackagePresets'] = userPackagePresets.length;
                telemetryMeasures['HiddenUserPackagePresets'] = this.countHiddenPresets(userPackagePresets);
                telemetryMeasures['WorkflowPresets'] = workflowPresets.length;
                telemetryMeasures['HiddenWorkflowPresets'] = this.countHiddenPresets(workflowPresets);
                telemetryMeasures['UserWorkflowPresets'] = userWorkflowPresets.length;
                telemetryMeasures['HiddenUserWorkflowPresets'] = this.countHiddenPresets(userWorkflowPresets);
            }
            if (consumer) {
                if (consumer instanceof CMakeOutputConsumer) {
                    let errorCount: number = 0;
                    let warningCount: number = 0;
                    consumer.diagnostics.forEach(v => {
                        if (v.diag.severity === 0) {
                            errorCount++;
                        } else if (v.diag.severity === 1) {
                            warningCount++;
                        }
                    });
                    telemetryMeasures['ErrorCount'] = errorCount;
                    telemetryMeasures['WarningCount'] = warningCount;
                } else if (!(consumer instanceof CustomBuildTaskTerminal)) {
                    // Wrong type: shouldn't get here, just in case
                    rollbar.error('Wrong build result type.');
                    telemetryMeasures['ErrorCount'] = retc ? 1 : 0;
                }
            }

            telemetry.logEvent('configure', telemetryProperties, telemetryMeasures);

            return { result: retc, resultType: ConfigureResultType.NormalOperation };
        } catch {
            log.info(localize('configure.failed', 'Failed to configure project'));
            return { result: -1, resultType: ConfigureResultType.NormalOperation };
        } finally {
            this.isConfigInProgress = false;
        }
    }

    private generateInitCacheFlags(): string[] {
        const cache_init_conf = this.config.cacheInit;
        let cache_init: string[] = [];
        if (cache_init_conf === null) {
            // Do nothing
        } else if (util.isString(cache_init_conf)) {
            cache_init = [cache_init_conf];
        } else {
            cache_init = cache_init_conf;
        }

        const flags: string[] = [];
        for (let init of cache_init) {
            if (!path.isAbsolute(init)) {
                init = path.join(this.sourceDir, init);
            }
            flags.push('-C', init);
        }
        return flags;
    }

    private generateCMakeSettingsFlags(): string[] {
        const settingMap: { [key: string]: util.CMakeValue } = {};

        if (this._variantLinkage !== null) {
            settingMap.BUILD_SHARED_LIBS = util.cmakeify(this._variantLinkage === 'shared');
        }

        const configurationScope = this.workspaceFolder ? vscode.Uri.file(this.workspaceFolder) : null;
        const config = vscode.workspace.getConfiguration("cmake", configurationScope);

        const allowBuildTypeOnMultiConfig = config.get<boolean>("setBuildTypeOnMultiConfig") || false;

        if (!this.isMultiConfFast || (this.isMultiConfFast && allowBuildTypeOnMultiConfig)) {
            // Mutliconf generators do not need the CMAKE_BUILD_TYPE property
            settingMap.CMAKE_BUILD_TYPE = util.cmakeify(this.currentBuildType);
        }

        // Only use the installPrefix config if the user didn't
        // provide one via configureSettings
        if (!settingMap.CMAKE_INSTALL_PREFIX && this.installDir) {
            settingMap.CMAKE_INSTALL_PREFIX = util.cmakeify(this.installDir);
        }

        try {
            util.objectPairs(this.config.configureSettings).forEach(([key, value]) => settingMap[key] = util.cmakeify(value));
        } catch (e: any) {
            log.error(e.message);
            throw e;
        }
        util.objectPairs(this._variantConfigureSettings).forEach(([key, value]) => settingMap[key] = util.cmakeify(value as string));

        // Export compile_commands.json
        const exportCompileCommandsSetting = config.get<boolean>("exportCompileCommandsFile");
        const exportCompileCommandsFile: boolean = exportCompileCommandsSetting === undefined ? true : (exportCompileCommandsSetting || false);
        settingMap.CMAKE_EXPORT_COMPILE_COMMANDS = util.cmakeify(exportCompileCommandsFile);

        console.assert(!!this._kit);
        if (!this._kit) {
            throw new Error(localize('no.kit.is.set', 'No kit is set!'));
        }
        if (this._kit.compilers) {
            log.debug(localize('using.compilers.in.for.configure', 'Using compilers in {0} for configure', this._kit.name));
            for (const lang in this._kit.compilers) {
                const compiler = this._kit.compilers[lang];
                settingMap[`CMAKE_${lang}_COMPILER`] = { type: 'FILEPATH', value: compiler };
            }
        }
        if (this._kit.toolchainFile) {
            log.debug(localize('using.cmake.toolchain.for.configure', 'Using CMake toolchain {0} for configuring', this._kit.name));
            settingMap.CMAKE_TOOLCHAIN_FILE = { type: 'FILEPATH', value: this._kit.toolchainFile };
        }
        if (this._kit.cmakeSettings) {
            util.objectPairs(this._kit.cmakeSettings)
                .forEach(([key, value]) => settingMap[key] = util.cmakeify(value as string));
        }

        return util.objectPairs(settingMap).map(([key, value]) => {
            switch (value.type) {
                case 'UNKNOWN':
                case '':
                    return `-D${key}=${value.value}`;
                default:
                    return `-D${key}:${value.type}=${value.value}`;
            }
        });
    }

    async build(targets?: string[], consumer?: proc.OutputConsumer, isBuildCommand?: boolean): Promise<number | null> {
        log.debug(localize('start.build', 'Start build'), targets?.join(', ') || '');
        if (this.isConfigInProgress) {
            await this.preconditionHandler(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
            return -1;
        }
        if (this.cmakeBuildRunner.isBuildInProgress()) {
            await this.preconditionHandler(CMakePreconditionProblems.BuildIsAlreadyRunning);
            return -1;
        }
        this.cmakeBuildRunner.setBuildInProgress(true);

        const pre_build_ok = await this.doPreBuild();
        if (!pre_build_ok) {
            this.cmakeBuildRunner.setBuildInProgress(false);
            return -1;
        }
        const timeStart: number = new Date().getTime();
        const child = await this._doCMakeBuild(targets, consumer, isBuildCommand);
        const timeEnd: number = new Date().getTime();
        const duration: number = timeEnd - timeStart;
        log.info(localize('build.duration', 'Build completed: {0}', util.msToString(duration)));
        const telemetryProperties: telemetry.Properties | undefined = this.useCMakePresets ? undefined : {
            ConfigType: this.isMultiConfFast ? 'MultiConf' : this.currentBuildType || ''
        };
        const telemetryMeasures: telemetry.Measures = {
            Duration: duration
        };
        if (child) {
            if (consumer) {
                if (consumer instanceof CMakeBuildConsumer &&
                    consumer.compileConsumer instanceof CompileOutputConsumer) {
                    let errorCount: number = 0;
                    let warningCount: number = 0;
                    for (const compiler in consumer.compileConsumer.compilers) {
                        const parser: RawDiagnosticParser = consumer.compileConsumer.compilers[compiler];
                        parser.diagnostics.forEach(v => {
                            if (v.severity === 'error' || v.severity === 'fatal error') {
                                errorCount++;
                            } else if (v.severity === 'warning') {
                                warningCount++;
                            }
                        });
                    }
                    telemetryMeasures['ErrorCount'] = errorCount;
                    telemetryMeasures['WarningCount'] = warningCount;
                } else if (!(consumer instanceof CustomBuildTaskTerminal)) {
                    // Wrong type: shouldn't get here, just in case
                    rollbar.error('Wrong build result type.');
                    telemetryMeasures['ErrorCount'] = (await child.result).retc ? 1 : 0;
                }
            }
            telemetry.logEvent('build', telemetryProperties, telemetryMeasures);
        } else {
            // Not sure what happened but there's an error...
            telemetryMeasures['ErrorCount'] = 1;
            telemetry.logEvent('build', telemetryProperties, telemetryMeasures);
            this.cmakeBuildRunner.setBuildInProgress(false);
            return -1;
        }
        if (!this.m_stop_process) {
            const post_build_ok = await this.doPostBuild();
            if (!post_build_ok) {
                this.cmakeBuildRunner.setBuildInProgress(false);
                return -1;
            }
        }
        if (!this.m_stop_process) {
            await this._refreshExpansions();
        }

        return (await child.result.finally(() => {
            this.cmakeBuildRunner.setBuildInProgress(false);
        })).retc;
    }

    /**
     * Execute pre-configure/build tasks to check if we are ready to run a full
     * configure. This should be called by a derived driver before any
     * configuration tasks are run
     */
    private async _beforeConfigureOrBuild(showCommandOnly?: boolean): Promise<boolean> {
        if (!showCommandOnly) {
            log.debug(localize('running.pre-configure.checks', 'Running pre-configure checks and steps'));
        }

        if (!this.sourceDir) {
            log.debug(localize('source.directory.not.set', 'Source directory not set'), this.sourceDir);
            await this.preconditionHandler(CMakePreconditionProblems.NoSourceDirectoryFound);
            return false;
        }

        const cmake_list = this.mainListFile;
        if (!await fs.exists(cmake_list)) {
            log.debug(localize('not.configuring', 'Not configuring: There is no {0}', cmake_list));
            await this.preconditionHandler(CMakePreconditionProblems.MissingCMakeListsFile, this.config);
            return false;
        }

        return true;
    }

    protected abstract doConfigureSettingsChange(): Promise<void>;

    /**g
     * Subscribe to changes that affect the CMake configuration
     */
    private readonly _settingsSub = this.config.onChange('configureSettings', async () => this.doConfigureSettingsChange());
    private readonly _argsSub = this.config.onChange('configureArgs', async () => this.doConfigureSettingsChange());
    private readonly _envSub = this.config.onChange('configureEnvironment', async () => this.doConfigureSettingsChange());
    private readonly _buildArgsSub = this.config.onChange('buildArgs', async () => {
        await onBuildSettingsChange();
    });
    private readonly _buildEnvSub = this.config.onChange('buildEnvironment', async () => {
        await onBuildSettingsChange();
    });
    private readonly _testArgsSub = this.config.onChange('ctestArgs', async () => {
        await onTestSettingsChange();
    });
    private readonly _testEnvSub = this.config.onChange('testEnvironment', async () => {
        await onTestSettingsChange();
    });
    private readonly _packEnvSub = this.config.onChange('cpackEnvironment', async () => {
        await onPackageSettingsChange();
    });
    private readonly _generalEnvSub = this.config.onChange('environment', async () => {
        await this.doConfigureSettingsChange();
        await onBuildSettingsChange();
        await onTestSettingsChange();
    });
    private cmakeBuildRunner: CMakeBuildRunner = new CMakeBuildRunner();
    protected configureProcess: proc.Subprocess | null = null;

    private correctAllTargetName(targetnames: string[]) {
        for (let i = 0; i < targetnames.length; i++) {
            if (targetnames[i] === 'all' || targetnames[i] === 'ALL_BUILD') {
                targetnames[i] = this.allTargetName;
            }
        }
        return targetnames;
    }

    getCMakeCommand(): string {
        return this.cmake.path ? this.cmake.path : "cmake";
    }

    // Create a command for a given build preset.
    async generateBuildCommandFromPreset(buildPreset: preset.BuildPreset, targets?: string[]): Promise<proc.BuildCommand | null> {
        if (targets && targets.length > 0) {
            buildPreset.__targets = targets;
        } else {
            buildPreset.__targets = buildPreset.targets;
        }
        const args = preset.buildArgs(buildPreset, this.config.buildArgs, this.config.buildToolArgs);
        const initialEnvironment = EnvironmentUtils.create(buildPreset.environment);
        const build_env = await this.getCMakeBuildCommandEnvironment(initialEnvironment);
        const expanded_args_promises = args.map(async (value: string) => expand.expandString(value, { ...this.expansionOptions, envOverride: build_env }));
        const expanded_args = await Promise.all(expanded_args_promises) as string[];
        log.trace(localize('cmake.build.args.are', 'CMake build args are: {0}', JSON.stringify(args)));

        if (checkBuildOverridesPresent(this.config)) {
            log.info(localize('build.with.overrides', 'NOTE: You are building with preset {0}, but there are some overrides being applied from your VS Code settings.', buildPreset.displayName ?? buildPreset.name));
        }

        return { command: this.cmake.path, args: expanded_args, build_env};
    }

    async generateBuildCommandFromSettings(targets?: string[]): Promise<proc.BuildCommand | null> {
        if (!targets || targets.length === 0) {
            return null;
        }

        const gen = this.generatorName;
        targets = this.correctAllTargetName(targets);

        const buildArgs: string[] = this.config.buildArgs.slice(0);
        const buildToolArgs: string[] = ['--'].concat(this.config.buildToolArgs);

        const configurationScope = this.workspaceFolder ? vscode.Uri.file(this.workspaceFolder) : null;
        const parallelJobsSetting = vscode.workspace.getConfiguration("cmake", configurationScope).inspect<number | undefined>('parallelJobs');
        let numJobs: number | undefined = (parallelJobsSetting?.workspaceFolderLanguageValue || parallelJobsSetting?.workspaceFolderValue || parallelJobsSetting?.globalValue);
        // for Ninja generator, don't '-j' argument if user didn't define number of jobs
        // let numJobs: number | undefined = this.config.numJobs;
        if (numJobs === undefined && gen && !/Ninja/.test(gen)) {
            numJobs = defaultNumJobs();
        }
        // for msbuild generators, only add '-j' argument if parallelJobs > 1
        if (numJobs && ((gen && !/Visual Studio/.test(gen)) || numJobs > 1)) {
            // Prefer using CMake's build options to set parallelism over tool-specific switches.
            // The feature is not available until version 3.14.
            if (this.cmake.version && util.versionGreaterOrEquals(this.cmake.version, util.parseVersion('3.14.0'))) {
                buildArgs.push('-j');
                if (numJobs) {
                    buildArgs.push(numJobs.toString());
                }
            } else {
                if (gen) {
                    if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && targets.length === 1 && targets[0] !== 'clean') {
                        buildToolArgs.push('-j', numJobs.toString());
                    } else if (/Visual Studio/.test(gen) && targets.length === 1 && targets[0] !== 'clean') {
                        buildToolArgs.push('/maxcpucount:' + numJobs.toString());
                    }
                }
            }
        }

        const ninja_env = EnvironmentUtils.create();
        ninja_env['NINJA_STATUS'] = '[%s/%t %p :: %e] ';
        const build_env = await this.getCMakeBuildCommandEnvironment(ninja_env);

        const args = ['--build', this.binaryDir, '--config', this.currentBuildType, '--target', ...targets]
            .concat(buildArgs, buildToolArgs);
        const opts = this.expansionOptions;
        const expanded_args_promises = args.map(async (value: string) => expand.expandString(value, { ...opts, envOverride: build_env }));
        const expanded_args = await Promise.all(expanded_args_promises) as string[];

        log.trace(localize('cmake.build.args.are', 'CMake build args are: {0}', JSON.stringify(expanded_args)));

        return { command: this.cmake.path, args: expanded_args, build_env };
    }

    async getCMakeBuildCommand(targets?: string[]): Promise<proc.BuildCommand | null> {
        if (this.useCMakePresets) {
            if (!this._buildPreset) {
                log.debug(localize('no.build.preset', 'No build preset selected'));
                return null;
            }
            return this.generateBuildCommandFromPreset(this._buildPreset, targets);
        } else {
            return this.generateBuildCommandFromSettings(targets);
        }
    }

    private async _doCMakeBuild(targets?: string[], consumer?: proc.OutputConsumer, isBuildCommand?: boolean): Promise<proc.Subprocess | null> {
        const buildcmd = await this.getCMakeBuildCommand(targets);
        if (buildcmd) {
            let outputEnc = this.config.outputLogEncoding;
            if (outputEnc === 'auto') {
                if (process.platform === 'win32') {
                    outputEnc = await codepages.getWindowsCodepage();
                } else {
                    outputEnc = 'utf8';
                }
            }
            const useBuildTask: boolean = this.config.buildTask && isBuildCommand === true;
            if (useBuildTask) {
                const task: CMakeTask | undefined = await CMakeTaskProvider.findBuildTask(this._buildPreset?.name, targets, this.expansionOptions);
                if (task) {
                    const resolvedTask: CMakeTask | undefined = await CMakeTaskProvider.resolveInternalTask(task);
                    if (resolvedTask) {
                        await this.cmakeBuildRunner.setBuildProcessForTask(await vscode.tasks.executeTask(resolvedTask));
                    }
                }
            } else {
                const exeOpt: proc.ExecutionOptions = { environment: buildcmd.build_env, outputEncoding: outputEnc };
                this.cmakeBuildRunner.setBuildProcess(this.executeCommand(buildcmd.command, buildcmd.args, consumer, exeOpt));
            }
            const result = await this.cmakeBuildRunner.getResult();
            return result ? result : null;
        } else {
            return null;
        }
    }

    /**
     * If called then the current process should be stopped.
     * This could be the configuration or the build process.
     */
    async onStop(): Promise<void> {}

    private m_stop_process = false;
    /**
     * Stops the currently running process at user request
     */
    async stopCurrentProcess(): Promise<void> {
        this.m_stop_process = true;
        if (this.configureProcess && this.configureProcess.child) {
            await util.termProc(this.configureProcess.child);
            this.configureProcess = null;
        }
        if (this.cmakeBuildRunner) {
            await this.cmakeBuildRunner.stop();
        }
        await this.onStop();
    }

    /**
     * The CMake cache for the driver.
     *
     * Will be automatically reloaded when the file on disk changes.
     */
    abstract get cmakeCacheEntries(): Map<string, CacheEntry>;

    private async _baseInit(useCMakePresets: boolean,
        kit: Kit | null,
        configurePreset: preset.ConfigurePreset | null,
        buildPreset: preset.BuildPreset | null,
        testPreset: preset.TestPreset | null,
        packagePreset: preset.PackagePreset | null,
        workflowPreset: preset.WorkflowPreset | null,
        preferredGenerators: CMakeGenerator[]) {
        this._useCMakePresets = useCMakePresets;
        const initBaseDriverWithPresetLoc = localize("init.driver.using.preset", "Initializing base driver using preset");
        const initBaseDriverWithKitLoc = localize("init.driver.using.kit", "Initializing base driver using kit");
        log.debug(`${useCMakePresets ? initBaseDriverWithPresetLoc : initBaseDriverWithKitLoc}`);
        // Load up kit or presets before starting any drivers.
        if (useCMakePresets) {
            if (configurePreset) {
                await this._setConfigurePreset(configurePreset);
            }
            if (buildPreset) {
                await this._setBuildPreset(buildPreset);
            }
            if (testPreset) {
                await this._setTestPreset(testPreset);
            }
            if (packagePreset) {
                await this._setPackagePreset(packagePreset);
            }
            if (workflowPreset) {
                await this._setWorkflowPreset(workflowPreset);
            }
        } else if (kit) {
            await this._setKit(kit, preferredGenerators);
        }
        await this._refreshExpansions();
        await this.doInit();
    }
    protected abstract doInit(): Promise<void>;

    /**
     * Asynchronous initialization. Should be called by base classes during
     * their initialization.
     */
    static async createDerived<T extends CMakeDriver>(inst: T,
        useCMakePresets: boolean,
        kit: Kit | null,
        configurePreset: preset.ConfigurePreset | null,
        buildPreset: preset.BuildPreset | null,
        testPreset: preset.TestPreset | null,
        packagePreset: preset.PackagePreset | null,
        workflowPreset: preset.WorkflowPreset | null,
        preferredGenerators: CMakeGenerator[]): Promise<T> {
        await inst._baseInit(useCMakePresets, kit, configurePreset, buildPreset, testPreset, packagePreset, workflowPreset, preferredGenerators);
        return inst;
    }

    public getDiagnostics(): DiagnosticsConfiguration {
        return {
            folder: this.workspaceFolder || '',
            cmakeVersion: this.cmake.version ? util.versionToString(this.cmake.version) : '',
            configured: this._isConfiguredAtLeastOnce,
            generator: this.generatorName || '',
            usesPresets: this.useCMakePresets,
            compilers: {
                C: this.cmakeCacheEntries.get('CMAKE_C_COMPILER')?.value,
                CXX: this.cmakeCacheEntries.get('CMAKE_CXX_COMPILER')?.value
            }
        };
    }
}
