import * as vscode from 'vscode';

import * as path from 'path';

import * as api from './api';
import {CMakeDriver} from "./driver";
import config from './config';
import * as cache from './cache';
import * as proc from './proc';
import {ExecutableTarget, RichTarget, CacheEntryProperties} from "./api";
import {Kit} from "./kit";
import * as cms from './cms-client';
import * as util from './util';
import {fs} from "./pr";
import {createLogger} from './logging';

const log = createLogger('cms-driver');

export class CMakeServerClientDriver extends CMakeDriver {
  private constructor(readonly extensionContext: vscode.ExtensionContext) { super(); }
  private _cmsClient: Promise<cms.CMakeServerClient>;
  private _globalSettings: cms.GlobalSettingsContent;
  private _cacheEntries = new Map<string, cache.Entry>();

  private _codeModel: null | cms.CodeModelContent;
  get codeModel(): null | cms.CodeModelContent { return this._codeModel; }
  set codeModel(v: null | cms.CodeModelContent) {
    this._codeModel = v;
    if (v && v.configurations.length && v.configurations[0].projects.length) {
      this.doSetProjectName(v.configurations[0].projects[0].name);
    } else {
      this.doSetProjectName('No project');
    }
  }

  async asyncDispose() {
    if (this._cmsClient) {
      await(await this._cmsClient).shutdown();
    }
  }

  async cleanConfigure(consumer?: proc.OutputConsumer) {
    const old_cl = await this._cmsClient;
    this._cmsClient = (async() => {
      // Stop the server before we try to rip out any old files
      await old_cl.shutdown();
      const build_dir = this.binaryDir;
      const cache = this.cachePath;
      const cmake_files = path.join(build_dir, 'CMakeFiles');
      if (await fs.exists(cache)) {
        log.info('Removing', cache);
        await fs.unlink(cache);
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
    const cl = await this._cmsClient;
    const sub = this.onMessage(msg => {
      if (consumer) {
        for (const line of msg.split('\n')) {
          consumer.output(line);
        }
      }
    });

    try {
      await cl.configure({ cacheArguments: args });
      await cl.compute();
      this._dirty = false;
    } catch (e) {
      if (e instanceof cms.ServerError) {
        log.error(`Error during CMake configure: ${e}`);
        return 1;
      } else {
        throw e;
      }
    } finally {
      sub.dispose();
    }
    this.codeModel = await cl.sendRequest('codemodel');
    return 0;
  }

  async doPreBuild(): Promise<boolean> {
    if (this._dirty) {
      const retc = await this.configure([]);
      if (retc !== 0) {
        return false;
      }
    }
    return true;
  }

  async doPostBuild(): Promise<boolean> {
    const cl = await this._cmsClient;
    this.codeModel = await cl.sendRequest('codemodel');
    return true;
  }

  get targets(): RichTarget[] {
    if (!this._codeModel) {
      return [];
    }
    const config = this._codeModel.configurations.find(conf => conf.name == this.currentBuildType);
    if (!config) {
      log.error(
          'Found no matching code model for the current build type. This shouldn\'t be possible');
      return [];
    }
    return config.projects
        .reduce<RichTarget[]>((acc, project) => acc.concat(
                                  project.targets.map(t => ({
                                                        type : 'rich' as 'rich',
                                                        name : t.name,
                                                        filepath : t.artifacts && t.artifacts.length
                                                            ? path.normalize(t.artifacts[0])
                                                            : 'Utility target',
                                                        targetType : t.type,
                                                      }))),
                              [ {
                                type : 'rich' as 'rich',
                                name : this.allTargetName,
                                filepath : 'A special target to build all available targets',
                                targetType : 'META',
                              } ]);
  }

  get executableTargets(): ExecutableTarget[] {
    return this.targets.filter(t => t.targetType === 'EXECUTABLE').map(t => ({
                                                                         name : t.name,
                                                                         path : t.filepath,
                                                                       }));
  }

  get generatorName(): string | null {
    return this._globalSettings ? this._globalSettings.generator : null;
  }

  private _dirty = true;
  markDirty() { this._dirty = true; }
  get needsReconfigure(): boolean { return this._dirty; }

  get cmakeCacheEntries(): Map<string, CacheEntryProperties> { return this._cacheEntries; }

  async setKit(kit: Kit): Promise<void> {
    log.debug('Setting new kit', kit.name);
    this._dirty = true;
    const need_clean = this._kitChangeNeedsClean(kit);
    await(await this._cmsClient).shutdown();
    if (need_clean) {
      log.debug('Wiping build directory');
      await fs.rmdir(this.binaryDir);
    }
    await this._setBaseKit(kit);
    await this._restartClient();
  }

  async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo | null> {
    if (!this.codeModel) {
      return null;
    }
    const config = this.codeModel.configurations.length === 1
        ? this.codeModel.configurations[0]
        : this.codeModel.configurations.find(c => c.name == this.currentBuildType);
    if (!config) {
      return null;
    }
    for (const project of config.projects) {
      for (const target of project.targets) {
        for (const group of target.fileGroups) {
          const found = group.sources.find(source => {
            const abs_source
                = path.isAbsolute(filepath) ? source : path.join(target.sourceDirectory, source);
            const abs_filepath
                = path.isAbsolute(filepath) ? filepath : path.join(this.sourceDir, filepath);
            return util.normalizePath(abs_source) === util.normalizePath(abs_filepath);
          });
          if (found) {
            const defs = (group.defines || []).map(util.parseCompileDefinition);
            const defs_o
                = defs.reduce((acc,
                               [ key, value ]) => { return Object.assign(acc, {[key] : value}); },
                              {});
            const includes = (group.includePath ||
                              []).map(p => ({path : p.path, isSystem : p.isSystem || false}));
            const flags = util.splitCommandLine(group.compileFlags);
            return {
              file : found,
              compileDefinitions : defs_o,
              compileFlags : flags,
              includeDirectories : includes,
            };
          }
        }
      }
    }
    return null;
  }

  private async _restartClient(): Promise<void> {
    this._cmsClient = this._doRestartClient();
    await this._cmsClient;
  }

  private async _doRestartClient(): Promise<cms.CMakeServerClient> {
    const old_client = this._cmsClient;
    if (old_client) {
      const cl = await old_client;
      await cl.shutdown();
    }
    return this._startNewClient();
  }

  private _startNewClient() {
    return cms.CMakeServerClient.start({
      binaryDir : this.binaryDir,
      sourceDir : this.sourceDir,
      cmakePath : config.cmakePath,
      environment : this._getKitEnvironmentVariablesObject(),
      onDirty : async() => { this._dirty = true },
      onMessage : async(msg) => { this._onMessageEmitter.fire(msg.message); },
      onProgress : async(_prog) => {},
      pickGenerator : () => this.getBestGenerator(),
    });
  }

  private _onMessageEmitter = new vscode.EventEmitter<string>();
  get onMessage() { return this._onMessageEmitter.event; }

  protected async _init(): Promise<void> {
    await super._init();
    await this._restartClient();
  }

  static async create(ctx: vscode.ExtensionContext): Promise<CMakeServerClientDriver> {
    const driver = new CMakeServerClientDriver(ctx);
    await driver._init();
    return driver;
  }
}