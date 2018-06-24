import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
import {InputFileSet} from '@cmt/dirty';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import {CacheEntryProperties, ExecutableTarget, RichTarget} from './api';
import * as cache from './cache';
import * as cms from './cms-client';
import {CMakeDriver} from './driver';
import {Kit} from './kit';
import {createLogger} from './logging';
import {fs} from './pr';
import * as proc from './proc';
import rollbar from './rollbar';
import * as util from './util';
import {DirectoryContext} from './workspace';

const log = createLogger('cms-driver');

export class CMakeServerClientDriver extends CMakeDriver {
  private constructor(cmake: CMakeExecutable, private readonly _ws: DirectoryContext) {
    super(cmake, _ws);
    this._ws.config.onChange('environment', () => this._restartClient());
    this._ws.config.onChange('configureEnvironment', () => this._restartClient());
  }

  // TODO: Refactor to make this assertion unecessary
  private _cmsClient!: Promise<cms.CMakeServerClient>;
  private _clientChangeInProgress: Promise<void> = Promise.resolve();
  private _globalSettings!: cms.GlobalSettingsContent;
  private _cacheEntries = new Map<string, cache.Entry>();
  private _cmakeInputFileSet = InputFileSet.createEmpty();

  private readonly _progressEmitter = new vscode.EventEmitter<cms.ProgressMessage>();
  get onProgress() {
    return this._progressEmitter.event;
  }

  /**
   * The previous configuration environment. Used to detect when we need to
   * restart cmake-server
   */
  private _prevConfigureEnv = 'null';

  // TODO: Refactor to make this assertion unecessary
  private _codeModel!: null|cms.CodeModelContent;
  get codeModel(): null|cms.CodeModelContent { return this._codeModel; }
  set codeModel(v: null|cms.CodeModelContent) {
    this._codeModel = v;
    if (v && v.configurations.length && v.configurations[0].projects.length) {
      this.doSetProjectName(v.configurations[0].projects[0].name);
    } else {
      this.doSetProjectName('No project');
    }
  }

  private readonly _codeModelChanged = new vscode.EventEmitter<null|cms.CodeModelContent>();
  get onCodeModelChanged() { return this._codeModelChanged.event; }

  async asyncDispose() {
    this._codeModelChanged.dispose();
    this._progressEmitter.dispose();
    if (this._cmsClient) {
      await (await this._cmsClient).shutdown();
    }
  }

  async cleanConfigure(consumer?: proc.OutputConsumer) {
    const old_cl = await this._cmsClient;
    this._cmsClient = (async () => {
      // Stop the server before we try to rip out any old files
      await old_cl.shutdown();
      const build_dir = this.binaryDir;
      const cache_path = this.cachePath;
      const cmake_files = path.join(build_dir, 'CMakeFiles');
      if (await fs.exists(cache_path)) {
        log.info('Removing', cache_path);
        await fs.unlink(cache_path);
      }
      if (await fs.exists(cmake_files)) {
        log.info('Removing', cmake_files);
        await fs.rmdir(cmake_files);
      }
      return this._startNewClient();
    })();
    return this.configure([], consumer);
  }

  async doConfigure(args: string[], consumer?: proc.OutputConsumer) {
    await this._clientChangeInProgress;
    const cl = await this._cmsClient;
    const sub = this.onMessage(msg => {
      if (consumer) {
        for (const line of msg.split('\n')) {
          consumer.output(line);
        }
      }
    });

    try {
      await cl.configure({cacheArguments: args});
      await cl.compute();
    } catch (e) {
      if (e instanceof cms.ServerError) {
        log.error(`Error during CMake configure: ${e}`);
        return 1;
      } else {
        throw e;
      }
    } finally { sub.dispose(); }
    await this._refreshPostConfigure();
    return 0;
  }

  async doPreBuild(): Promise<boolean> { return true; }

  async doPostBuild(): Promise<boolean> {
    await this._refreshPostConfigure();
    return true;
  }

  async _refreshPostConfigure(): Promise<void> {
    const cl = await this._cmsClient;
    const cmake_inputs = await cl.cmakeInputs();  // <-- 1. This line generates the error
    // Scan all the CMake inputs and capture their mtime so we can check for
    // out-of-dateness later
    this._cmakeInputFileSet = await InputFileSet.create(cmake_inputs);
    const clcache = await cl.getCMakeCacheContent();
    this._cacheEntries = clcache.cache.reduce((acc, el) => {
      const entry_map: {[key: string]: api.CacheEntryType|undefined} = {
        BOOL: api.CacheEntryType.Bool,
        STRING: api.CacheEntryType.String,
        PATH: api.CacheEntryType.Path,
        FILEPATH: api.CacheEntryType.FilePath,
        INTERNAL: api.CacheEntryType.Internal,
        UNINITIALIZED: api.CacheEntryType.Uninitialized,
        STATIC: api.CacheEntryType.Static,
      };
      const type = entry_map[el.type];
      if (type === undefined) {
        rollbar.error(`Unknown cache entry type ${el.type}`);
        return acc;
      }
      acc.set(el.key,
              new cache.Entry(el.key, el.value, type, el.properties.HELPSTRING, el.properties.ADVANCED === '1'));
      return acc;
    }, new Map<string, cache.Entry>());
    this.codeModel = await cl.sendRequest('codemodel');
    this._codeModelChanged.fire(this.codeModel);
  }

