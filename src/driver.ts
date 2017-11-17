/**
 * Defines base class for CMake drivers
 */ /** */

import * as path from 'path';

import * as vscode from 'vscode';

import * as api from './api';
import rollbar from './rollbar';
import {Kit, CompilerKit, ToolchainKit, VSKit, getVSKitEnvironment} from './kit';
import {CMakeCache} from './cache';
import * as util from './util';
import config from './config';
import * as logging from './logging';
import {fs} from './pr';
import * as proc from './proc';
import {VariantConfigurationOptions} from "./variant";

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
  abstract configure(extra_args: string[], consumer?: proc.OutputConsumer): Promise<number>;

  /**
   * Perform a clean configure. Deletes cached files before running the config
   * @param consumer The output consumer
   */
  abstract cleanConfigure(consumer?: proc.OutputConsumer): Promise<number>;

  /**
   * Execute a CMake build. Should not configure.
   * @param target The target to build
   */
  abstract build(target: string, consumer?: proc.OutputConsumer): Promise<proc.Subprocess | null>;

  /**
   * Stops the currently running process at user request
   */
  abstract stopCurrentProcess(): Promise<boolean>;

  /**
   * Check if we need to reconfigure, such as if an important file has changed
   */
  abstract get needsReconfigure(): boolean;

  /**
   * Event emitted when configuration finishes
   */
  abstract get onReconfigured(): vscode.Event<void>;

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
    this._cacheWatcher.dispose();
    this._projectNameChangedEmitter.dispose();
  }

  /**
   * The current Kit. Starts out `null`, but once set, is never `null` again.
   * We do some separation here to protect ourselves: The `_baseKit` property
   * is `private`, so derived classes cannot change it, except via
   * `_setBaseKit`, which only allows non-null kits. This prevents the derived
   * classes from resetting the kit back to `null`.
   */
  private _baseKit: Kit | null = null;

  /**
   * The environment variables required by the current kit
   */
  private _kitEnvironmentVariables = new Map<string, string>();

  /**
   * Sets the kit on the base class.
   * @param k The new kit
   */
  protected async _setBaseKit(k: Kit) {
    this._baseKit = k;
    log.debug('CMakeDriver Kit set to', k.name);

    this._kitEnvironmentVariables = new Map();
    switch (this._baseKit.type) {
    case 'vsKit': {
      const vars = await getVSKitEnvironment(this._baseKit);
      if (!vars) {
        log.error('Invalid VS environment:', this._baseKit.name);
        log.error('We couldn\'t find the required environment variables');
      } else {
        this._kitEnvironmentVariables = vars;
      }
    }
    default: {
      // Other kits don't have environment variables
    }
    }
  }

  /**
   * Get the environment variables required by the current Kit
   */
  protected _getKitEnvironmentVariablesObject(): {[key: string] : string} {
    return util.reduce(this._kitEnvironmentVariables.entries(),
                       {},
                       (acc, [ key, value ]) => Object.assign(acc, {[key] : value}));
  }

  /**
   * Event fired when the name of the CMake project is discovered or changes
   */
  get onProjectNameChanged() { return this._projectNameChangedEmitter.event; }
  protected _projectNameChangedEmitter = new vscode.EventEmitter<string>();

  /**
   * The name of the project
   */
  get projectName(): Promise<string | null> {
    return this.cmakeCache.then(cache => {
      if (cache) {
        const project = cache.get('CMAKE_PROJECT_NAME');
        if (project) {
          return project.as<string>();
        }
      }
      return null;
    });
  }

  /**
   * Get the current kit. Once non-`null`, the kit is never `null` again.
   */
  protected get _kit() { return this._baseKit; }

  /**
   * Get the current kit as a `CompilerKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `compilerKit`.
   * Guarded with an `assert`
   */
  protected get _compilerKit() {
    console.assert(this._kit && this._kit.type == 'compilerKit', JSON.stringify(this._kit));
    return this._kit as CompilerKit;
  }

  /**
   * Get the current kit as a `ToolchainKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `toolchainKit`.
   * Guarded with an `assert`
   */
  protected get _toolchainFileKit() {
    console.assert(this._kit && this._kit.type == 'toolchainKit', JSON.stringify(this._kit));
    return this._kit as ToolchainKit;
  }

  /**
   * Get the current kit as a `VSKit`.
   *
   * @precondition `this._kit` is non-`null` and `this._kit.type` is `vsKit`.
   * Guarded with an `assert`
   */
  protected get _vsKit() {
    console.assert(this._kit && this._kit.type == 'vsKit', JSON.stringify(this._kit));
    return this._kit as VSKit;
  }

  /**
   * Determine if we need to wipe the build directory if we change adopt `kit`
   * @param kit The new kit
   * @returns `true` if the new kit requires a clean reconfigure.
   */
  protected _kitChangeNeedsClean(kit: Kit): boolean {
    log.debug('Checking if Kit change necessitates cleaning');
    if (!this._kit) {
      // First kit? We never clean
      log.debug('Clean not needed: No prior Kit selected');
      return false;
    }
    if (kit.type !== this._kit.type) {
      // If the kit type changed, we must clean up
      log.debug('Need clean: Kit type changed', this._kit.type, '->', kit.type);
      return true;
    }
    switch (kit.type) {
    case 'compilerKit': {
      // We need to wipe out the build directory if the compiler for any language was changed.
      const comp_changed = Object.keys(this._compilerKit.compilers).some(lang => {
        return !!this._compilerKit.compilers[lang]
            && this._compilerKit.compilers[lang] !== kit.compilers[lang];
      });
      if (comp_changed) {
        log.debug('Need clean: Compilers for one or more languages changed');
      } else {
        log.debug('Clean not needed: No compilers changed');
      }
      return comp_changed;
    }
    case 'toolchainKit': {
      // We'll assume that a new toolchain is very destructive
      const tc_chained = kit.toolchainFile !== this._toolchainFileKit.toolchainFile;
      if (tc_chained) {
        log.debug('Need clean: Toolchain file changed',
                  this._toolchainFileKit.toolchainFile,
                  '->',
                  kit.toolchainFile);
      } else {
        log.debug('Clean not needed: toolchain file unchanged');
      }
      return tc_chained;
    }
    case 'vsKit': {
      // Switching VS changes everything
      const vs_changed = kit.visualStudio !== this._vsKit.visualStudio
          || kit.visualStudioArchitecture !== this._vsKit.visualStudioArchitecture;
      if (vs_changed) {
        const old_vs = this._vsKit.name;
        const new_vs = kit.name;
        log.debug('Need clean: Visual Studio changed:', old_vs, '->', new_vs);
      } else {
        log.debug('Clean not needed: Same Visual Studio');
      }
      return vs_changed;
    }
    }
  }

  executeCommand(command: string,
                 args: string[],
                 consumer?: proc.OutputConsumer,
                 options?: proc.ExecutionOptions): proc.Subprocess {
    let env = this._getKitEnvironmentVariablesObject();
    if (options && options.environment) {
      env = Object.assign({}, env, options.environment);
    }
    const final_options = Object.assign({}, options, {environment : env});
    return proc.execute(command, args, consumer, final_options);
  }

  /**
   * Change the current kit. This lets the driver reload, if necessary.
   * @param kit The new kit
   */
  abstract setKit(kit: Kit): Promise<void>;

  /**
   * Change the current options from the variant.
   * @param opts The new options
   */
  abstract setVariantOptions(opts: VariantConfigurationOptions): Promise<void>;

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
  abstract get currentBuildType(): string;

  /**
   * Get the name of the current CMake generator, or `null` if we have not yet
   * configured the project.
   */
  get generatorName(): Promise<string | null> { return this._generatorName(); }
  private async _generatorName(): Promise<string | null> {
    const cache = await this.cmakeCache;
    if (!cache) {
      return null;
    }
    const gen = cache.get('CMAKE_GENERATOR');
    if (!gen) {
      return null;
    }
    return gen.as<string>();
  }

  /**
   * Execute pre-configure tasks. This should be called by a derived driver
   * before any configuration tasks are run
   */
  protected async _beforeConfigure(): Promise<boolean> {
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
      await vscode.window.showErrorMessage('You do not have a CMakeLists.txt');
      // if (do_quickstart) // TODO
      //   await this.quickStart();
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

    // TODO
    // // If no build variant has been chosen, ask the user now
    // if (!this.variants.activeVariantCombination) {
    //   const ok = await this.setBuildTypeWithoutConfigure();
    //   if (!ok) {
    //     return false;
    //   }
    // }
    // this._channel.show();
    return true;
  }

  /**
   * The CMake cache for the driver.
   *
   * Will be automatically reloaded when the file on disk changes.
   */
  get cmakeCache() { return this._cmakeCache; }
  private _cmakeCache: Promise<CMakeCache | null> = Promise.resolve(null);

  /**
   * Watcher for the CMake cache file on disk.
   */
  private _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

  /**
   * Get all cache entries
   */
  get allCacheEntries() { return this._allCacheEntries(); }
  private async _allCacheEntries(): Promise<api.CacheEntryProperties[]> {
    const cache = await this.cmakeCache;
    if (!cache) {
      return [];
    } else {
      return cache.allEntries.map(e => ({
                                    type : e.type,
                                    key : e.key,
                                    value : e.value,
                                    advanced : e.advanced,
                                    helpString : e.helpString,
                                  }));
    }
  }

  /**
   * Asynchronous initialization. Should be called by base classes during
   * their initialization.
   */
  protected async _init() {
    log.debug('Base _init() of CMakeDriver');
    if (await fs.exists(this.cachePath)) {
      await this._reloadCMakeCache();
    }
    this._cacheWatcher.onDidChange(() => {
      log.debug(`Reload CMake cache: ${this.cachePath} changed`);
      rollbar.invokeAsync('Reloading CMake Cache', () => this._reloadCMakeCache());
    });
  }

  protected async _reloadCMakeCache() {
    this._cmakeCache = CMakeCache.fromPath(this.cachePath);
    // Force await here so that any errors are thrown into rollbar
    await this._cmakeCache;
    const name = await this.projectName;
    if (name) {
      this._projectNameChangedEmitter.fire(name);
    }
  }

  /**
   * Get the list of command line flags that should be passed to CMake
   */
  protected _cmakeFlags(): string[] {
    const settings = Object.assign({}, config.configureSettings);

    // TODO: Detect multi-conf
    settings.CMAKE_BUILD_TYPE = this.currentBuildType;
    settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

    const _makeFlag = (key: string, value: any) => {
      if (value === true || value === false) {
        return `-D${key}:BOOL=${value ? 'TRUE' : 'FALSE'}`;
      } else if (typeof(value) === 'string') {
        return `-D${key}:STRING=${value}`;
      } else if (value instanceof Number || typeof value === 'number') {
        return `-D${key}:STRING=${value}`;
      } else if (value instanceof Array) {
        return `-D${key}:STRING=${value.join(';')}`;
      } else if (typeof value === 'object') {
        // TODO: Log invalid value
        throw new Error();
      } else {
        console.assert(false, 'Unknown value passed to CMake settings', key, value);
        throw new Error();
      }
    };
    const settings_flags
        = util.objectPairs(settings).map(([ key, value ]) => _makeFlag(key, value));
    const flags = [ '--no-warn-unused-cli' ];
    const final_flags = flags.concat(settings_flags);
    log.trace('CMake flags are', JSON.stringify(final_flags));
    return final_flags;
  }
}
