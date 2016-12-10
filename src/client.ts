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
    return this._executableTargets;
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
    return this._globalSettings.generator;
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

  async configure(extraArgs: string[] = [], runPreBuild = true) {
    const pr = this._client.sendRequestRaw({
      type: 'cache',
      cacheArguments: [] as string[]
    });
    pr.foo;
  }

  selectDebugTarget() {
    // TODO
  }

  protected constructor(private _ctx: vscode.ExtensionContext) {
    super(_ctx);
  }

  private _restartClient(): Promise<cms.CMakeServerClient> {
    return cms.CMakeServerClient.start({
      binaryDir: this.binaryDir,
      sourceDir: this.sourceDir,
      cmakePath: config.cmakePath,
      environment: Object.assign({}, config.environment, this.currentEnvironmentVariables),
      onDirty: async() => {
        this._dirty = true;
      },
      onMessage: async (msg) => {
        this._channel.appendLine(msg.message);
      },
      onProgress: async(prog) => {
        this.buildProgress = prog.progressCurrent;
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