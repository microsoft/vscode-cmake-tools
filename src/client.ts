'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

import * as api from './api';
import * as async from './async';
import * as cache from './cache';
import * as util from './util';
import * as common from './common';
import {config} from './config';
import * as cms from './server-client';

export class ServerClientCMakeTools extends common.CommonCMakeToolsBase {
  private _client: cms.CMakeServerClient;
  private _globalSettings: cms.GlobalSettingsContent;
  private _dirty = true;
  private _cacheEntires = new Map<string, cache.CMakeCacheEntry>();

  private _executableTargets: api.ExecutableTarget[] = [];
  get executableTargets() {
    return this.targets.filter(t => t.targetType == 'EXECUTABLE')
        .map(t => ({
               name: t.name,
               path: t.filepath,
             }));
  }

  public markDirty() {
    this._dirty = true;
  }

  get compilerId() {
    return 'TODO ???';
  }

  get needsReconfigure() {
    return this._dirty;
  }

  get activeGenerator() {
    return this._globalSettings ? this._globalSettings.generator : null;
  }

  cacheEntry(key: string) {
    return this._cacheEntires.get(key) || null;
  }

  async cleanConfigure() {
    const build_dir = this.binaryDir;
    const cache = this.cachePath;
    const cmake_files = path.join(build_dir, 'CMakeFiles');
    await this._client.shutdown();
    if (await async.exists(cache)) {
      this._channel.appendLine('[vscode] Removing ' + cache);
      await async.unlink(cache);
    }
    if (await async.exists(cmake_files)) {
      this._channel.append('[vscode] Removing ' + cmake_files);
      await util.rmdir(cmake_files);
    }
    this._client = await this._restartClient();
    return this.configure();
  }

  async compilationInfoForFile(filepath: string) {
    // TODO
    return null;
  }

  async configure(extraArgs: string[] = [], runPreBuild = true):
      Promise<number> {
    if (!await this._preconfigure()) {
      return -1;
    }
    if (runPreBuild) {
      if (!await this._prebuild()) {
        return -1;
      }
    }
    const settings = Object.assign({}, config.configureSettings);
    if (!this.isMultiConf) {
      settings.CMAKE_BUILD_TYPE = this.selectedBuildType;
    }

    settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;
    const variant_options = this.variants.activeConfigurationOptions;
    if (variant_options) {
      Object.assign(settings, variant_options.settings || {});
      settings.BUID_SHARED_LIBS = variant_options.linkage === 'shared';
    }

    const inst_prefix = config.installPrefix;
    if (inst_prefix && inst_prefix != '') {
      settings.CMAKE_INSTALL_PREFIX = this.replaceVars(inst_prefix);
    }

    const cmt_dir = path.join(this.binaryDir, 'CMakeTools');
    await util.ensureDirectory(cmt_dir);
    const init_cache_path =
        path.join(this.binaryDir, 'CMakeTools', 'InitializeCache.cmake');
    const init_cache_content = this._buildCacheInitializer(settings);
    await util.writeFile(init_cache_path, init_cache_content);

    this.statusMessage = 'Configuring...';
    try {
      await this._client.configure({cacheArguments: ['-C', init_cache_path]});
      await this._client.compute();
    } catch (e) {
      if (e instanceof cms.ServerError) {
        this._channel.appendLine(`[vscode] Configure failed: ${e}`);
      } else {
        throw e;
      }
    }
    this._workspaceCacheContent.codeModel =
        await this._client.sendRequest('codemodel');
    await this._writeWorkspaceCacheContent();
    return 0;
  }

  async selectDebugTarget() {
    const choices = this.executableTargets.map(e => ({
                                                 label: e.name,
                                                 description: '',
                                                 detail: e.path,
                                               }));
    const chosen = await vscode.window.showQuickPick(choices);
    if (!chosen) {
      return;
    }
    this.currentDebugTarget = chosen.label;
  }

  stop(): Promise<boolean> {
    if (!this.currentChildProcess) {
      return Promise.resolve(false);
    }
    return util.termProc(this.currentChildProcess);
  }

  get targets(): api.RichTarget[] {
    type Ret = api.RichTarget[];
    if (!this._workspaceCacheContent.codeModel) {
      return [];
    }
    const config = this._workspaceCacheContent.codeModel.configurations.find(
        conf => conf.name == this.selectedBuildType);
    if (!config) {
      console.error(
          `Found no matching codemodel config for active build type ${this
              .selectedBuildType}`);
      return [];
    }
    return config.projects.reduce<Ret>(
        (acc, project) =>
            acc.concat(project.targets.map(t => ({
                                             type: 'rich' as 'rich',
                                             name: t.name,
                                             filepath: t.fullName,
                                             targetType: t.type,
                                           }))),
        []);
  }

  protected constructor(private _ctx: vscode.ExtensionContext) {
    super(_ctx);
  }

  private _restartClient(): Promise<cms.CMakeServerClient> {
    return cms.CMakeServerClient.start({
      binaryDir: this.binaryDir,
      sourceDir: this.sourceDir,
      cmakePath: config.cmakePath,
      environment: Object.assign(
          {}, config.environment, this.currentEnvironmentVariables),
      onDirty: async() => {
        this._dirty = true;
      },
      onMessage: async(msg) => {
        this._channel.appendLine(msg.message);
      },
      onProgress: async(prog) => {
        this.buildProgress = (prog.progressCurrent - prog.progressMinimum) /
            (prog.progressMaximum - prog.progressMinimum);
        this.statusMessage = prog.progressMessage;
      },
    });
  }

  protected async _init(): Promise<ServerClientCMakeTools> {
    await super._init();
    const cl = this._client = await this._restartClient();
    this._globalSettings = await cl.getGlobalSettings();
    return this;
  }

  static startup(ct: vscode.ExtensionContext): Promise<ServerClientCMakeTools> {
    const cmt = new ServerClientCMakeTools(ct);
    return cmt._init();
  }
}