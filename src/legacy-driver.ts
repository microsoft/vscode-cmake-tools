/**
 * Module for the legacy driver. Talks to pre-CMake Server versions of CMake.
 * Can also talk to newer versions of CMake via the command line.
 */ /** */

import * as vscode from 'vscode';
import * as path from 'path';

import {CMakeDriver} from './driver';
// import rollbar from './rollbar';
import {Kit} from './kit';
import {fs} from './pr';
import config from './config';
import * as util from './util';
import * as proc from './proc';
// import * as proc from './proc';
import * as logging from './logging';

const log = logging.createLogger('legacy-driver');

/**
 * The legacy driver.
 */
export class LegacyCMakeDriver extends CMakeDriver {
  private constructor() { super(); }

  /**
   * The currently running process. We keep a handle on it so we can stop it
   * upon user request
   */
  private _currentProcess: proc.Subprocess | null = null;

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

  get onReconfigured() { return this._onReconfiguredEmitter.event; }
  private _onReconfiguredEmitter = new vscode.EventEmitter<void>();

  // Legacy disposal does nothing
  async asyncDispose() { this._onReconfiguredEmitter.dispose(); }

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
      const generator = 'Ninja';  // TODO: Find generators!
      log.debug('Using', generator, 'CMake generator');
      args.push('-G' + generator);
      // TODO: Platform and toolset selection
    }

    args.push(...await this._prepareConfigure());
    args.push(...extra_args);

    // TODO: Make sure we are respecting all variant options

    // TODO: Read options from settings.json

    console.assert(!!this._kit);
    if (!this._kit) {
      throw new Error('No kit is set!');
    }
    switch (this._kit.type) {
    case 'compilerKit': {
      log.debug('Using compilerKit', this._kit.name, 'for usage');
      args.push(...util.objectPairs(this._kit.compilers)
                    .map(([ lang, comp ]) => `-DCMAKE_${lang}_COMPILER:FILEPATH=${comp}`));
    } break;
    case 'toolchainKit': {
      log.debug('Using CMake toolchain', this._kit.name, 'for configuring');
      args.push(`-DCMAKE_TOOLCHAIN_FILE=${this._kit.toolchainFile}`);
    } break;
    default:
      log.debug('Kit requires no extra CMake arguments');
    }

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
    await this._reloadCMakeCache();
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
    const ok = await this._beforeConfigure();
    if (!ok) {
      return null;
    }
    const gen = await this.generatorName;
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
        [ '--build', this.binaryDir, '--config', this.currentBuildType, '--target', target, '--' ].concat(
            generator_args);
    const child = this.executeCommand(config.cmakePath, args, consumer);
    this._currentProcess = child;
    await child.result;
    this._currentProcess = null;
    await this._reloadCMakeCache();
    this._onReconfiguredEmitter.fire();
    return child;
  }

  async stopCurrentProcess(): Promise<boolean> {
    const cur = this._currentProcess;
    if (!cur) {
      return false;
    }
    await util.termProc(cur.child);
    return true;
  }

  protected async _init() { await super._init(); }

  static async create(): Promise<LegacyCMakeDriver> {
    log.debug('Creating instance of LegacyCMakeDriver');
    const inst = new LegacyCMakeDriver();
    await inst._init();
    return inst;
  }

  get targets() { return []; }
  get executableTargets() { return []; }
}
