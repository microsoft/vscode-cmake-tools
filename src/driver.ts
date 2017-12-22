/**
 * Defines base class for CMake drivers
 */ /** */

import * as path from 'path';

import * as vscode from 'vscode';

import * as api from './api';
import rollbar from './rollbar';
import {Kit, CompilerKit, ToolchainKit, VSKit, getVSKitEnvironment, CMakeGenerator} from './kit';
import * as util from './util';
import config from './config';
import * as logging from './logging';
import {fs} from './pr';
import * as proc from './proc';
import {VariantConfigurationOptions, ConfigureArguments} from "./variant";

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
  protected abstract doConfigure(extra_args: string[],
                                 consumer?: proc.OutputConsumer): Promise<number>;

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
  protected constructor() {}

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
    return util.reduce(this._kitEnvironmentVariables.entries(),
                       {},
                       (acc, [ key, value ]) => Object.assign(acc, {[key] : value}));
  }

  /**
   * Event fired when the name of the CMake project is discovered or changes
   */
  get onProjectNameChanged() { return this._projectNameChangedEmitter.event; }
  private _projectNameChangedEmitter = new vscode.EventEmitter<string>();

  private _projectName: string;
  public get projectName(): string { return this._projectName; }
  protected doSetProjectName(v: string) {
    this._projectName = v;
    this._projectNameChangedEmitter.fire(v);
  }

  /**
   * The current Kit. Starts out `null`, but once set, is never `null` again.
   * We do some separation here to protect ourselves: The `_baseKit` property
   * is `private`, so derived classes cannot change it, except via
   * `_setBaseKit`, which only allows non-null kits. This prevents the derived
   * classes from resetting the kit back to `null`.
   */
  private _kit: Kit | null = null;

  /**
   * Get the current kit. Once non-`null`, the kit is never `null` again.
   */
  get currentKit() { return this._kit; }

  /**
   * Get the current kit as a `CompilerKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `compilerKit`.
   * Guarded with an `assert`
   */
  private get _compilerKit() {
    console.assert(this.currentKit && this.currentKit.type == 'compilerKit',
                   JSON.stringify(this.currentKit));
    return this.currentKit as CompilerKit;
  }

  /**
   * Get the current kit as a `ToolchainKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `toolchainKit`.
   * Guarded with an `assert`
   */
  private get _toolchainFileKit() {
    console.assert(this.currentKit && this.currentKit.type == 'toolchainKit',
                   JSON.stringify(this.currentKit));
    return this.currentKit as ToolchainKit;
  }

  /**
   * Get the current kit as a `VSKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `vsKit`.
   * Guarded with an `assert`
   */
  private get _vsKit() {
    console.assert(this.currentKit && this.currentKit.type == 'vsKit',
                   JSON.stringify(this.currentKit));
    return this.currentKit as VSKit;
  }

  executeCommand(command: string,
                 args: string[],
                 consumer?: proc.OutputConsumer,
                 options?: proc.ExecutionOptions): proc.Subprocess {
    const cur_env = process.env as proc.EnvironmentVariables;
    const env = util.mergeEnvironment(cur_env,
                                      this.getKitEnvironmentVariablesObject(),
                                      (options && options.environment) ? options.environment : {});
    const exec_options = Object.assign({}, options, {environment : env});
    return proc.execute(command, args, consumer, exec_options);
  }

  /**
   * Change the current kit. This lets the driver reload, if necessary.
   * @param kit The new kit
   */
  async setKit(kit: Kit): Promise<void> {
    await this.doPreSetKit(kit);
    this._kit = Object.seal(Object.assign({}, kit));
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
    }
    default: {
      // Other kits don't have environment variables
    }
    }
    await this.doPostSetKit(kit);
  }

  protected async doPreSetKit(_newKit: Kit): Promise<void>{};
  protected async doPostSetKit(_newKit: Kit): Promise<void>{};

  abstract compilationInfoForFile(filepath: string): Promise<api.CompilationInfo | null>;

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
   * Change the current options from the variant.
   * @param opts The new options
   */
  async setVariantOptions(opts: VariantConfigurationOptions) {
    log.debug('Setting new variant', opts.long || '(Unnamed)');
    this._variantBuildType = opts.buildType || this._variantBuildType;
    this._variantConfigureSettings = opts.settings || this._variantConfigureSettings;
    this._variantLinkage = opts.linkage || null;
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
  get sourceDir(): string {
    const dir = util.replaceVars(config.sourceDirectory);
    return util.normalizePath(dir);
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
  get binaryDir(): string {
    const dir = util.replaceVars(config.buildDirectory);
    return util.normalizePath(dir);
  }

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

  get isMultiConf(): boolean {
    return this.generatorName ? util.isMultiConfGenerator(this.generatorName) : false;
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
    const languages = [ 'CXX', 'C', 'CUDA' ];
    for (const lang of languages) {
      const entry = entries.get(`CMAKE_${lang}_COMPILER`);
      if (!entry) {
        continue;
      }
      const compiler = entry.value as string;
      if (compiler.endsWith('cl.exe')) {
        return 'MSVC';
      } else if (/g(cc|)\+\+)/.test(compiler)) {
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

  private async testHaveCommand(program: string,
                                args: string[] = [ '--version' ]): Promise<boolean> {
    const child = this.executeCommand(program, args, undefined, {silent : true});
    try {
      await child.result;
      return true;
    } catch (e) {
      const e2: NodeJS.ErrnoException = e;
      if (e2.code == 'ENOENT') {
        return false;
      }
      throw e;
    }
  }

  getPreferredGenerators(): CMakeGenerator[] {
    const user_preferred = config.preferredGenerators.map(g => ({name : g}));
    if (this.currentKit && this.currentKit.preferredGenerator) {
      // The kit has a preferred generator attached as well
      user_preferred.push(this.currentKit.preferredGenerator);
    }
    return user_preferred;
  }

  /**
   * Picks the best generator to use on the current system
   */
  async getBestGenerator(): Promise<CMakeGenerator | null> {
    // User can override generator with a setting
    const user_generator = config.generator;
    if (user_generator) {
      log.debug(`Using generator from user configuration: ${user_generator}`);
      return {
        name : user_generator,
        platform : config.platform || undefined,
        toolset : config.toolset || undefined,
      };
    }
    log.debug("Trying to detect generator supported by system");
    const platform = process.platform;
    const candidates = this.getPreferredGenerators();
    for (const gen of candidates) {
      const gen_name = gen.name;
      const generator_present = await(async(): Promise<boolean> => {
        if (gen_name == 'Ninja') {
          return await this.testHaveCommand('ninja-build') || await this.testHaveCommand('ninja');
        }
        if (gen_name == 'MinGW Makefiles') {
          return platform === 'win32' && await this.testHaveCommand('make')
              || await this.testHaveCommand('mingw32-make');
        }
        if (gen_name == 'NMake Makefiles') {
          return platform === 'win32' && await this.testHaveCommand('nmake', [ '/?' ]);
        }
        if (gen_name == 'Unix Makefiles') {
          return platform !== 'win32' && await this.testHaveCommand('make');
        }
        return false;
      })();
      if (!generator_present) {
        const vsMatch = /^(Visual Studio \d{2} \d{4})($|\sWin64$|\sARM$)/.exec(gen.name);
        if (platform === 'win32' && vsMatch) {
          return {
            name : vsMatch[1],
            platform : gen.platform || vsMatch[2],
            toolset : gen.toolset,
          };
        }
        if (gen.name.toLowerCase().startsWith('xcode') && platform === 'darwin') {
          return gen;
        }
        vscode.window.showErrorMessage('Unknown CMake generator "' + gen.name + '"');
        continue;
      } else {
        return gen;
      }
    }
    return null;
  }

  private _onReconfiguredEmitter = new vscode.EventEmitter<void>();
  get onReconfigured(): vscode.Event<void> { return this._onReconfiguredEmitter.event; }

  async configure(extra_args: string[], consumer?: proc.OutputConsumer): Promise<number> {
    const pre_check_ok = await this._beforeConfigure();
    if (!pre_check_ok) {
      return -1;
    }

    const settings = Object.assign({}, config.configureSettings);

    const _makeFlag = (key: string, cmval: util.CMakeValue) => {
      switch (cmval.type) {
      case 'UNKNOWN':
        return `-D${key}=${cmval.value}`;
      default:
        return `-D${key}:${cmval.type}=${cmval.value}`;
      }
    };

    util.objectPairs(this._variantConfigureSettings)
        .forEach(([ key, value ]) => settings[key] = value);
    if (this._variantLinkage !== null) {
      settings.BUILD_SHARED_LIBS = this._variantLinkage === 'shared';
    }

    // Always export so that we have compile_commands.json
    settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

    if (!this.isMultiConf) {
      // Mutliconf generators do not need the CMAKE_BUILD_TYPE property
      settings.CMAKE_BUILD_TYPE = this.currentBuildType;
    }

    const settings_flags = util.objectPairs(settings).map(
        ([ key, value ]) => _makeFlag(key, util.cmakeify(value as string)));
    const flags = [ '--no-warn-unused-cli' ].concat(extra_args);

    console.assert(!!this.currentKit);
    if (!this.currentKit) {
      throw new Error('No kit is set!');
    }
    switch (this.currentKit.type) {
    case 'compilerKit': {
      log.debug('Using compilerKit', this.currentKit.name, 'for usage');
      flags.push(...util.objectPairs(this.currentKit.compilers)
                     .map(([ lang, comp ]) => `-DCMAKE_${lang}_COMPILER:FILEPATH=${comp}`));
    } break;
    case 'toolchainKit': {
      log.debug('Using CMake toolchain', this.currentKit.name, 'for configuring');
      flags.push(`-DCMAKE_TOOLCHAIN_FILE=${this.currentKit.toolchainFile}`);
    } break;
    default:
      log.debug('Kit requires no extra CMake arguments');
    }

    if (this.currentKit.cmakeSettings) {
      flags.push(...util.objectPairs(this.currentKit.cmakeSettings)
                     .map(([ key, val ]) => _makeFlag(key, util.cmakeify(val))));
    }

    const final_flags = flags.concat(settings_flags);
    log.trace('CMake flags are', JSON.stringify(final_flags));

    const retc = await this.doConfigure(final_flags, consumer);
    this._onReconfiguredEmitter.fire();
    return retc;
  }

  async build(target: string, consumer?: proc.OutputConsumer): Promise<number | null> {
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
      log.debug('No configuring: We\'re busy.');
      vscode.window.showErrorMessage(
          'A CMake task is already running. Stop it before trying to configure.');
      return false;
    }

    if (!this.sourceDir) {
      log.debug('No configuring: There is no source directory.');
      vscode.window.showErrorMessage('You do not have a source directory open');
      return false;
    }

    const cmake_list = this.mainListFile;
    if (!await fs.exists(cmake_list)) {
      log.debug('No configuring: There is no', cmake_list);
      const do_quickstart = await vscode.window.showErrorMessage('You do not have a CMakeLists.txt',
                                                                 'Quickstart a new CMake project');
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
        const chosen = await vscode.window.showErrorMessage<vscode.MessageItem>(
            'Not all open documents were saved. Would you like to continue anyway?',
            {
              title : 'Yes',
              isCloseAffordance : false,
            },
            {
              title : 'No',
              isCloseAffordance : true,
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
  private _currentProcess: proc.Subprocess | null = null;

  private async _doCMakeBuild(target: string,
                              consumer?: proc.OutputConsumer): Promise<proc.Subprocess | null> {
    const ok = await this._beforeConfigure();
    if (!ok) {
      return null;
    }
    const gen = this.generatorName;
    const generator_args = (() => {
      if (!gen)
        return [];
      else if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
        return [ '-j', config.numJobs.toString() ];
      else if (gen.includes('Visual Studio'))
        return [
          '/m',
          '/property:GenerateFullPaths=true',
        ];  // TODO: Older VS doesn't support these flags
      else
        return [];
    })();
    const args =
        [ '--build', this.binaryDir, '--config', this.currentBuildType, '--target', target, '--' ]
            .concat(generator_args);
    const child = this.executeCommand(config.cmakePath, args, consumer);
    this._currentProcess = child;
    await child.result;
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

  private async _baseInit() { await this.doInit(); }
  protected abstract doInit(): Promise<void>;

  /**
   * Asynchronous initialization. Should be called by base classes during
   * their initialization.
   */
  static async createDerived<T extends CMakeDriver>(inst: T): Promise<T> {
    await inst._baseInit();
    return inst;
  }
}
