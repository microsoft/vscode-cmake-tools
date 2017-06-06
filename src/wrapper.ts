'use strict';

import * as vscode from 'vscode';

import * as api from './api';
import * as legacy from './legacy';
import * as client from './client';
import * as util from './util';
import { config } from './config';
import { log } from './logging';

export class CMakeToolsWrapper {
  private _impl?: api.CMakeToolsAPI = undefined;

  constructor(private _ctx: vscode.ExtensionContext) { }

  public async dispose() {
    await this.shutdown();
    this._reconfiguredEmitter.dispose();
  }

  public get toolsApi(): api.CMakeToolsAPI {
    if (this._impl)
      return this._impl;
    else
      throw new Error("CMakeTools is not initialized");
  }

  public async configure(extraArgs?: string[], runPrebuild?: boolean) {
    if (this._impl)
      await this._impl.configure(extraArgs, runPrebuild);
  }

  public async build(target?: string) {
    if (this._impl)
      await this._impl.build(target);
  }

  public async install() {
    if (this._impl)
      await this._impl.install();
  }

  public async jumpToCacheFile() {
    if (this._impl)
      await this._impl.jumpToCacheFile();
  }

  public async clean() {
    if (this._impl)
      await this._impl.clean();
  }

  public async cleanConfigure() {
    if (this._impl) {
      try {
        await this._impl.cleanConfigure();
      } catch (error) {
        log.error(`Failed to reconfigure project: ${error}`);
        // TODO: show error message?
      }
    }
  }

  public async cleanRebuild() {
    if (this._impl)
      await this._impl.cleanRebuild();
  }

  public async buildWithTarget() {
    if (this._impl)
      await this._impl.buildWithTarget();
  }

  public async setDefaultTarget() {
    if (this._impl)
      await this._impl.setDefaultTarget();
  }

  public async setBuildType() {
    if (this._impl)
      await this._impl.setBuildType();
  }

  public async ctest() {
    if (this._impl)
      await this._impl.ctest();
  }

  public async stop() {
    if (this._impl)
      await this._impl.stop();
  }

  public async quickStart() {
    if (this._impl)
      await this._impl.quickStart();
  }

  public async debugTarget() {
    if (this._impl)
      await this._impl.debugTarget();
  }

  public async launchTarget() {
    if (this._impl)
      await this._impl.launchTarget();
  }


  public async launchTargetProgramPath() {
    if (this._impl)
      await this._impl.launchTargetProgramPath();
  }

  public async selectLaunchTarget() {
    if (this._impl)
      await this._impl.selectLaunchTarget();
  }

  public async selectEnvironments() {
    if (this._impl)
      await this._impl.selectEnvironments();
  }

  public async setActiveVariantCombination(settings: api.VariantKeywordSettings) {
    if (this._impl)
      await this._impl.setActiveVariantCombination(settings);
  }

  public async toggleCoverageDecorations() {
    if (this._impl)
      await this._impl.toggleCoverageDecorations();
  }

  private _reconfiguredEmitter = new vscode.EventEmitter<void>();
  readonly reconfigured = this._reconfiguredEmitter.event;

  private _targetChangedEventEmitter = new vscode.EventEmitter<void>();
  readonly targetChangedEvent = this._targetChangedEventEmitter.event;

  private setToolsApi(cmt?: api.CMakeToolsAPI): void {
    this._impl = cmt;
    util.setCommandContext(util.CommandContext.Enabled, !!cmt);
    if (this._impl) {
      this._impl.targetChangedEvent(() => { this._targetChangedEventEmitter.fire(); });
      this._impl.reconfigured(() => { this._reconfiguredEmitter.fire(); });
    }
  }

  public async start(): Promise<void> {
    console.assert(!this._impl);
    try {
      if (config.useCMakeServer) {
        const cmpath = config.cmakePath;
        const version_ex = await util.execute(config.cmakePath, ['--version']).onComplete;
        console.assert(version_ex.stdout);
        const version_re = /cmake version (.*?)\r?\n/;
        const version = util.parseVersion(version_re.exec(version_ex.stdout!)![1]);
        // We purposefully exclude versions <3.7.1, which have some major CMake
        // server bugs
        if (util.versionGreater(version, '3.7.1')) {
          const impl = await client.ServerClientCMakeTools.startup(this._ctx);
          await impl;
          this.setToolsApi(impl);
          return;
        }
        log.error('CMake Server is not available with the current CMake executable. Please upgrade to CMake 3.7.2 or newer first.');
      }
      // Fall back to use the legacy plugin
      const cmt = new legacy.CMakeTools(this._ctx);
      const impl = await cmt.initFinished;
      this.setToolsApi(impl);
    } catch (error) {
      this.setToolsApi();
      log.error(`Failed to start CMakeTools: ${error}`);
      vscode.window.showErrorMessage('CMakeTools extension was unable to initialize. Please check output window for details.');
    }
  }

  public async shutdown() {
    if (!this._impl)
      return;

    if (this._impl instanceof client.ServerClientCMakeTools) {
      await this._impl.dangerousShutdownClient();
    }
    this._impl.dispose();
    this.setToolsApi();
  }

  public async restart(): Promise<void> {
    await this.shutdown();
    await this.start();
  }

};