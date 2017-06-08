'use strict';

import * as vscode from 'vscode';

import * as api from './api';
import * as legacy from './legacy';
import * as client from './client';
import * as util from './util';
import {config} from './config';
import {log} from './logging';
import {CMakeToolsBackend} from './backend';

function wrappedAPI(target: any, propertyKey: string, method: PropertyDescriptor) {
  const orig = method.value;
  method.value = async function(...args: any[]) {
    try {
      await this._backend;
      return orig.apply(this, args);
    } catch (e) {
      this.showError();
    }
  };
  return method;
}

/**
 * The purpose of CMaketoolsWrapper is to hide which backend is being used at
 * any particular time behind a single API, such that we can invoke commands
 * on the wrapper, and the underlying implementation will be chosen based on
 * user configuration and platform
 */
export class CMakeToolsWrapper implements api.CMakeToolsAPI, vscode.Disposable {
  private _backend:
      Promise<CMakeToolsBackend> = Promise.reject(new Error('Invalid backend promise'));

  constructor(private _ctx: vscode.ExtensionContext) {}

  /**
   * Disposable for this object.
   *
   * Shutdown the backend and dispose of the emitters
   */
  public async dispose() {
    await this.shutdown();
    this._reconfiguredEmitter.dispose();
    this._targetChangedEventEmitter.dispose();
  }

  /**
   * sourceDir: Promise<string>
   */
  private async _sourceDir() { return (await this._backend).sourceDir; }
  get sourceDir() { return this._sourceDir(); }

  /**
   * mainListFile: Promise<string>
   */
  private async _mainListFile() { return (await this._backend).mainListFile; }
  get mainListFile() { return this._mainListFile(); }

  /**
   * binaryDir: Promise<string>
   */
  private async _binaryDir() { return (await this._backend).binaryDir; }
  get binaryDir() { return this._binaryDir(); }

  /**
   * cachePath: Promise<string>
   */
  private async _cachePath() { return (await this._backend).cachePath; }
  get cachePath() { return this._cachePath(); }

  /**
   * executableTargets: Promise<ExecutableTarget[]>
   */
  private async _executableTargets() { return (await this._backend).executableTargets; }
  get executableTargets() { return this._executableTargets(); }

  /**
   * diagnostics: Promise<DiagnosticCollection[]>
   */
  private async _diagnostics() { return (await this._backend).diagnostics; }
  get diagnostics() { return this._diagnostics(); }

  /**
   * targets: Promise<Target[]>
   */
  private async _targets() { return (await this._backend).targets; }
  get targets() { return this._targets(); }

  @wrappedAPI
  async executeCMakeCommand(args: string[],
                            options?: api.ExecuteOptions): Promise<api.ExecutionResult> {
    return (await this._backend).executeCMakeCommand(args, options);
  }

  @wrappedAPI
  async execute(program: string, args: string[], options?: api.ExecuteOptions):
      Promise<api.ExecutionResult> {
    return (await this._backend).execute(program, args, options);
  }

  @wrappedAPI
  async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo | null> {
    return (await this._backend).compilationInfoForFile(filepath);
  }

  @wrappedAPI
  async configure(extraArgs?: string[], runPrebuild?: boolean): Promise<number> {
    return (await this._backend).configure(extraArgs, runPrebuild);
  }

  @wrappedAPI
  async build(target?: string) { return (await this._backend).build(target); }
  @wrappedAPI
  async install() { return (await this._backend).install(); }
  @wrappedAPI
  async jumpToCacheFile() { return (await this._backend).jumpToCacheFile(); }
  @wrappedAPI
  async clean() { return (await this._backend).clean(); }
  @wrappedAPI
  async cleanConfigure() { return (await this._backend).cleanConfigure(); }
  @wrappedAPI
  async cleanRebuild() { return (await this._backend).cleanRebuild(); }
  @wrappedAPI
  async buildWithTarget() { return (await this._backend).buildWithTarget(); }
  @wrappedAPI
  async setDefaultTarget() { return (await this._backend).setDefaultTarget(); }
  @wrappedAPI
  async setBuildType() { return (await this._backend).setBuildType(); }
  @wrappedAPI
  async ctest() { return (await this._backend).ctest(); }
  @wrappedAPI
  async stop() { return (await this._backend).stop(); }
  @wrappedAPI
  async quickStart() { return (await this._backend).quickStart(); }
  @wrappedAPI
  async debugTarget() { return (await this._backend).debugTarget(); }
  @wrappedAPI
  async launchTarget() { return (await this._backend).launchTarget(); }
  @wrappedAPI
  async launchTargetProgramPath() { return (await this._backend).launchTargetProgramPath(); }
  @wrappedAPI
  async selectLaunchTarget() { return (await this._backend).selectLaunchTarget(); }
  @wrappedAPI
  async selectEnvironments() { return (await this._backend).selectEnvironments(); }
  @wrappedAPI
  async setActiveVariantCombination(settings: api.VariantKeywordSettings) {
    return (await this._backend).setActiveVariantCombination(settings);
  }
  @wrappedAPI
  async toggleCoverageDecorations() {
    return (await this._backend).toggleCoverageDecorations();
  }

  private _reconfiguredEmitter = new vscode.EventEmitter<void>();
  readonly reconfigured = this._reconfiguredEmitter.event;

  private _targetChangedEventEmitter = new vscode.EventEmitter<void>();
  readonly targetChangedEvent = this._targetChangedEventEmitter.event;

  async start(): Promise<void> {
    try {
      let did_start = false;
      if (config.useCMakeServer) {
        const cmpath = config.cmakePath;
        const version_ex = await util.execute(config.cmakePath, [ '--version' ]).onComplete;
        console.assert(version_ex.stdout);
        const version_re = /cmake version (.*?)\r?\n/;
        const version = util.parseVersion(version_re.exec(version_ex.stdout !) ![1]);
        // We purposefully exclude versions <3.7.1, which have some major CMake
        // server bugs
        if (util.versionGreater(version, '3.7.1')) {
          this._backend = client.ServerClientCMakeTools.startup(this._ctx);
          did_start = true;
        }
        log.info(
            'CMake Server is not available with the current CMake executable. Please upgrade to CMake 3.7.2 or newer first.');
      }
      if (!did_start) {
        const leg = new legacy.CMakeTools(this._ctx);
        this._backend = leg.initFinished;
        did_start = true;
      }
      this._backend.then((be) => {
        be.targetChanged(() => this._targetChangedEventEmitter.fire());
        be.reconfigured(() => this._reconfiguredEmitter.fire());
      });
      // Fall back to use the legacy plugin
      // const cmt = new legacy.CMakeTools(this._ctx);
      // const impl = await cmt.initFinished;
    } catch (error) {
      log.error(error);
      this._backend = Promise.reject(error);
      this.showError();
    }
  }

  async shutdown() {
    const be = await this._backend;
    if (be instanceof client.ServerClientCMakeTools) {
      await be.dangerousShutdownClient();
    }
    be.dispose();
    this._backend = Promise.reject(new Error('Invalid backend promise'));
  }

  async restart(): Promise<void> {
    await this.shutdown();
    await this.start();
  }

  async showError() {
    try {
      await this._backend;
    } catch (e) {
      vscode.window.showErrorMessage(`CMakeTools extension was unable to initialize: ${e} [See output window for more details]`);
    }
  }
};