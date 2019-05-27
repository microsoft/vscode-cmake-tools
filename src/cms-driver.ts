import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
import {InputFileSet} from '@cmt/dirty';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import {CacheEntryProperties, ExecutableTarget, RichTarget} from './api';
import * as cache from './cache';
import * as cms from './cms-client';
import {CMakeDriver, CMakePreconditionProblemSolver} from './driver';
import {Kit, CMakeGenerator} from './kit';
import {createLogger} from './logging';
import * as proc from './proc';
import rollbar from './rollbar';
import { ConfigurationReader } from './config';

const log = createLogger('cms-driver');

export class NoGeneratorError extends Error {
  message: string = 'No usable generator found.';
}

export class CMakeServerClientDriver extends CMakeDriver {
  private constructor(cmake: CMakeExecutable, readonly config: ConfigurationReader, workspaceRootPath: string | null, preconditionHandler: CMakePreconditionProblemSolver) {
    super(cmake, config, workspaceRootPath, preconditionHandler);
    this.config.onChange('environment', () => this._restartClient());
    this.config.onChange('configureEnvironment', () => this._restartClient());
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

  protected async doPreCleanConfigure(): Promise<void> {
    const old_cl = await this._cmsClient;
    this._cmsClient = (async () => {
      // Stop the server before we try to rip out any old files
      await old_cl.shutdown();
      await this._cleanPriorConfiguration();
      return this._startNewClient();
    })();
  }

  protected async doConfigure(args: string[], consumer?: proc.OutputConsumer) {
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
      this._hadConfigurationChanged = false;
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

  protected async doPreBuild(): Promise<boolean> { return true; }

  protected async doPostBuild(): Promise<boolean> {
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
    const metaTargets = [{
      type: 'rich' as 'rich',
      name: this.allTargetName,
      filepath: 'A special target to build all available targets',
      targetType: 'META',
    }];
    if(build_config.projects.some(project => (project.hasInstallRule)? project.hasInstallRule: false))
    {
      metaTargets.push({
        type: 'rich' as 'rich',
        name: 'install',
        filepath: 'A special target to install all available targets',
        targetType: 'META',
      });
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
                                                      metaTargets);
  }

  get executableTargets(): ExecutableTarget[] {
    return this.targets.filter(t => t.targetType === 'EXECUTABLE').map(t => ({
                                                                         name: t.name,
                                                                         path: t.filepath,
                                                                       }));
  }

  get generatorName(): string|null { return this._globalSettings ? this._globalSettings.generator : null; }

  /**
   * Track if the user changes the settings of the configure via settings.json
   */
  private _hadConfigurationChanged = true;
  protected doConfigureSettingsChange() {
    this._hadConfigurationChanged = true;
  }

  async checkNeedsReconfigure(): Promise<boolean> {
    if (this._hadConfigurationChanged) {
      return this._hadConfigurationChanged;
    }
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
      await this._cleanPriorConfiguration();
    }
    await cb();
    await this._restartClient();
  }

  protected async doSetKit(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
    this._clientChangeInProgress = this._setKitAndRestart(need_clean, cb);
    return this._clientChangeInProgress;
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
    if (!this.generator) {
      throw new NoGeneratorError();
    }

    return cms.CMakeServerClient.start({
      tmpdir: path.join(this.workspaceRootPath!, '.vscode'),
      binaryDir: this.binaryDir,
      sourceDir: this.sourceDir,
      cmakePath: this.cmake.path,
      environment: await this.getConfigureEnvironment(),
      onDirty: async () => {
        // cmake-server has dirty check issues, so we implement our own dirty
        // checking. Maybe in the future this can be useful for auto-configuring
        // on file changes?
      },
      onOtherOutput: async msg => this._onMessageEmitter.fire(msg),
      onMessage: async msg => { this._onMessageEmitter.fire(msg.message); },
      onProgress: async prog => {
        this._progressEmitter.fire(prog);
      },
      generator: this.generator,
    });
  }

  private readonly _onMessageEmitter = new vscode.EventEmitter<string>();
  get onMessage() { return this._onMessageEmitter.event; }

  protected async doInit(): Promise<void> { await this._restartClient(); }

  static async create(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit|null, workspaceRootPath: string | null, preconditionHandler: CMakePreconditionProblemSolver, preferedGenerators: CMakeGenerator[]): Promise<CMakeServerClientDriver> {
    return this.createDerived(new CMakeServerClientDriver(cmake, config, workspaceRootPath, preconditionHandler), kit, preferedGenerators);
  }
}
