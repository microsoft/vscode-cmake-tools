/**
 * Defines base class for CMake drivers
 */ /** */

import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import config from './config';
import {CMakeGenerator, CompilerKit, getVSKitEnvironment, Kit, kitChangeNeedsClean, ToolchainKit, VSKit} from './kit';
import * as logging from './logging';
import paths from './paths';
import {fs} from './pr';
import * as proc from './proc';
import rollbar from './rollbar';
import {StateManager} from './state';
import * as util from './util';
import {ConfigureArguments, VariantConfigurationOptions} from './variant';

const log = logging.createLogger('driver');

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
  protected abstract doConfigure(extra_args: string[], consumer?: proc.OutputConsumer): Promise<number>;

  /**
   * Perform a clean configure. Deletes cached files before running the config
   * @param consumer The output consumer
   */
  abstract cleanConfigure(consumer?: proc.OutputConsumer): Promise<number>;

  protected doPreBuild(): Promise<boolean> { return Promise.resolve(true); }

  protected doPostBuild(): Promise<boolean> { return Promise.resolve(true); }

  /**
   * Check if we need to reconfigure, such as if an important file has changed
   */
  abstract get needsReconfigure(): boolean;

  /**
   * List of targets known to CMake
   */
  abstract get targets(): api.Target[];

  /**
   * List of executable targets known to CMake
   */
  abstract get executableTargets(): api.ExecutableTarget[];

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
  protected constructor(readonly stateManager: StateManager) {}

  /**
   * Dispose the driver. This disposes some things synchronously, but also
   * calls the `asyncDispose()` method to start any asynchronous shutdown.
   */
  dispose() {
    log.debug('Disposing base CMakeDriver');
    rollbar.invokeAsync('Async disposing CMake driver', () => this.asyncDispose());
    this._projectNameChangedEmitter.dispose();
  }

  /**
   * The environment variables required by the current kit
   */
  private _kitEnvironmentVariables = new Map<string, string>();

  /**
   * Get the environment variables required by the current Kit
   */
  getKitEnvironmentVariablesObject(): proc.EnvironmentVariables {
    return util.reduce(this._kitEnvironmentVariables.entries(), {}, (acc, [key, value]) => ({...acc, [key]: value}));
  }

  /**
   * Get the environment variables that should be set at CMake-configure time.
   */
  async getConfigureTimeEnvironment(): Promise<proc.EnvironmentVariables> {
    return util.mergeEnvironment(this.getKitEnvironmentVariablesObject(),
                                 await this.getExpandedEnvironment(),
                                 await this.getExpandedConfigureEnvironment(),
                                 this._variantEnv);
  }

  /**
   * Event fired when the name of the CMake project is discovered or changes
   */
  get onProjectNameChanged() { return this._projectNameChangedEmitter.event; }
  private readonly _projectNameChangedEmitter = new vscode.EventEmitter<string>();

  public get projectName(): string { return this.stateManager.projectName || 'Unknown Project'; }
  protected doSetProjectName(v: string) {
    this.stateManager.projectName = v;
    this._projectNameChangedEmitter.fire(v);
  }

  /**
   * The current Kit. Starts out `null`, but once set, is never `null` again.
   * We do some separation here to protect ourselves: The `_baseKit` property
   * is `private`, so derived classes cannot change it, except via
   * `_setBaseKit`, which only allows non-null kits. This prevents the derived
   * classes from resetting the kit back to `null`.
   */
  private _kit: Kit|null = null;

  /**
   * Get the current kit as a `CompilerKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `compilerKit`.
   * Guarded with an `assert`
   */
  private get _compilerKit() {
    console.assert(this._kit && this._kit.type == 'compilerKit', JSON.stringify(this._kit));
    return this._kit as CompilerKit;
  }

  /**
   * Get the current kit as a `ToolchainKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `toolchainKit`.
   * Guarded with an `assert`
   */
  private get _toolchainFileKit() {
    console.assert(this._kit && this._kit.type == 'toolchainKit', JSON.stringify(this._kit));
    return this._kit as ToolchainKit;
  }

  /**
   * Get the current kit as a `VSKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `vsKit`.
   * Guarded with an `assert`
   */
  private get _vsKit() {
    console.assert(this._kit && this._kit.type == 'vsKit', JSON.stringify(this._kit));
    return this._kit as VSKit;
  }

  /**
   * Get replacements from the state manager and update driver relevant
   * ones.
   */
  private get _replacements(): {[key: string]: string|undefined} {
    const ws_root = util.normalizePath(vscode.workspace.rootPath || '.');
    const user_dir = process.platform === 'win32' ? process.env['HOMEPATH']! : process.env['HOME']!;
    const replacements: {[key: string]: string|undefined} = {};

    // Update default replacements
    replacements['workspaceRoot'] = vscode.workspace.rootPath;
    replacements['buildType'] = this.currentBuildType;
    replacements['workspaceRootFolderName'] = path.basename(ws_root);
    replacements['generator'] = this.generatorName || 'null';
    replacements['projectName'] = this.projectName;
    replacements['userHome'] = user_dir;

    // Update Variant replacements
    const variantSettings = this.stateManager.activeVariantSettings;
    if (variantSettings) {
      variantSettings.forEach((value: string, key: string) => {
        if (key != 'buildType') {
          replacements[key] = value;
        } else {
          replacements['buildLabel'] = value;
        }
      });
    }

    return replacements;
  }

  /**
   * Get the environment and apply any needed
   * substitutions before returning it.
   */
  async getExpandedEnvironment(): Promise<{[key: string]: string}> {
    const env = {} as {[key: string]: string};
    await Promise.resolve(util.objectPairs(config.environment)
                              .forEach(async ([key, value]) => env[key] = await this.expandString(value)));
    return env;
  }

  /**
   * Get the configure environment and apply any needed
   * substitutions before returning it.
   */
  async getExpandedConfigureEnvironment(): Promise<{[key: string]: string}> {
    const config_env = {} as {[key: string]: string};
    await Promise.resolve(util.objectPairs(config.configureEnvironment)
                              .forEach(async ([key, value]) => config_env[key] = await this.expandString(value)));
    return config_env;
  }

  /**
   * Replace ${variable} references in the given string with their corresponding
   * values.
   * @param instr The input string
   * @returns A string with the variable references replaced
   */
  async expandString(instr: string, env?: proc.EnvironmentVariables): Promise<string> {
    // Update the replacements and get the updated values
    const replacements = this._replacements;

    // Merge optional env parameter with process environment
    env = env ? util.mergeEnvironment(process.env as proc.EnvironmentVariables, env)
              : process.env as proc.EnvironmentVariables;

    // We accumulate a list of substitutions that we need to make, preventing
    // recursively expanding or looping forever on bad replacements
    const subs = new Map<string, string>();

    const var_re = /\$\{(\w+)\}/g;
    let mat: RegExpMatchArray|null = null;
    while ((mat = var_re.exec(instr))) {
      const full = mat[0];
      const key = mat[1];
      const repl = replacements[key];
      if (!repl) {
        log.warning(`Invalid variable reference ${full} in string: ${instr}`);
      } else {
        subs.set(full, repl);
      }
    }

    const env_re = /\$\{env:(.+?)\}/g;
    while ((mat = env_re.exec(instr))) {
      const full = mat[0];
      const varname = mat[1];
      const repl = env[util.normalizeEnvironmentVarname(varname)] || '';
      subs.set(full, repl);
    }

    const env2_re = /\$\{env\.(.+?)\}/g;
    while ((mat = env2_re.exec(instr))) {
      const full = mat[0];
      const varname = mat[1];
      const repl = env[util.normalizeEnvironmentVarname(varname)] || '';
      subs.set(full, repl);
    }

    const command_re = /\$\{command:(.+?)\}/g;
    while ((mat = command_re.exec(instr))) {
      const full = mat[0];
      const command = mat[1];
      if (subs.has(full)) {
        continue;  // Don't execute commands more than once per string
      }
      try {
        const command_ret = await vscode.commands.executeCommand(command);
        subs.set(full, `${command_ret}`);
      } catch (e) { log.warning(`Exception while executing command ${command} for string: ${instr} (${e})`); }
    }

    let final_str = instr;
    subs.forEach((value, key) => { final_str = util.replaceAll(final_str, key, value); });
    return final_str;
  }

  executeCommand(command: string, args: string[], consumer?: proc.OutputConsumer, options?: proc.ExecutionOptions):
      proc.Subprocess {
    const cur_env = process.env as proc.EnvironmentVariables;
    const env = util.mergeEnvironment(cur_env,
                                      this.getKitEnvironmentVariablesObject(),
                                      (options && options.environment) ? options.environment : {});
    const exec_options = {...options, environment: env};
    return proc.execute(command, args, consumer, exec_options);
  }

  /**
   * Change the current kit. This lets the driver reload, if necessary.
   * @param kit The new kit
   */
  async setKit(kit: Kit): Promise<void> {
    log.info(`Switching to kit: ${kit.name}`);
    const needs_clean = kitChangeNeedsClean(kit, this._kit);
    await this.doSetKit(needs_clean, async () => { await this._setKit(kit); });
  }

  private async _setKit(kit: Kit): Promise<void> {
    this._kit = Object.seal({...kit});
    log.debug('CMakeDriver Kit set to', kit.name);

    this._kitEnvironmentVariables = new Map();
    switch (this._kit.type) {
    case 'vsKit': {
      const vars = await getVSKitEnvironment(this._kit);
      if (!vars) {
        log.error('Invalid VS environment:', this._kit.name);
        log.error('We couldn\'t find the required environment variables');
      } else {
        this._kitEnvironmentVariables = vars;
      }
      break;
    }
    default: {
      // Other kits don't have environment variables
    }
    }
  }

  protected abstract doSetKit(needsClean: boolean, cb: () => Promise<void>): Promise<void>;

  abstract compilationInfoForFile(filepath: string): Promise<api.CompilationInfo|null>;

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
   */
  async setVariantOptions(opts: VariantConfigurationOptions) {
    log.debug('Setting new variant', opts.long || '(Unnamed)');
    this._variantBuildType = opts.buildType || this._variantBuildType;
    this._variantConfigureSettings = opts.settings || this._variantConfigureSettings;
    this._variantLinkage = opts.linkage || null;
    this._variantEnv = opts.env || {};
    await this._refreshExpansions();
  }

  /**
   * Is the driver busy? ie. running a configure/build/test
   */
  get isBusy() { return this._isBusy; }
  protected _isBusy: boolean = false;

  /**
   * The source directory, where the root CMakeLists.txt lives.
   *
   * @note This is distinct from the config values, since we do variable
   * substitution.
   */
  get sourceDir(): string { return this._sourceDirectory; }
  private _sourceDirectory = '';

  protected doRefreshExpansions(cb: () => Promise<void>): Promise<void> { return cb(); }

  private async _refreshExpansions() {
    await this.doRefreshExpansions(async () => {
      this._sourceDirectory = util.normalizePath(await this.expandString(config.sourceDirectory));
      this._binaryDir = util.normalizePath(await this.expandString(config.buildDirectory));

      const installPrefix = config.installPrefix;
      if (installPrefix) {
        this._installDir = util.normalizePath(await this.expandString(installPrefix));
      }
    });
  }

  /**
   * Path to where the root CMakeLists.txt file should be
   */
  get mainListFile(): string {
    const file = path.join(this.sourceDir, 'CMakeLists.txt');
    return util.normalizePath(file);
  }

  /**
   * Directory where build output is stored.
   */
  get binaryDir(): string { return this._binaryDir; }
  private _binaryDir = '';

  /**
   * Directory where the targets will be installed.
   */
  get installDir(): string|null { return this._installDir; }
  private _installDir: string|null = null;

  /**
   * @brief Get the path to the CMakeCache file in the build directory
   */
  get cachePath(): string {
    // TODO: Cache path can change if build dir changes at runtime
    const file = path.join(this.binaryDir, 'CMakeCache.txt');
    return util.normalizePath(file);
  }

  /**
   * Get the current build type, according to the current selected variant.
   *
   * This is the value passed to CMAKE_BUILD_TYPE or --config for multiconf
   */
  get currentBuildType(): string { return this._variantBuildType; }

  get isMultiConf(): boolean { return this.generatorName ? util.isMultiConfGenerator(this.generatorName) : false; }

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

  private async testHaveCommand(program: string, args: string[] = ['--version']): Promise<boolean> {
    const child = this.executeCommand(program, args, undefined, {silent: true});
    try {
      const result = await child.result;
      return result.retc == 0;
    } catch (e) {
      const e2: NodeJS.ErrnoException = e;
      if (e2.code == 'ENOENT') {
        return false;
      }
      throw e;
    }
  }

  getPreferredGenerators(): CMakeGenerator[] {
    const user_preferred = config.preferredGenerators.map(g => ({name: g}));
    if (this._kit && this._kit.preferredGenerator) {
      // The kit has a preferred generator attached as well
      user_preferred.push(this._kit.preferredGenerator);
    }
    return user_preferred;
  }

  /**
   * Picks the best generator to use on the current system
   */
  async getBestGenerator(): Promise<CMakeGenerator|null> {
    // User can override generator with a setting
    const user_generator = config.generator;
    if (user_generator) {
      log.debug(`Using generator from user configuration: ${user_generator}`);
      return {
        name: user_generator,
        platform: config.platform || undefined,
        toolset: config.toolset || undefined,
      };
    }
    log.debug('Trying to detect generator supported by system');
    const platform = process.platform;
    const candidates = this.getPreferredGenerators();
    for (const gen of candidates) {
      const gen_name = gen.name;
      const generator_present = await (async(): Promise<boolean> => {
        if (gen_name == 'Ninja') {
          return await this.testHaveCommand('ninja-build') || this.testHaveCommand('ninja');
        }
        if (gen_name == 'MinGW Makefiles') {
          return platform === 'win32' && await this.testHaveCommand('make') || this.testHaveCommand('mingw32-make');
        }
        if (gen_name == 'NMake Makefiles') {
          return platform === 'win32' && this.testHaveCommand('nmake', ['/?']);
        }
        if (gen_name == 'Unix Makefiles') {
          return platform !== 'win32' && this.testHaveCommand('make');
        }
        return false;
      })();
      if (!generator_present) {
        const vsMatch = /^(Visual Studio \d{2} \d{4})($|\sWin64$|\sARM$)/.exec(gen.name);
        if (platform === 'win32' && vsMatch) {
          return {
            name: vsMatch[1],
            platform: gen.platform || vsMatch[2],
            toolset: gen.toolset,
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
    vscode.window.showErrorMessage(
        `Unable to determine what CMake generator to use.
Please install or configure a preferred generator, or update settings.json or your Kit configuration.`);
    return null;
  }

  private readonly _onReconfiguredEmitter = new vscode.EventEmitter<void>();
  get onReconfigured(): vscode.Event<void> { return this._onReconfiguredEmitter.event; }

  async configure(extra_args: string[], consumer?: proc.OutputConsumer): Promise<number> {
    const pre_check_ok = await this._beforeConfigure();
    if (!pre_check_ok) {
      return -1;
    }

    const settings = {...config.configureSettings};

    const _makeFlag = (key: string, cmval: util.CMakeValue) => {
      switch (cmval.type) {
      case 'UNKNOWN':
        return `-D${key}=${cmval.value}`;
      default:
        return `-D${key}:${cmval.type}=${cmval.value}`;
      }
    };

    util.objectPairs(this._variantConfigureSettings).forEach(([key, value]) => settings[key] = value);
    if (this._variantLinkage !== null) {
      settings.BUILD_SHARED_LIBS = this._variantLinkage === 'shared';
    }

    // Always export so that we have compile_commands.json
    settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

    if (!this.isMultiConf) {
      // Mutliconf generators do not need the CMAKE_BUILD_TYPE property
      settings.CMAKE_BUILD_TYPE = this.currentBuildType;
    }

    // Only use the installPrefix config if the user didn't
    // provide one via configureSettings
    if (!settings.CMAKE_INSTALL_PREFIX && this.installDir) {
      await this._refreshExpansions();
      settings.CMAKE_INSTALL_PREFIX = this.installDir;
    }

    const settings_flags
        = util.objectPairs(settings).map(([key, value]) => _makeFlag(key, util.cmakeify(value as string)));
    const flags = ['--no-warn-unused-cli'].concat(extra_args, config.configureArgs);

    console.assert(!!this._kit);
    if (!this._kit) {
      throw new Error('No kit is set!');
    }
    switch (this._kit.type) {
    case 'compilerKit': {
      log.debug('Using compilerKit', this._kit.name, 'for usage');
      flags.push(
          ...util.objectPairs(this._kit.compilers).map(([lang, comp]) => `-DCMAKE_${lang}_COMPILER:FILEPATH=${comp}`));
    } break;
    case 'toolchainKit': {
      log.debug('Using CMake toolchain', this._kit.name, 'for configuring');
      flags.push(`-DCMAKE_TOOLCHAIN_FILE=${this._kit.toolchainFile}`);
    } break;
    default:
      log.debug('Kit requires no extra CMake arguments');
    }

    if (this._kit.cmakeSettings) {
      flags.push(...util.objectPairs(this._kit.cmakeSettings).map(([key, val]) => _makeFlag(key, util.cmakeify(val))));
    }

    // Get expanded configure environment
    const expanded_configure_env = this.getExpandedConfigureEnvironment();

    // Expand all flags
    const final_flags = flags.concat(settings_flags);
    const expanded_flags_promises
        = final_flags.map(async (value: string) => this.expandString(value, await expanded_configure_env));
    const expanded_flags = await Promise.all(expanded_flags_promises);
    log.trace('CMake flags are', JSON.stringify(expanded_flags));

    const retc = await this.doConfigure(expanded_flags, consumer);
    this._onReconfiguredEmitter.fire();
    await this._refreshExpansions();
    return retc;
  }

  async build(target: string, consumer?: proc.OutputConsumer): Promise<number|null> {
    const pre_build_ok = await this.doPreBuild();
    if (!pre_build_ok) {
      return -1;
    }
    const child = await this._doCMakeBuild(target, consumer);
    if (!child) {
      return -1;
    }
    const post_build_ok = await this.doPostBuild();
    if (!post_build_ok) {
      return -1;
    }
    await this._refreshExpansions();
    return (await child.result).retc;
  }

  /**
   * Execute pre-configure tasks to check if we are ready to run a full
   * configure. This should be called by a derived driver before any
   * configuration tasks are run
   */
  private async _beforeConfigure(): Promise<boolean> {
    log.debug('Runnnig pre-configure checks and steps');
    if (this._isBusy) {
      if (config.autoRestartBuild) {
        log.debug('Stopping current CMake task.');
        vscode.window.showInformationMessage('Stopping current CMake task and starting new build.');
        await this.stopCurrentProcess();
      } else {
        log.debug('No configuring: We\'re busy.');
        vscode.window.showErrorMessage('A CMake task is already running. Stop it before trying to configure.');
        return false;
      }
    }

    if (!this.sourceDir) {
      log.debug('No configuring: There is no source directory.');
      vscode.window.showErrorMessage('You do not have a source directory open');
      return false;
    }

    const cmake_list = this.mainListFile;
    if (!await fs.exists(cmake_list)) {
      log.debug('No configuring: There is no ', cmake_list);
      const do_quickstart
          = await vscode.window.showErrorMessage('You do not have a CMakeLists.txt', 'Quickstart a new CMake project');
      if (do_quickstart)
        vscode.commands.executeCommand('cmake.quickStart');
      return false;
    }

    // Save open files before we configure/build
    if (config.saveBeforeBuild) {
      log.debug('Saving open files before configure/build');
      const save_good = await vscode.workspace.saveAll();
      if (!save_good) {
        log.debug('Saving open files failed');
        const chosen = await vscode.window.showErrorMessage<
            vscode.MessageItem>('Not all open documents were saved. Would you like to continue anyway?',
                                {
                                  title: 'Yes',
                                  isCloseAffordance: false,
                                },
                                {
                                  title: 'No',
                                  isCloseAffordance: true,
                                });
        return chosen !== undefined && (chosen.title === 'Yes');
      }
    }

    return true;
  }

  /**
   * The currently running process. We keep a handle on it so we can stop it
   * upon user request
   */
  private _currentProcess: proc.Subprocess|null = null;

  private async _doCMakeBuild(target: string, consumer?: proc.OutputConsumer): Promise<proc.Subprocess|null> {
    const ok = await this._beforeConfigure();
    if (!ok) {
      return null;
    }

    const gen = this.generatorName;
    const generator_args = (() => {
      if (!gen)
        return [];
      else if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
        return ['-j', config.numJobs.toString()];
      else if (gen.includes('Visual Studio'))
        return [
          '/m',
          '/property:GenerateFullPaths=true',
        ];  // TODO: Older VS doesn't support these flags
      else
        return [];
    })();

    const build_env = {} as {[key: string]: string};
    await Promise.resolve(
        util.objectPairs(util.mergeEnvironment(config.buildEnvironment, await this.getExpandedEnvironment()))
            .forEach(async ([key, value]) => build_env[key] = await this.expandString(value)));

    const args =
        ['--build', this.binaryDir, '--config', this.currentBuildType, '--target', target].concat(config.buildArgs,
                                                                                                  ['--'],
                                                                                                  generator_args,
                                                                                                  config.buildToolArgs);
    const expanded_args_promises = args.map(async (value: string) => this.expandString(value, build_env));
    const expanded_args = await Promise.all(expanded_args_promises);
    log.trace('CMake build args are: ', JSON.stringify(expanded_args));

    const cmake = await paths.cmakePath;
    const child = this.executeCommand(cmake, expanded_args, consumer, {environment: build_env});
    this._currentProcess = child;
    this._isBusy = true;
    await child.result;
    this._isBusy = false;
    this._currentProcess = null;
    return child;
  }

  /**
   * Stops the currently running process at user request
   */
  async stopCurrentProcess(): Promise<boolean> {
    const cur = this._currentProcess;
    if (!cur) {
      return false;
    }
    await util.termProc(cur.child);
    return true;
  }

  /**
   * The CMake cache for the driver.
   *
   * Will be automatically reloaded when the file on disk changes.
   */
  abstract get cmakeCacheEntries(): Map<string, api.CacheEntryProperties>;

  private async _baseInit(kit: Kit|null) {
    if (kit) {
      // Load up kit environment before starting any drivers.
      await this._setKit(kit);
    }
    await this._refreshExpansions();
    await this.doInit();
  }
  protected abstract doInit(): Promise<void>;

  /**
   * Asynchronous initialization. Should be called by base classes during
   * their initialization.
   */
  static async createDerived<T extends CMakeDriver>(inst: T, kit: Kit|null): Promise<T> {
    await inst._baseInit(kit);
    return inst;
  }
}