  async doRefreshExpansions(cb: () => Promise<void>): Promise<void> {
    log.debug('Run doRefreshExpansions');
    const bindir_before = this.binaryDir;
    const srcdir_before = this.sourceDir;
    await cb();
    if (!bindir_before.length || !srcdir_before.length) {
      return;
    }
    const new_env = JSON.stringify(await this.getConfigureEnvironment());
    if (bindir_before !== this.binaryDir || srcdir_before != this.sourceDir || new_env != this._prevConfigureEnv) {
      // Directories changed. We need to restart the driver
      await this._restartClient();
    }
    this._prevConfigureEnv = new_env;
  }

  get targets(): RichTarget[] {
    if (!this._codeModel) {
      return [];
    }
    const build_config = this._codeModel.configurations.find(conf => conf.name == this.currentBuildType);
    if (!build_config) {
      log.error('Found no matching code model for the current build type. This shouldn\'t be possible');
      return [];
    }
    return build_config.projects.reduce<RichTarget[]>((acc, project) => acc.concat(project.targets.map(
                                                          t => ({
                                                            type: 'rich' as 'rich',
                                                            name: t.name,
                                                            filepath: t.artifacts && t.artifacts.length
                                                                ? path.normalize(t.artifacts[0])
                                                                : 'Utility target',
                                                            targetType: t.type,
                                                          }))),
                                                      [{
                                                        type: 'rich' as 'rich',
                                                        name: this.allTargetName,
                                                        filepath: 'A special target to build all available targets',
                                                        targetType: 'META',
                                                      }]);
  }

  get executableTargets(): ExecutableTarget[] {
    return this.targets.filter(t => t.targetType === 'EXECUTABLE').map(t => ({
                                                                         name: t.name,
                                                                         path: t.filepath,
                                                                       }));
  }

  get generatorName(): string|null { return this._globalSettings ? this._globalSettings.generator : null; }

  async checkNeedsReconfigure(): Promise<boolean> {
    // If we have no input files, we probably haven't configured yet
    if (this._cmakeInputFileSet.inputFiles.length === 0) {
      return true;
    }
    return this._cmakeInputFileSet.checkOutOfDate();
  }

  get cmakeCacheEntries(): Map<string, CacheEntryProperties> { return this._cacheEntries; }


  private async _setKitAndRestart(need_clean: boolean, cb: () => Promise<void>) {
    this._cmakeInputFileSet = InputFileSet.createEmpty();
    const client = await this._cmsClient;
    await client.shutdown();
    if (need_clean) {
      log.debug('Wiping build directory');
      await fs.rmdir(this.binaryDir);
    }
    await cb();
    await this._restartClient();
  }

  async doSetKit(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
    this._clientChangeInProgress = this._setKitAndRestart(need_clean, cb);
    return this._clientChangeInProgress;
  }

  async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo|null> {
    if (!this.codeModel) {
      return null;
    }
    const build_config = this.codeModel.configurations.length === 1
        ? this.codeModel.configurations[0]
        : this.codeModel.configurations.find(c => c.name == this.currentBuildType);
    if (!build_config) {
      return null;
    }
    for (const project of build_config.projects) {
      for (const target of project.targets) {
        if (!target.fileGroups) {
          continue;
        }
        for (const group of target.fileGroups) {
          const found = group.sources.find(source => {
            if (!target.sourceDirectory) {
              return false;
            }
            const abs_source = path.isAbsolute(filepath) ? source : path.join(target.sourceDirectory, source);
            const abs_filepath = path.isAbsolute(filepath) ? filepath : path.join(this.sourceDir, filepath);
            return util.normalizePath(abs_source) === util.normalizePath(abs_filepath);
          });
          if (found) {
            const defs = (group.defines || []).map(util.parseCompileDefinition);
            const defs_o = defs.reduce((acc, [key, value]) => ({...acc, [key]: value}), {});
            const includes = (group.includePath || []).map(p => ({path: p.path, isSystem: p.isSystem || false}));
            const flags = util.splitCommandLine(group.compileFlags);
            return {
              file: found,
              compileDefinitions: defs_o,
              compileFlags: flags,
              includeDirectories: includes,
            };
          }
        }
      }
    }
    return null;
  }

  private async _restartClient(): Promise<void> {
    this._cmsClient = this._doRestartClient();
    const client = await this._cmsClient;
    this._globalSettings = await client.getGlobalSettings();
  }

  private async _doRestartClient(): Promise<cms.CMakeServerClient> {
    const old_client = this._cmsClient;
    if (old_client) {
      const cl = await old_client;
      await cl.shutdown();
    }
    return this._startNewClient();
  }

  private async _startNewClient() {
    return cms.CMakeServerClient.start(this._ws.config, {
      binaryDir: this.binaryDir,
      sourceDir: this.sourceDir,
      cmakePath: this.cmake.path,
      environment: await this.getConfigureEnvironment(),
      onDirty: async () => {
        // cmake-server has dirty check issues, so we implement our own dirty
        // checking. Maybe in the future this can be useful for auto-configuring
        // on file changes?
      },
      onMessage: async msg => { this._onMessageEmitter.fire(msg.message); },
      onProgress: async prog => {
        this._progressEmitter.fire(prog);
      },
      pickGenerator: () => this.getBestGenerator(),
    });
  }

  private readonly _onMessageEmitter = new vscode.EventEmitter<string>();
  get onMessage() { return this._onMessageEmitter.event; }

  async doInit(): Promise<void> { await this._restartClient(); }

  static async create(cmake: CMakeExecutable, wsc: DirectoryContext, kit: Kit|null): Promise<CMakeServerClientDriver> {
    return this.createDerived(new CMakeServerClientDriver(cmake, wsc), kit);
  }
}
