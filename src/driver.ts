import * as path from 'path';

import * as vscode from 'vscode';

import * as api from './api';
import {RollbarController} from './rollbar';
import {Kit, CompilerKit, ToolchainKit, VSKit} from './kit';
import {CMakeCache} from './cache';
import * as util from './util';
import {config} from './config';
import {fs} from './pr';

export abstract class CMakeDriver implements vscode.Disposable {
  abstract configure(): Promise<number>;
  abstract asyncDispose(): Promise<void>;

  constructor(protected readonly _rollbar: RollbarController) {}

  // We just call the async disposal method
  dispose() {
    this._rollbar.invokeAsync('Async disposing CMake driver', async () => this.asyncDispose());
    this._cacheWatcher.dispose();
  }

  /// The current kit
  protected _kit: Kit | null = null;
  /// Get the current kit as a compiler kit
  protected get _compilerKit() {
    console.assert(this._kit && this._kit.type == 'compilerKit', JSON.stringify(this._kit));
    return this._kit as CompilerKit;
  }
  /// Get the current kit as a toolchain kit
  protected get _toolchainFileKit() {
    console.assert(this._kit && this._kit.type == 'toolchainKit', JSON.stringify(this._kit));
    return this._kit as ToolchainKit;
  }
  /// Get the current kit as a VS kit
  protected get _vsKit() {
    console.assert(this._kit && this._kit.type == 'vsKit', JSON.stringify(this._kit));
    return this._kit as VSKit;
  }
  /**
   * Determine if we need to wipe the build directory if we change to `kit`
   * @param kit The new kit
   */
  protected _kitChangeNeedsClean(kit: Kit): boolean {
    if (!this._kit) {
      // First kit? We never clean
      return false;
    }
    if (kit.type !== this._kit.type) {
      // If the kit type changed, we must clean up
      return true;
    }
    switch (kit.type) {
    case 'compilerKit': {
      // We need to wipe out the build directory if the compiler for any language was changed.
      return Object.keys(this._compilerKit.compilers).some(lang => {
        return !!this._compilerKit.compilers[lang]
            && this._compilerKit.compilers[lang] !== kit.compilers[lang];
      });
    }
    case 'toolchainKit': {
      // We'll assume that a new toolchain is very destructive
      return kit.toolchainFile !== this._toolchainFileKit.toolchainFile;
    }
    case 'vsKit': {
      // Switching VS changes everything
      return kit.visualStudio !== this._vsKit.visualStudio
          && kit.visualStudioArchitecture !== this._vsKit.visualStudioArchitecture;
    }
    }
  }
  /**
   * Change the current kit. This lets the driver reload, if necessary.
   * @param kit The new kit
   */
  abstract setKit(kit: Kit): Promise<void>;

  /// Are we busy?
  protected _isBusy: boolean = false;

  /**
   * The source directory, where the root CMakeLists.txt lives
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
  public get cachePath(): string {
    const file = path.join(this.binaryDir, 'CMakeCache.txt');
    return util.normalizePath(file);
  }

  /**
   * Execute pre-configure tasks. This should be called by a derived driver
   * before any configuration tasks are run
   */
  protected async _beforeConfigure(): Promise<boolean> {
    if (this._isBusy) {
      vscode.window.showErrorMessage(
          'A CMake task is already running. Stop it before trying to configure.');
      return false;
    }

    if (!this.sourceDir) {
      vscode.window.showErrorMessage('You do not have a source directory open');
      return false;
    }

    const cmake_list = this.mainListFile;
    if (!await fs.exists(cmake_list)) {
      await vscode.window.showErrorMessage('You do not have a CMakeLists.txt');
      // if (do_quickstart) // TODO
      //   await this.quickStart();
      return false;
    }

    // Save open files before we configure/build
    if (config.saveBeforeBuild) {
      const save_good = await vscode.workspace.saveAll();
      if (!save_good) {
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

  private _cmakeCache: CMakeCache | null;
  get cmakeCache() { return this._cmakeCache; }
  private _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

  allCacheEntries(): api.CacheEntryProperties[] {
    return !this.cmakeCache ? [] : this.cmakeCache.allEntries().map(e => ({
                                                                      type : e.type,
                                                                      key : e.key,
                                                                      value : e.value,
                                                                      advanced : e.advanced,
                                                                      helpString : e.helpString,
                                                                    }));
  }

  protected async _init() {
    if (await fs.exists(this.cachePath)) {
      this._cmakeCache = await CMakeCache.fromPath(this.cachePath);
    }
    this._cacheWatcher.onDidChange(() => {
      this._rollbar.invokeAsync('Reloading CMake Cache', async() => {
        this._cmakeCache = await CMakeCache.fromPath(this.cachePath);
      });
    });
  }

  protected _cmakeFlags(): string[] {
    const settings = Object.assign({}, config.configureSettings);

    // TODO: Detect multi-conf
    settings.CMAKE_BUILD_TYPE = 'Debug';
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
    // = Object.getOwnPropertyNames(settings).map(key => _makeFlag(key, settings[key]));
    const flags = [ '--no-warn-unused-cli' ];
    return flags.concat(settings_flags);
  }
}
