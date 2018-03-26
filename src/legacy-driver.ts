/**
 * Module for the legacy driver. Talks to pre-CMake Server versions of CMake.
 * Can also talk to newer versions of CMake via the command line.
 */ /** */

import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import {CMakeCache} from './cache';
import {CompilationDatabase} from './compdb';
import {CMakeDriver} from './driver';
import {Kit} from './kit';
// import * as proc from './proc';
import * as logging from './logging';
import paths from './paths';
import {fs} from './pr';
import * as proc from './proc';
import rollbar from './rollbar';
import {StateManager} from './state';
import * as util from './util';

const log = logging.createLogger('legacy-driver');

/**
 * The legacy driver.
 */
export class LegacyCMakeDriver extends CMakeDriver {
  private constructor(state: StateManager) { super(state); }

  private _needsReconfigure = true;
  get needsReconfigure() { return this._needsReconfigure; }

  async doSetKit(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
    this._needsReconfigure = true;
    if (need_clean) {
      log.debug('Wiping build directory', this.binaryDir);
      await fs.rmdir(this.binaryDir);
    }
    await cb();
  }

  private _compilationDatabase: Promise<CompilationDatabase|null> = Promise.resolve(null);
  async compilationInfoForFile(filepath: string) {
    const db = await this._compilationDatabase;
    if (!db) {
      return null;
    }
    return db.getCompilationInfoForUri(vscode.Uri.file(filepath));
  }

  // Legacy disposal does nothing
  async asyncDispose() { this._cacheWatcher.dispose(); }

  async doConfigure(args_: string[], outputConsumer?: proc.OutputConsumer):
      Promise<number> {
    // Dup args so we can modify them
    const args = Array.from(args_);
    args.push('-H' + util.normalizePath(this.sourceDir));
    const bindir = util.normalizePath(this.binaryDir);
    args.push('-B' + bindir);
    const cmake = await paths.cmakePath;
    log.debug('Invoking CMake', cmake, 'with arguments', JSON.stringify(args));
    const env = await this.getConfigureTimeEnvironment();
    const res = await this.executeCommand(cmake, args, outputConsumer, env).result;
    log.trace(res.stderr);
    log.trace(res.stdout);
    if (res.retc == 0) {
      this._needsReconfigure = false;
    }
    await this._reloadPostConfigure();
    return res.retc === null ? -1 : res.retc;
  }

  async cleanConfigure(consumer?: proc.OutputConsumer) {
    const build_dir = this.binaryDir;
    const cache = this.cachePath;
    const cmake_files = path.join(build_dir, 'CMakeFiles');
    if (await fs.exists(cache)) {
      log.info('Removing ', cache);
      await fs.unlink(cache);
    }
    if (await fs.exists(cmake_files)) {
      log.info('Removing ', cmake_files);
      await fs.rmdir(cmake_files);
    }
    return this.configure([], consumer);
  }

  async doPostBuild(): Promise<boolean> {
    await this._reloadPostConfigure();
    return true;
  }

  async doInit() {
    if (await fs.exists(this.cachePath)) {
      await this._reloadPostConfigure();
    }
    this._cacheWatcher.onDidChange(() => {
      log.debug(`Reload CMake cache: ${this.cachePath} changed`);
      rollbar.invokeAsync('Reloading CMake Cache', () => this._reloadPostConfigure());
    });
  }

  static async create(state: StateManager, kit: Kit|null): Promise<LegacyCMakeDriver> {
    log.debug('Creating instance of LegacyCMakeDriver');
    return this.createDerived(new LegacyCMakeDriver(state), kit);
  }

  get targets() { return []; }
  get executableTargets() { return []; }

  /**
   * Watcher for the CMake cache file on disk.
   */
  private readonly _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

  get cmakeCache() { return this._cmakeCache; }
  private _cmakeCache: CMakeCache|null = null;

  private async _reloadPostConfigure() {
    // Force await here so that any errors are thrown into rollbar
    const new_cache = await CMakeCache.fromPath(this.cachePath);
    this._cmakeCache = new_cache;
    const project = new_cache.get('CMAKE_PROJECT_NAME');
    if (project) {
      this.doSetProjectName(project.as<string>());
    }
    this._compilationDatabase = CompilationDatabase.fromFilePath(path.join(this.binaryDir, 'compile_commands.json'));
  }

  get cmakeCacheEntries() {
    let ret = new Map<string, api.CacheEntryProperties>();
    if (this.cmakeCache) {
      ret = util.reduce(this.cmakeCache.allEntries, ret, (acc, entry) => acc.set(entry.key, entry));
    }
    return ret;
  }

  get generatorName(): string|null {
    if (!this.cmakeCache) {
      return null;
    }
    const gen = this.cmakeCache.get('CMAKE_GENERATOR');
    return gen ? gen.as<string>() : null;
  }

  // get projectName(): string | null {
  //   if (!this.cmakeCache) {
  //     return null;
  //   }
  //   const project = this.cmakeCache.get('CMAKE_PROJECT_NAME');
  //   return project ? project.as<string>() : null;
  // }
}
