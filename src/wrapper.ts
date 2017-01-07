'use strict';

import * as vscode from 'vscode';

import * as api from './api';
import * as legacy from './legacy';
import * as client from './client';
import * as util from './util';
import {config} from './config';

const open = require('open') as (
    (url: string, appName?: string, callback?: Function) => void);

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

  private async _targets() {
    return (await this._impl).targets;
  }
  get targets() {
    return this._targets();
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
    await this.shutdown();
    const impl = await this._impl;
    if (impl) {
      impl.dispose();
    }
    // NOTE: This block is disabled UNTIL a few upstream CMake Server Bugs are
    // fixed.
    // const cmpath = config.cmakePath;
    // const version_ex =
    //     await util.execute(config.cmakePath, ['--version']).onComplete;
    // console.assert(version_ex.stdout);
    // const version_re = /cmake version (.*?)\r?\n/;
    // const version = util.parseVersion(version_re.exec(version_ex.stdout!)![1]);
    // We purposefully exclude versions <3.7.1, which have some major CMake server
    // bugs
    // const new_enough = util.versionGreater(version, '3.7.1');
    // if (config.experimental_useCMakeServer) {
    //   if (new_enough) {
    //     this._impl = client.ServerClientCMakeTools.startup(this._ctx);
    //     return this;
    //   } else {
    //     vscode.window.showWarningMessage(
    //         'CMake Server is not available with the current CMake executable. Please upgrade to CMake 3.7.2 or newer first.');
    //   }
    // } else {
    //   const dont_nag =
    //       this._ctx.globalState.get('cmakeServerNag.dontNag1', false);
    //   const v36_or_newer = util.versionGreater(version, '3.5.999');
    //   const options = [
    //     {
    //       title: 'Tell me more',
    //       what: 'yes',
    //       isCloseAffordance: false,
    //     },
    //     {
    //       title: 'Not now',
    //       what: 'no',
    //       isCloseAffordance: true,
    //     },
    //     {
    //       title: 'No, and don\'t bother me again',
    //       what: 'never',
    //       isCloseAffordance: false,
    //     }
    //   ];
    //   const continuation = chosen => {
    //     if (chosen.what == 'yes') {
    //       open('https://github.com/vector-of-bool/vscode-cmake-tools/');
    //     } else if (chosen.what == 'never') {
    //       this._ctx.globalState.update('cmakeServerNag.dontNag1', true);
    //     }
    //   };
    //   if (v36_or_newer && !new_enough && !dont_nag) {
    //     vscode.window
    //         .showInformationMessage(
    //             'Would you consider upgrading CMake and trying CMake Tools\' new cmake-server support?',
    //             ...options)
    //         .then(continuation);
    //   } else if (new_enough && !dont_nag) {
    //     vscode.window
    //         .showInformationMessage(
    //             'Would you like to try CMake Tools\' new cmake-server support?',
    //             ...options)
    //         .then(continuation);
    //   }
    // }
    // Fall back to use the legacy plugin
    const cmt = new legacy.CMakeTools(this._ctx);
    this._impl = cmt.initFinished;
    await this._impl;
    return this;
  }

  public async shutdown() {
    const impl = await this._impl;
    if (impl instanceof client.ServerClientCMakeTools) {
      await impl.dangerousShutdownClient();
    }
  }

  static startup(ct: vscode.ExtensionContext): Promise<CMakeToolsWrapper> {
    const cmt = new CMakeToolsWrapper(ct);
    return cmt.reload();
  }
};