'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

import * as api from './api';
import * as diagnostics from './diagnostics';
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
  private _cacheEntries = new Map<string, cache.Entry>();
  private _accumulatedMessages: string[] = [];
  private _codeModel: null|cms.CodeModelContent;

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
    for (const lang of ['CXX', 'C']) {
      const entry = this.cacheEntry(`CMAKE_${lang}_COMPILER`);
      if (!entry) {
        continue;
      }
      const compiler = entry.as<string>();
      if (compiler.endsWith('cl.exe')) {
        return 'MSVC';
      } else if (/g(cc|++)[^/]*/.test(compiler)) {
        return 'GNU';
      } else if (/clang(++)?[^/]*/.test(compiler)) {
        return 'Clang';
      }
    }
    return null;
  }

  get needsReconfigure() {
    return this._dirty;
  }

  get activeGenerator() {
    return this._globalSettings ? this._globalSettings.generator : null;
  }

  cacheEntry(key: string) {
    return this._cacheEntries.get(key) || null;
  }

  async dangerousShutdownClient() {
    await this._client.shutdown();
  }

  async dangerousRestartClient() {
    await this._restartClient();
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

  async compilationInfoForFile(filepath: string):
      Promise<api.CompilationInfo|null> {
    if (!this._codeModel) {
      return null;
    }
    const config = this._codeModel.configurations.length == 1 ?
        this._codeModel.configurations[0] :
        this._codeModel.configurations.find(
            c => c.name == this.selectedBuildType);
    if (!config) {
      return null;
    }
    for (const project of config.projects) {
      for (const target of project.targets) {
        for (const group of target.fileGroups) {
          const found = group.sources.find(source => {
            const abs_source = path.isAbsolute(source) ?
                source :
                path.join(target.sourceDirectory, source);
            const abs_filepath = path.isAbsolute(filepath) ?
                filepath :
                path.join(this.sourceDir, filepath);
            return util.normalizePath(abs_source) ==
                util.normalizePath(abs_filepath);
          });
          if (found) {
            const defs = (group.defines || []).map(util.parseCompileDefinition);
            const defs_o = defs.reduce((acc, el) => {
              acc[el[0]] = el[1];
              return acc;
            }, {});
            return {
              file: found,
              compileDefinitions: defs_o,
              compileFlags: util.splitCommandLine(group.compileFlags),
              includeDirectories:
                  (group.includePath ||
                   [
                   ]).map(p => ({path: p.path, isSystem: p.isSystem || false})),
            };
          }
        }
      }
    }
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
    const parser = new diagnostics.BuildParser(
        this.binaryDir, ['cmake'], this.activeGenerator);
    const parseMessages = () => {
      for (const msg of this._accumulatedMessages) {
        const lines = msg.split('\n');
        for (const line of lines) {
          parser.parseLine(line);
        }
      }
      parser.fillDiagnosticCollection(this._diagnostics);
    };
    try {
      this._accumulatedMessages = [];
      await this._client.configure(
          {cacheArguments: ['-C', init_cache_path].concat(extraArgs)});
      await this._client.compute();
      parseMessages();
    } catch (e) {
      if (e instanceof cms.ServerError) {
        parseMessages();
        this._channel.appendLine(`[vscode] Configure failed: ${e}`);
        return 1;
      } else {
        throw e;
      }
    }
    this._workspaceCacheContent.codeModel =
        await this._client.sendRequest('codemodel');
    await this._writeWorkspaceCacheContent();
    await this._refreshAfterConfigure();
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

  async build(target?: string|null) {
    const retc = await super.build(target);
    if (retc >= 0) {
      await this._refreshAfterConfigure();
    }
    return retc;
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
        (acc, project) => acc.concat(project.targets.map(
            t => ({
              type: 'rich' as 'rich',
              name: t.name,
              filepath: path.join(t.buildDirectory, t.fullName),
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
        const line = `-- ${msg.message}`;
        this._accumulatedMessages.push(line);
        this._channel.appendLine(line);
      },
      onProgress: async(prog) => {
        this.buildProgress = (prog.progressCurrent - prog.progressMinimum) /
            (prog.progressMaximum - prog.progressMinimum);
        this.statusMessage = prog.progressMessage;
      },
    });
  }

  protected async _refreshAfterConfigure() {
    return Promise.all([this._refreshCacheEntries(), this._refreshCodeModel()]);
  }

  private async _refreshCodeModel() {
    this._codeModel = await this._client.codemodel();
    this._workspaceCacheContent.codeModel = this._codeModel;
    await this._writeWorkspaceCacheContent();
  }

  private async _refreshCacheEntries() {
    const clcache = await this._client.getCMakeCacheContent();
    return this._cacheEntries = clcache.cache.reduce((acc, el) => {
      const type: api.EntryType = {
        BOOL: api.EntryType.Bool,
        STRING: api.EntryType.String,
        PATH: api.EntryType.Path,
        FILEPATH: api.EntryType.FilePath,
        INTERNAL: api.EntryType.Internal,
        UNINITIALIZED: api.EntryType.Uninitialized,
        STATIC: api.EntryType.Static,
      }[el.type];
      console.assert(type !== undefined, `Unknown cache type ${el.type}`);
      acc.set(
          el.key,
          new cache.Entry(el.key, el.value, type, el.properties.HELPSTRING));
      return acc;
    }, new Map<string, cache.Entry>());
  }

  protected async _init(): Promise<ServerClientCMakeTools> {
    await super._init();
    const cl = this._client = await this._restartClient();
    this._globalSettings = await cl.getGlobalSettings();
    this._codeModel = this._workspaceCacheContent.codeModel || null;
    this._statusBar.statusMessage = 'Ready';
    this._statusBar.isBusy = false;
    if (this.executableTargets.length > 0) {
      this.currentDebugTarget = this.executableTargets[0].name;
    }
    try {
      await this._refreshAfterConfigure();
    } catch (e) {
      if (e instanceof cms.ServerError) {
        // Do nothing
      } else {
        throw e;
      }
    }
    return this;
  }

  static startup(ct: vscode.ExtensionContext): Promise<ServerClientCMakeTools> {
    const cmt = new ServerClientCMakeTools(ct);
    cmt._statusBar.statusMessage = 'Ready';
    return cmt._init();
  }
}