/**
 * Defines base class for CMake drivers
 */ /** */

import * as path from 'path';
import * as vscode from 'vscode';

import * as api from '@cmt/api';
import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
import * as codepages from '@cmt/code-pages';
import {ConfigureTrigger} from "@cmt/cmake-tools";
import {ArgsCompileCommand} from '@cmt/compdb';
import {ConfigurationReader} from '@cmt/config';
import {CMakeBuildConsumer, CompileOutputConsumer} from '@cmt/diagnostics/build';
import {CMakeOutputConsumer} from '@cmt/diagnostics/cmake';
import {RawDiagnosticParser} from '@cmt/diagnostics/util';
import {ProgressMessage} from '@cmt/drivers/cms-client';
import * as expand from '@cmt/expand';
import {CMakeGenerator, effectiveKitEnvironment, Kit, kitChangeNeedsClean, KitDetect, getKitDetect} from '@cmt/kit';
import * as logging from '@cmt/logging';
import paths from '@cmt/paths';
import {fs} from '@cmt/pr';
import * as proc from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import * as telemetry from '@cmt/telemetry';
import * as util from '@cmt/util';
import {ConfigureArguments, VariantOption} from '@cmt/variant';
import * as nls from 'vscode-nls';
import { majorVersionSemver, minorVersionSemver, parseTargetTriple, TargetTriple } from '@cmt/triple';
import * as preset from '@cmt/preset';
import * as codemodel from '@cmt/drivers/codemodel-driver-interface';
import {DiagnosticsConfiguration} from '@cmt/folders';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('driver');

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

export type CMakePreconditionProblemSolver = (e: CMakePreconditionProblems, config?: ConfigurationReader) => Promise<void>;

