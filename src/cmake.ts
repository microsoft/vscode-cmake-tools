'use strict';

import * as vscode from 'vscode';

import * as api from './api';
import * as legacy from './legacy';

export class CMakeToolsWrapper implements api.CMakeToolsAPI {
  private _impl: Promise<api.CMakeToolsAPI>;

  constructor(private _ctx: vscode.ExtensionContext) {}

  async dispose() {
    return (await this._impl).dispose();
  }

  private async _sourceDir() {
    return (await this._impl).sourceDir;
  }
  get sourceDir() {
    return this._sourceDir();
  }

  private async _mainListFile() {
    return (await this._impl).mainListFile;
  }
  get mainListFile() {
    return this._mainListFile();
  }

  private async _binaryDir() {
    return (await this._impl).binaryDir;
  }
  get binaryDir() {
    return this._binaryDir();
  }

  private async _cachePath() {
    return (await this._impl).cachePath;
  }
  get cachePath() {
    return this._cachePath();
  }

  private async _executableTargets() {
    return (await this._impl).executableTargets;
  }
  get executableTargets() {
    return this._executableTargets();
  }

  private async _diagnostics() {
    return (await this._impl).diagnostics;
  }
  get diagnostics() {
    return this._diagnostics();
  }

  async executeCMakeCommand(args: string[], options?: api.ExecuteOptions) {
    return (await this._impl).executeCMakeCommand(args, options);
  }

  async execute(program: string, args: string[], options?: api.ExecuteOptions) {
    return (await this._impl).execute(program, args, options);
  }

  async compilationInfoForFile(filepath: string) {
    return (await this._impl).compilationInfoForFile(filepath);
  }

  async configure(extraArgs?: string[], runPrebuild?: boolean) {
    return (await this._impl).configure(extraArgs, runPrebuild);
  }

  async build(target?: string) {
    return (await this._impl).build(target);
  }

  async install() {
    return (await this._impl).install();
  }

  async jumpToCacheFile() {
    return (await this._impl).jumpToCacheFile();
  }

  async clean() {
    return (await this._impl).clean();
  }

  async cleanConfigure() {
    return (await this._impl).cleanConfigure();
  }

  async cleanRebuild() {
    return (await this._impl).cleanRebuild();
  }

  async buildWithTarget() {
    return (await this._impl).buildWithTarget();
  }

  async setDefaultTarget() {
    return (await this._impl).setDefaultTarget();
  }

  async setBuildType() {
    return (await this._impl).setBuildType();
  }

  async ctest() {
    return (await this._impl).ctest();
  }

  async stop() {
    return (await this._impl).stop();
  }

  async quickStart() {
    return (await this._impl).quickStart();
  }

  async debugTarget() {
    return (await this._impl).debugTarget();
  }

  async selectDebugTarget() {
    return (await this._impl).selectDebugTarget();
  }

  async selectEnvironments() {
    return (await this._impl).selectEnvironments();
  }

  async setActiveVariantCombination(settings: api.VariantKeywordSettings) {
    return (await this._impl).setActiveVariantCombination(settings);
  }

  public async reload(): Promise<CMakeToolsWrapper> {
    const cmt = new legacy.CMakeTools(this._ctx);
    this._impl = cmt.initFinished;
    await this._impl;
    return this;
  }

  static startup(ct: vscode.ExtensionContext): Promise<CMakeToolsWrapper> {
    const cmt = new CMakeToolsWrapper(ct);
    return cmt.reload();
  }
};