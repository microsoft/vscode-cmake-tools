/**
 * Module for the legacy driver. Talks to pre-CMake Server versions of CMake.
 * Can also talk to newer versions of CMake via the command line.
 */ /** */

import * as vscode from 'vscode';
import * as path from 'path';

import {CMakeDriver} from './driver';
import rollbar from './rollbar';
import {Kit} from './kit';
import {fs} from './pr';
import config from './config';
import * as util from './util';
import * as proc from './proc';
// import * as proc from './proc';
import * as logging from './logging';
import {CMakeCache} from "./cache";
import * as api from './api';
import { CompilationDatabase } from './compdb';

const log = logging.createLogger('legacy-driver');

/**
 * The legacy driver.
 */
export class LegacyCMakeDriver extends CMakeDriver {
  private constructor() { super(); }

  private _needsReconfigure = true;
  get needsReconfigure() { return this._needsReconfigure; }

  async setKit(kit: Kit): Promise<void> {
    log.debug('Setting new kit', kit.name);
    this._needsReconfigure = true;
    const need_clean = this._kitChangeNeedsClean(kit);
    if (need_clean) {
      log.debug('Wiping build directory', this.binaryDir);
      await fs.rmdir(this.binaryDir);
    }
    await this._setBaseKit(kit);
  }

  private _compilationDatabase: Promise<CompilationDatabase | null> = Promise.resolve(null);
  async compilationInfoForFile(filepath: string) {
    const db = await this._compilationDatabase;
    if (!db) {
      return null;
    }
    return db.getCompilationInfoForUri(vscode.Uri.file(filepath));
  }

  get onReconfigured() { return this._onReconfiguredEmitter.event; }
  private _onReconfiguredEmitter = new vscode.EventEmitter<void>();

  // Legacy disposal does nothing
  async asyncDispose() {
    this._onReconfiguredEmitter.dispose();
    this._cacheWatcher.dispose();
  }

  async configure(extra_args: string[], outputConsumer?: proc.OutputConsumer): Promise<number> {
    if (!await this._beforeConfigure()) {
      log.debug('Pre-configure steps aborted configure');
      // Pre-configure steps failed. Bad...
      return -1;
    }
    log.debug('Proceeding with configuration');

    // Build up the CMake arguments
    const args: string[] = [];
    if (!await fs.exists(this.cachePath)) {
      // No cache! We are free to change the generator!
      const generator = await this.pickGenerator();
      if (generator) {
        log.info(`Using the ${generator.name} CMake generator`);
        args.push('-G' + generator.name);
        const platform = generator.platform || config.platform || null;
        if (platform) {
          log.info(`Using the ${platform} generator platform`);
          args.push('-A', platform);
        }
        const toolset = generator.toolset || config.toolset || null;
        if (toolset) {
          log.info(`Using the ${toolset} generator toolset`);
          args.push('-T', toolset);
        }
      } else {
        log.warning('Unable to automatically pick a CMake generator. Using default.');
      }
    }

    args.push(...await this._prepareConfigure());
    args.push(...extra_args);

    args.push('-H' + util.normalizePath(this.sourceDir));
    const bindir = util.normalizePath(this.binaryDir);
    args.push('-B' + bindir);
    log.debug('Invoking CMake', config.cmakePath, 'with arguments', JSON.stringify(args));
    const res = await this.executeCommand(config.cmakePath, args, outputConsumer).result;
    log.trace(res.stderr);
    log.trace(res.stdout);
    if (res.retc == 0) {
      this._needsReconfigure = false;
    }
    await this._reloadPostConfigure();
    this._onReconfiguredEmitter.fire();
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
      log.info('[vscode] Removing ', cmake_files);
      await fs.rmdir(cmake_files);
    }
    return this.configure([], consumer);
  }

  async build(target: string, consumer?: proc.OutputConsumer): Promise<proc.Subprocess | null> {
    const child = await this.doCMakeBuild(target, consumer);
    if (!child) {
      return child;
    }
    await this._reloadPostConfigure();
    this._onReconfiguredEmitter.fire();
    return child;
  }

  protected async _init() {
    await super._init();
    if (await fs.exists(this.cachePath)) {
      await this._reloadPostConfigure();
    }
    this._cacheWatcher.onDidChange(() => {
      log.debug(`Reload CMake cache: ${this.cachePath} changed`);
      rollbar.invokeAsync('Reloading CMake Cache', () => this._reloadPostConfigure());
    });
  }

  static async create(): Promise<LegacyCMakeDriver> {
    log.debug('Creating instance of LegacyCMakeDriver');
    const inst = new LegacyCMakeDriver();
    await inst._init();
    return inst;
  }

  get targets() { return []; }
  get executableTargets() { return []; }

  /**
   * Watcher for the CMake cache file on disk.
   */
  private _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

  get cmakeCache() { return this._cmakeCache; }
  private _cmakeCache: CMakeCache | null = null;

  protected async _reloadPostConfigure() {
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

  get generatorName(): string | null {
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