function nullableValueToString(arg: any|null|undefined): string {
  return arg === null ? 'empty' : arg;
}

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
  protected abstract doConfigure(extra_args: string[], consumer?: proc.OutputConsumer, showCommandOnly?: boolean): Promise<number>;
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
  abstract onCodeModelChanged: vscode.Event<codemodel.CodeModelContent|null>;

  /**
   * List of targets known to CMake
   */
  abstract get targets(): api.Target[];

  abstract get codeModelContent(): codemodel.CodeModelContent|null;

  /**
   * List of executable targets known to CMake
   */
  abstract get executableTargets(): api.ExecutableTarget[];

  /**
   * List of unique targets known to CMake
   */
  abstract get uniqueTargets(): api.Target[];

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
  protected constructor(public readonly cmake: CMakeExecutable,
                        readonly config: ConfigurationReader,
                        private readonly __workspaceFolder: string|null,
                        readonly preconditionHandler: CMakePreconditionProblemSolver) {
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
   * Dispose the driver. This disposes some things synchronously, but also
   * calls the `asyncDispose()` method to start any asynchronous shutdown.
   */
  dispose() {
    log.debug(localize('disposing.base.cmakedriver', 'Disposing base CMakeDriver'));
    for (const term of this._compileTerms.values()) {
      term.dispose();
    }
    for (const sub of [this._settingsSub, this._argsSub, this._envSub]) {
      sub.dispose();
    }
    rollbar.invokeAsync(localize('async.disposing.cmake.driver', 'Async disposing CMake driver'), () => this.asyncDispose());
  }

  /**
   * The environment variables required by the current kit
   * The ${dollar} are not expanded and missing environment variable subs are not expanded for this variables
   */
  private _kitEnvironmentVariables: proc.EnvironmentVariables = {};

  /**
   * Get the environment variables that should be set at CMake-configure time.
   */
  async getConfigureEnvironment(): Promise<proc.EnvironmentVariables> {
    const envs_to_merge: (proc.EnvironmentVariables | undefined)[] = [];
    if (this.useCMakePresets) {
      envs_to_merge.push(this._configurePreset?.environment as proc.EnvironmentVariables);
    } else {
      envs_to_merge.push(this._kitEnvironmentVariables);
    }
    envs_to_merge.push(this.config.environment);
    envs_to_merge.push(this.config.configureEnvironment);
    envs_to_merge.push(this._variantEnv);
    return expand.mergeEnvironmentWithExpand(false, envs_to_merge, this.expansionOptions);
  }

  /**
   * Get the environment variables that should be set at CMake-build time.
   */
  async getCMakeBuildCommandEnvironment(in_env: proc.EnvironmentVariables): Promise<proc.EnvironmentVariables> {
    const envs_to_merge: (proc.EnvironmentVariables | undefined)[] = [in_env];
    if (this.useCMakePresets) {
      envs_to_merge.push(this._buildPreset?.environment as proc.EnvironmentVariables);
    } else {
      envs_to_merge.push(this._kitEnvironmentVariables);
    }
    envs_to_merge.push(this.config.environment);
    envs_to_merge.push(this.config.buildEnvironment);
    envs_to_merge.push(this._variantEnv);
    return expand.mergeEnvironmentWithExpand(false, envs_to_merge, this.expansionOptions);
  }

  /**
   * Get the environment variables that should be set at CTest and running program time.
   */
  async getCTestCommandEnvironment(): Promise<proc.EnvironmentVariables> {
    const envs_to_merge: (proc.EnvironmentVariables | undefined)[] = [];
    if (this.useCMakePresets) {
      envs_to_merge.push(this._testPreset?.environment as proc.EnvironmentVariables);
    } else {
      envs_to_merge.push(this._kitEnvironmentVariables);
    }
    envs_to_merge.push(this.config.environment);
    envs_to_merge.push(this.config.testEnvironment);
    envs_to_merge.push(this._variantEnv);
    return expand.mergeEnvironmentWithExpand(false, envs_to_merge, this.expansionOptions);
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
  private _kit: Kit|null = null;

  private _kitDetect: KitDetect|null = null;

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

  /**
   * Get the vscode root workspace folder.
   *
   * @returns Returns the vscode root workspace folder. Returns `null` if no folder is open or the folder uri is not a
   * `file://` scheme.
   */
  protected get workspaceFolder() {
    return this.__workspaceFolder;
  }

  protected variantKeywordSettings: Map<string, string>|null = null;

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
      buildKitVendor: this._kitDetect?.vendor ?? '__unknow_vendor__',
      buildKitTriple: this._kitDetect?.triple ?? '__unknow_triple__',
      buildKitVersion: version,
      buildKitHostOs: process.platform,
      buildKitTargetOs: target.targetOs ?? '__unknow_target_os__',
      buildKitTargetArch: target.targetArch ?? '__unknow_target_arch__',
      buildKitVersionMajor: majorVersionSemver(version),
      buildKitVersionMinor: minorVersionSemver(version),
      // DEPRECATED EXPANSION: Remove this in the future:
      projectName: 'ProjectName'
    };

    // Update Variant replacements
    const variantVars: {[key: string]: string} = {};
    if (this.variantKeywordSettings) {
      // allows to expansion of variant option keyword and replace it by the variant option short name
      this.variantKeywordSettings.forEach((value: string, key: string) => variantVars[key] = value);
    }

    return {vars, variantVars};
  }

  static sourceDirExpansionOptions(workspaceFolderFspath: string | null): expand.ExpansionOptions {
    const ws_root = util.lightNormalizePath(workspaceFolderFspath || '.');

    // Fill in default replacements
    const vars: expand.MinimalPresetContextVars = {
      generator: 'generator',
      workspaceFolder: ws_root,
      workspaceFolderBasename: path.basename(ws_root),
      workspaceHash: util.makeHashString(ws_root),
      workspaceRoot: ws_root,
      workspaceRootFolderName: path.basename(ws_root),
      userHome: paths.userHome
    };

    return { vars };
  }

  async getEffectiveSubprocessEnvironment(opts?: proc.ExecutionOptions): Promise<proc.EnvironmentVariables> {
    let envs_to_merge: (proc.EnvironmentVariables | undefined)[] =  [];
    if (this.config.ignoreKitEnv) {
      envs_to_merge = [
        process.env as proc.EnvironmentVariables,
        this.config.environment,
        this._variantEnv,
        opts?.environment
      ];
    } else {
      envs_to_merge = [
        this._kitEnvironmentVariables,
        this.config.environment,
        this._variantEnv,
        opts?.environment
      ];
    }
    return expand.mergeEnvironmentWithExpand(false, envs_to_merge, this.expansionOptions);
  }

  async executeCommand(command: string, args?: string[], consumer?: proc.OutputConsumer, options?: proc.ExecutionOptions):
      Promise<proc.Subprocess> {
    const environment = await this.getEffectiveSubprocessEnvironment(options);
    const exec_options = {...options, environment};
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
  async runCompileCommand(cmd: ArgsCompileCommand): Promise<vscode.Terminal> {
    let env: proc.EnvironmentVariables;
    if (this.useCMakePresets) {
      // buildpreset.environment at least has process.env after expansion
      env = this._buildPreset!.environment as proc.EnvironmentVariables;
    } else {
      env = await this.getCMakeBuildCommandEnvironment({});
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
      await fs.unlink(cache);
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
  async setConfigurePreset(configurePreset: preset.ConfigurePreset): Promise<void> {
    if (!this.useCMakePresets) {
      log.info(localize('skip.set.config.preset', 'Using kits, skip setting configure preset: {0}', configurePreset.name));
      return;
    }

    log.info(localize('switching.to.config.preset', 'Switching to configure preset: {0}', configurePreset.name));

    const newBinaryDir = configurePreset.binaryDir;
    const needs_clean = this.binaryDir === newBinaryDir && preset.configurePresetChangeNeedsClean(configurePreset, this._configurePreset);
    await this.doSetConfigurePreset(needs_clean, async () => {
      await this._setConfigurePreset(configurePreset);
    });
  }

  private async _setConfigurePreset(configurePreset: preset.ConfigurePreset): Promise<void> {
    this._configurePreset = configurePreset;
    log.debug(localize('cmakedriver.config.preset.set.to', 'CMakeDriver configure preset set to {0}', configurePreset.name));

    this._binaryDir = configurePreset.binaryDir || '';

    const getValue = (obj: string | preset.ValueStrategy) => {
      if (util.isString(obj)) {
        return obj;
      } else if (obj.strategy === 'set') {
        return obj.value;
      }
    };

    if (configurePreset.generator) {
      this._generator = {
        name: configurePreset.generator,
        platform: configurePreset.architecture ? getValue(configurePreset.architecture) : undefined,
        toolset: configurePreset.toolset ? getValue(configurePreset.toolset) : undefined
      };
    } else {
      log.debug(localize('no.generator', 'No generator specified'));
    }
  }

  /**
   * Change the current build preset
   * @param buildPreset The new build preset
   */
  async setBuildPreset(buildPreset: preset.BuildPreset): Promise<void> {
    if (!this.useCMakePresets) {
      log.info(localize('skip.set.build.preset', 'Using kits, skip setting build preset: {0}', buildPreset.name));
      return;
    }

    log.info(localize('switching.to.build.preset', 'Switching to build preset: {0}', buildPreset.name));
    await this.doSetBuildPreset(async () => {
      await this._setBuildPreset(buildPreset);
    });
  }

  private async _setBuildPreset(buildPreset: preset.BuildPreset): Promise<void> {
    this._buildPreset = buildPreset;
    log.debug(localize('cmakedriver.build.preset.set.to', 'CMakeDriver build preset set to {0}', buildPreset.name));
  }

  /**
   * Change the current test preset
   * @param testPreset The new test preset
   */
  async setTestPreset(testPreset: preset.TestPreset): Promise<void> {
    if (!this.useCMakePresets) {
      log.info(localize('skip.set.test.preset', 'Using kits, skip setting test preset: {0}', testPreset.name));
      return;
    }

    log.info(localize('switching.to.test.preset', 'Switching to test preset: {0}', testPreset.name));
    await this.doSetTestPreset(async () => {
      await this._setTestPreset(testPreset);
    });
  }

  private async _setTestPreset(testPreset: preset.TestPreset): Promise<void> {
    this._testPreset = testPreset;
    log.debug(localize('cmakedriver.test.preset.set.to', 'CMakeDriver test preset set to {0}', testPreset.name));
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

    const opts = this.expansionOptions;
    opts.vars.buildKit = kit.name;
    const newBinaryDir = util.lightNormalizePath(await expand.expandString(this.config.buildDirectory, opts));

    const needs_clean = this.binaryDir === newBinaryDir && kitChangeNeedsClean(kit, this._kit);
    await this.doSetKit(needs_clean, async () => {
      await this._setKit(kit, preferredGenerators);
    });
  }

  private async _setKit(kit: Kit, preferredGenerators: CMakeGenerator[]): Promise<void> {
    this._kit = Object.seal({...kit});
    this._kitDetect = await getKitDetect(this._kit);
    log.debug(localize('cmakedriver.kit.set.to', 'CMakeDriver Kit set to {0}', kit.name));
    this._kitEnvironmentVariables = await effectiveKitEnvironment(kit, this.expansionOptions);

    if (kit.preferredGenerator) {
      preferredGenerators.push(kit.preferredGenerator);
    }

    // If no preferred generator is defined by the current kit or the user settings,
    // it's time to consider the defaults.
    if (preferredGenerators.length === 0) {
      preferredGenerators.push({name: "Ninja"});
      preferredGenerators.push({name: "Unix Makefiles"});
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

  protected abstract doSetKit(needsClean: boolean, cb: () => Promise<void>): Promise<void>;

  protected get generator(): CMakeGenerator|null {
    return this._generator;
  }
  protected _generator: CMakeGenerator|null = null;
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
  private _variantLinkage: ('static'|'shared'|null) = null;

  /**
   * Environment variables defined by the current variant
   */
  private _variantEnv: proc.EnvironmentVariables = {};

  /**
   * Change the current options from the variant.
   * @param opts The new options
   * @param keywordSetting Variant Keywords for identification of a variant option
   */
  async setVariant(opts: VariantOption, keywordSetting: Map<string, string>|null) {
    log.debug(localize('setting.new.variant', 'Setting new variant {0}', opts.short || '(Unnamed)'));
    this._variantBuildType = opts.buildType || this._variantBuildType;
    this._variantConfigureSettings = opts.settings || this._variantConfigureSettings;
    this._variantLinkage = opts.linkage || null;
    this._variantEnv = opts.env || {};
    this.variantKeywordSettings = keywordSetting || null;
    await this._refreshExpansions();
  }

  /**
   * The source directory, where the root CMakeLists.txt lives.
   *
   * @note This is distinct from the config values, since we do variable
   * substitution.
   */
  get sourceDir(): string {
    return this._sourceDirectory;
  }
  private _sourceDirectory = '';

  protected doRefreshExpansions(cb: () => Promise<void>): Promise<void> {
    return cb();
  }

  private async _refreshExpansions(showCommandOnly?: boolean) {
    if (!showCommandOnly) {
      log.debug('Run _refreshExpansions');
    }

    return this.doRefreshExpansions(async () => {
      if (!showCommandOnly) {
        log.debug('Run _refreshExpansions cb');
      }

      this._sourceDirectory = await util.normalizeAndVerifySourceDir(await expand.expandString(this.config.sourceDirectory, CMakeDriver.sourceDirExpansionOptions(this.workspaceFolder)));

      const opts = this.expansionOptions;
      opts.envOverride = await this.getConfigureEnvironment();

      if (!this.useCMakePresets) {
        this._binaryDir = util.lightNormalizePath(await expand.expandString(this.config.buildDirectory, opts));

        const installPrefix = this.config.installPrefix;
        if (installPrefix) {
          this._installDir = util.lightNormalizePath(await expand.expandString(installPrefix, opts));
        }
      }

      const copyCompileCommands = this.config.copyCompileCommands;
      if (copyCompileCommands) {
        this._copyCompileCommandsPath = util.lightNormalizePath(await expand.expandString(copyCompileCommands, opts));
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
  private get installDir(): string|null {
    return this._installDir;
  }
  private _installDir: string|null = null;

  /**
   * Path to copy compile_commands.json to
   */
  get copyCompileCommandsPath(): string|null {
    return this._copyCompileCommandsPath;
  }
  private _copyCompileCommandsPath: string|null = null;

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
  get isMultiConfig(): boolean { return this._isMultiConfig; }
  set isMultiConfig(v: boolean) { this._isMultiConfig = v; }

  get isMultiConfFast(): boolean {
    return this.generatorName ? util.isMultiConfGeneratorFast(this.generatorName) : false;
  }

  /**
   * Get the name of the current CMake generator, or `null` if we have not yet
   * configured the project.
   */
  abstract get generatorName(): string|null;

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
  get compilerID(): string|null {
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

  get linkerID(): string|null {
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
    const child = await this.executeCommand(program, args, undefined, {silent: true});
    try {
      const result = await child.result;
      log.debug(localize('command.version.test.return.code', 'Command version test return code {0}', nullableValueToString(result.retc)));
      return result.retc === 0;
    } catch (e: any) {
      const e2: NodeJS.ErrnoException = e;
      log.debug(localize('command.version.test.return.code', 'Command version test return code {0}', nullableValueToString(e2.code)));
      if (e2.code === 'ENOENT') {
        return false;
      }
      throw e;
    }
  }

  /**
   * Picks the best generator to use on the current system
   */
  async findBestGenerator(preferredGenerators: CMakeGenerator[]): Promise<CMakeGenerator|null> {
    log.debug(localize('trying.to.detect.generator', 'Trying to detect generator supported by system'));
    const platform = process.platform;

    for (const gen of preferredGenerators) {
      const gen_name = gen.name;
      const generator_present = await (async(): Promise<boolean> => {
        if (gen_name === 'Ninja') {
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
        continue;
      } else {
        return gen;
      }
    }
    return null;
  }

  private configRunning: boolean = false;

  private buildRunning: boolean = false;

  public configOrBuildInProgress(): boolean {
    return this.configRunning || this.buildRunning;
  }

  /**
   * Perform a clean configure. Deletes cached files before running the config
   * @param consumer The output consumer
   */
  public async cleanConfigure(trigger: ConfigureTrigger, extra_args: string[], consumer?: proc.OutputConsumer): Promise<number> {
    if (this.configRunning) {
      await this.preconditionHandler(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      return -1;
    }
    if (this.buildRunning) {
      await this.preconditionHandler(CMakePreconditionProblems.BuildIsAlreadyRunning);
      return -1;
    }
    this.configRunning = true;
    await this.doPreCleanConfigure();
    this.configRunning = false;

    return this.configure(trigger, extra_args, consumer);
  }

  async testCompilerVersion(program: string, cwd: string, arg: string | undefined,
                            regexp: RegExp, captureGroup: number): Promise<string | undefined> {
    const args = [];
    if (arg) {
      args.push(arg);
    }
    const child = await this.executeCommand(program, args, undefined, {silent: true, cwd});
    try {
      const result = await child.result;
      console.log(localize('command.version.test.return.code', 'Command version test return code {0}', nullableValueToString(result.retc)));
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
      console.log(localize('compiler.version.return.code', 'Compiler version test return code {0}', nullableValueToString(e2.code)));
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
    {
      name: "clang",
      versionSwitch: "-v",
      versionOutputRegexp: "(Apple LLVM|clang) version (.*)- ",
      captureGroup: 2
    },
    {
      name: "clang-cl",
      versionSwitch: "-v",
      versionOutputRegexp: "(Apple LLVM|clang) version (.*)- ",
      captureGroup: 2
    },
    {
      name: "clang++",
      versionSwitch: "-v",
      versionOutputRegexp: "(Apple LLVM|clang) version (.*)- ",
      captureGroup: 2
    },
    {
      name: "armclang",
      versionSwitch: "-v",
      versionOutputRegexp: "(Apple LLVM|clang) version (.*)- ",
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
      version = await this.testCompilerVersion(compilerName, compilerDir, compiler?.versionSwitch,
                                               RegExp(compiler.versionOutputRegexp, "mgi"), compiler.captureGroup) || "unknown";
    } else {
      version = "unknown";
    }

    return {name: allowedCompilerName, version};
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

  async configure(trigger: ConfigureTrigger, extra_args: string[], consumer?: proc.OutputConsumer, withoutCmakeSettings: boolean = false, showCommandOnly?: boolean): Promise<number> {
    // Check if the configuration is using cache in the first configuration and adjust the logging messages based on that.
    const shouldUseCachedConfiguration: boolean = this.shouldUseCachedConfiguration(trigger);

    if (trigger === ConfigureTrigger.configureWithCache && !shouldUseCachedConfiguration) {
      log.debug(localize('no.cached.config', "No cached config could be used for IntelliSense"));
      return -2;
    }
    if (this.configRunning) {
      await this.preconditionHandler(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      return -1;
    }
    if (this.buildRunning) {
      await this.preconditionHandler(CMakePreconditionProblems.BuildIsAlreadyRunning);
      return -1;
    }
    this.configRunning = true;
    try {
      // _beforeConfigureOrBuild needs to refresh expansions early because it reads various settings
      // (example: cmake.sourceDirectory).
      await this._refreshExpansions(showCommandOnly);
      if (!showCommandOnly) {
        if (!shouldUseCachedConfiguration) {
          log.debug(localize('start.configure', 'Start configure'), extra_args);
        } else {
          log.debug(localize('use.cached.configuration', 'Use cached configuration'), extra_args);
        }
      }

      const pre_check_ok = await this._beforeConfigureOrBuild(showCommandOnly);
      if (!pre_check_ok) {
        return -2;
      }

      // Cache flags will construct the command line for cmake.
      const init_cache_flags = this.generateInitCacheFlags();

      let expanded_flags: string[];
      if (this.useCMakePresets) {
        if (!this._configurePreset) {
          log.debug(localize('no.config.Preset', 'No configure preset selected'));
          return -3;
        }
        // For now, fields in presets are expanded when the preset is selected
        expanded_flags = init_cache_flags.concat(preset.configureArgs(this._configurePreset));
      } else {
        const common_flags = ['--no-warn-unused-cli'].concat(extra_args, this.config.configureArgs);
        const define_flags = withoutCmakeSettings ? [] : this.generateCMakeSettingsFlags();
        const final_flags = common_flags.concat(define_flags, init_cache_flags);

        // Get expanded configure environment
        const expanded_configure_env = await this.getConfigureEnvironment();

        // Expand all flags
        const opts = this.expansionOptions;
        const expanded_flags_promises = final_flags.map(
            async (value: string) => expand.expandString(value, {...opts, envOverride: expanded_configure_env}));
        expanded_flags = await Promise.all(expanded_flags_promises);
      }
      if (!shouldUseCachedConfiguration) {
        log.trace(localize('cmake.flags.are', 'CMake flags are {0}', JSON.stringify(expanded_flags)));
      }

      // A more complete round of expansions
      await this._refreshExpansions(showCommandOnly);

      const timeStart: number = new Date().getTime();
      let retc: number;
      if (shouldUseCachedConfiguration) {
        retc = await this.doCacheConfigure();
        this._isConfiguredAtLeastOnce = true;
        return retc;
      } else {
        retc = await this.doConfigure(expanded_flags, consumer, showCommandOnly);
        this._isConfiguredAtLeastOnce = true;
      }
      const timeEnd: number = new Date().getTime();

      const cmakeVersion = this.cmake.version;
      let telemetryProperties: telemetry.Properties;
      if (this.useCMakePresets) {
        telemetryProperties = {
          CMakeExecutableVersion: cmakeVersion ? util.versionToString(cmakeVersion) : '',
          CMakeGenerator: this.generatorName || '',
          Preset: this.useCMakePresets ? 'true' : 'false',
          Trigger: trigger,
          ShowCommandOnly: showCommandOnly ? 'true' : 'false'
        };
      } else {
        telemetryProperties = {
          CMakeExecutableVersion: cmakeVersion ? util.versionToString(cmakeVersion) : '',
          CMakeGenerator: this.generatorName || '',
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
        } else {
          // Wrong type: shouldn't get here, just in case
          rollbar.error('Wrong build result type.');
          telemetryMeasures['ErrorCount'] = retc ? 1 : 0;
        }
      }

      telemetry.logEvent('configure', telemetryProperties, telemetryMeasures);

      return retc;
    } catch {
      log.info(localize('configure.failed', 'Failed to configure project'));
      return -1;
    } finally {
      this.configRunning = false;
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
    const settingMap: {[key: string]: util.CMakeValue} = {};

    util.objectPairs(this.config.configureSettings)
        .forEach(([key, value]) => settingMap[key] = util.cmakeify(value as string));
    util.objectPairs(this._variantConfigureSettings)
        .forEach(([key, value]) => settingMap[key] = util.cmakeify(value as string));
    if (this._variantLinkage !== null) {
      settingMap.BUILD_SHARED_LIBS = util.cmakeify(this._variantLinkage === 'shared');
    }

    const configurationScope = this.workspaceFolder ? vscode.Uri.file(this.workspaceFolder) : null;
    const config = vscode.workspace.getConfiguration("cmake", configurationScope);
    // Export compile_commands.json
    const exportCompileCommandsSetting = config.get<boolean>("exportCompileCommandsFile");
    const exportCompileCommandsFile: boolean = exportCompileCommandsSetting === undefined ? true : (exportCompileCommandsSetting || false);
    settingMap.CMAKE_EXPORT_COMPILE_COMMANDS = util.cmakeify(exportCompileCommandsFile);

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

    console.assert(!!this._kit);
    if (!this._kit) {
      throw new Error(localize('no.kit.is.set', 'No kit is set!'));
    }
    if (this._kit.compilers) {
      log.debug(localize('using.compilers.in.for.configure', 'Using compilers in {0} for configure', this._kit.name));
      for (const lang in this._kit.compilers) {
        const compiler = this._kit.compilers[lang];
        settingMap[`CMAKE_${lang}_COMPILER`] = {type: 'FILEPATH', value: compiler} as util.CMakeValue;
      }
    }
    if (this._kit.toolchainFile) {
      log.debug(localize('using.cmake.toolchain.for.configure', 'Using CMake toolchain {0} for configuring', this._kit.name));
      settingMap.CMAKE_TOOLCHAIN_FILE = {type: 'FILEPATH', value: this._kit.toolchainFile} as util.CMakeValue;
    }
    if (this._kit.cmakeSettings) {
      util.objectPairs(this._kit.cmakeSettings)
          .forEach(([key, value]) => settingMap[key] = util.cmakeify(value as string));
    }

    return util.objectPairs(settingMap).map(([key, value]) => {
      switch (value.type) {
      case 'UNKNOWN':
        return `-D${key}=${value.value}`;
      default:
        return `-D${key}:${value.type}=${value.value}`;
      }
    });
  }

  async build(targets?: string[], consumer?: proc.OutputConsumer): Promise<number|null> {
    log.debug(localize('start.build', 'Start build'), targets?.join(', ') || '');
    if (this.configRunning) {
      await this.preconditionHandler(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      return -1;
    }
    if (this.buildRunning) {
      await this.preconditionHandler(CMakePreconditionProblems.BuildIsAlreadyRunning);
      return -1;
    }
    this.buildRunning = true;

    const pre_build_ok = await this.doPreBuild();
    if (!pre_build_ok) {
      this.buildRunning = false;
      return -1;
    }
    const timeStart: number = new Date().getTime();
    const child = await this._doCMakeBuild(targets, consumer);
    const timeEnd: number = new Date().getTime();
    const telemetryProperties: telemetry.Properties | undefined = this.useCMakePresets ? undefined : {
      ConfigType: this.isMultiConfFast ? 'MultiConf' : this.currentBuildType || ''
    };
    const telemetryMeasures: telemetry.Measures = {
      Duration: timeEnd - timeStart
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
        } else {
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
      this.buildRunning = false;
      return -1;
    }
    if (!this.m_stop_process) {
      const post_build_ok = await this.doPostBuild();
      if (!post_build_ok) {
        this.buildRunning = false;
        return -1;
      }
    }
    if (!this.m_stop_process) {
      await this._refreshExpansions();
    }

    this.buildRunning = false;
    return (await child.result).retc;
  }

  /**
   * Execute pre-configure/build tasks to check if we are ready to run a full
   * configure. This should be called by a derived driver before any
   * configuration tasks are run
   */
  private async _beforeConfigureOrBuild(showCommandOnly?: boolean): Promise<boolean> {
    if (!showCommandOnly) {
      log.debug(localize('running.pre-configure.checks', 'Runnnig pre-configure checks and steps'));
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

  protected abstract doConfigureSettingsChange(): void;

  /**
   * Subscribe to changes that affect the CMake configuration
   */
  private readonly _settingsSub = this.config.onChange('configureSettings', () => this.doConfigureSettingsChange());
  private readonly _argsSub = this.config.onChange('configureArgs', () => this.doConfigureSettingsChange());
  private readonly _envSub = this.config.onChange('configureEnvironment', () => this.doConfigureSettingsChange());

  /**
   * The currently running process. We keep a handle on it so we can stop it
   * upon user request
   */
  private _currentBuildProcess: proc.Subprocess|null = null;

  private correctAllTargetName(targetnames: string[]) {
    for (let i = 0; i < targetnames.length; i++) {
      if (targetnames[i] === 'all' || targetnames[i] === 'ALL_BUILD') {
        targetnames[i] = this.allTargetName;
      }
    }
    return targetnames;
  }

  async getCMakeBuildCommand(targets?: string[]): Promise<proc.BuildCommand|null> {
    if (this.useCMakePresets) {
      if (!this._buildPreset) {
        log.debug(localize('no.build.preset', 'No build preset selected'));
        return null;
      }

      if (targets && targets.length > 0) {
        this._buildPreset.__targets = targets;
      } else {
        this._buildPreset.__targets = this._buildPreset.targets;
      }

      const args = preset.buildArgs(this._buildPreset);

      log.trace(localize('cmake.build.args.are', 'CMake build args are: {0}', JSON.stringify(args)));

      return {command: this.cmake.path, args, build_env: this._buildPreset.environment as proc.EnvironmentVariables};
    } else {
      if (!targets || targets.length === 0) {
        return null;
      }

      const gen = this.generatorName;
      targets = this.correctAllTargetName(targets);

      const buildArgs: string[] = this.config.buildArgs.slice(0);
      const buildToolArgs: string[] = ['--'].concat(this.config.buildToolArgs);

      // Only add '-j' argument if parallelJobs > 1
      if (this.config.numJobs > 1) {
        // Prefer using CMake's build options to set parallelism over tool-specific switches.
        // The feature is not available until version 3.14.
        if (this.cmake.version && util.versionGreaterOrEquals(this.cmake.version, util.parseVersion('3.14.0'))) {
          buildArgs.push('-j');
          if (this.config.numJobs) {
            buildArgs.push(this.config.numJobs.toString());
          }
        } else {
          if (gen) {
            if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && targets !== ['clean']) {
              buildToolArgs.push('-j', this.config.numJobs.toString());
            } else if (/Visual Studio/.test(gen) &&  targets !== ['clean']) {
              buildToolArgs.push('/maxcpucount:' + this.config.numJobs.toString());
            }
          }
        }
      }

      const ninja_env = {} as {[key: string]: string};
      ninja_env['NINJA_STATUS'] = '[%s/%t %p :: %e] ';
      const build_env = await this.getCMakeBuildCommandEnvironment(ninja_env);

      const args = ['--build', this.binaryDir, '--config', this.currentBuildType, '--target', ...targets]
                      .concat(buildArgs, buildToolArgs);
      const opts = this.expansionOptions;
      const expanded_args_promises
          = args.map(async (value: string) => expand.expandString(value, {...opts, envOverride: build_env}));
      const expanded_args = await Promise.all(expanded_args_promises) as string[];

      log.trace(localize('cmake.build.args.are', 'CMake build args are: {0}', JSON.stringify(expanded_args)));

      return {command: this.cmake.path, args: expanded_args, build_env};
    }
  }

  private async _doCMakeBuild(targets?: string[], consumer?: proc.OutputConsumer): Promise<proc.Subprocess|null> {
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
      const exeOpt: proc.ExecutionOptions
          = {environment: buildcmd.build_env, outputEncoding: outputEnc, useTask: this.config.buildTask};
      const child = await this.executeCommand(buildcmd.command, buildcmd.args, consumer, exeOpt);
      this._currentBuildProcess = child;
      await child.result;
      this._currentBuildProcess = null;
      return child;
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

    const cur = this._currentBuildProcess;
    if (cur) {
      if (cur.child) {
        await util.termProc(cur.child);
      }
    }

    await this.onStop();
  }

  /**
   * The CMake cache for the driver.
   *
   * Will be automatically reloaded when the file on disk changes.
   */
  abstract get cmakeCacheEntries(): Map<string, api.CacheEntryProperties>;

  private async _baseInit(useCMakePresets: boolean,
                          kit: Kit | null,
                          configurePreset: preset.ConfigurePreset | null,
                          buildPreset: preset.BuildPreset | null,
                          testPreset: preset.TestPreset | null,
                          preferredGenerators: CMakeGenerator[]) {
    this._useCMakePresets = useCMakePresets;
    log.debug(`Initializating base driver using ${useCMakePresets ? 'preset' : 'kit'}`);
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
                                                    preferredGenerators: CMakeGenerator[]): Promise<T> {
    await inst._baseInit(useCMakePresets, kit, configurePreset, buildPreset, testPreset, preferredGenerators);
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
