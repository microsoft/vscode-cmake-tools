import * as api from '@cmt/api';
import {ConfigureTrigger} from '@cmt/cmake-tools';
import {ExecutableTarget} from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
import {ConfigurationReader} from '@cmt/config';
import * as index_api from '@cmt/drivers/cmakefileapi/api';
import {
  createQueryFileForApi,
  loadCacheContent,
  loadConfigurationTargetMap,
  loadExtCodeModelContent,
  loadIndexFile,
  loadToolchains
} from '@cmt/drivers/cmakefileapi/api_helpers';
import * as codemodel from '@cmt/drivers/codemodel-driver-interface';
import {CMakeDriver, CMakePreconditionProblemSolver} from '@cmt/drivers/driver';
import {CMakeGenerator, Kit} from '@cmt/kit';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import * as proc from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ext from '@cmt/extension';
import { BuildPreset, ConfigurePreset, TestPreset } from '@cmt/preset';

import {NoGeneratorError} from './cms-driver';

import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cmakefileapi-driver');
/**
 * The CMake driver with FileApi of CMake >= 3.15.0
 */
export class CMakeFileApiDriver extends CMakeDriver {

  get isCacheConfigSupported(): boolean {
    return fs.existsSync(this.getCMakeFileApiPath());
  }

  private constructor(cmake: CMakeExecutable,
                      readonly config: ConfigurationReader,
                      workspaceRootPath: string|null,
                      preconditionHandler: CMakePreconditionProblemSolver) {
    super(cmake, config, workspaceRootPath, preconditionHandler);
  }

  static async create(cmake: CMakeExecutable,
                      config: ConfigurationReader,
                      useCMakePresets: boolean,
                      kit: Kit|null,
                      configurePreset: ConfigurePreset | null,
                      buildPreset: BuildPreset | null,
                      testPreset: TestPreset | null,
                      workspaceRootPath: string|null,
                      preconditionHandler: CMakePreconditionProblemSolver,
                      preferredGenerators: CMakeGenerator[]): Promise<CMakeFileApiDriver> {
    log.debug('Creating instance of CMakeFileApiDriver');
    return this.createDerived(new CMakeFileApiDriver(cmake, config, workspaceRootPath, preconditionHandler),
                              useCMakePresets,
                              kit,
                              configurePreset,
                              buildPreset,
                              testPreset,
                              preferredGenerators);
  }

  private _needsReconfigure = true;

  /**
   * Watcher for the CMake cache file on disk.
   */
  private readonly _cacheWatcher = vscode.workspace.createFileSystemWatcher(this.cachePath);

  // Information from cmake file api
  private _cache: Map<string, api.CacheEntry> = new Map<string, api.CacheEntry>();
  private _generatorInformation: index_api.Index.GeneratorInformation|null = null;
  private _target_map: Map<string, api.Target[]> = new Map();

  async getGeneratorFromCache(cache_file_path: string): Promise<string> {
    const cache = await CMakeCache.fromPath(cache_file_path);

    return cache.get('CMAKE_GENERATOR')!.value;
  }

  async loadGeneratorInformationFromCache(cache_file_path: string) {
    const cache = await CMakeCache.fromPath(cache_file_path);

    this._generator = {
      name: cache.get('CMAKE_GENERATOR')!.value,
      platform: cache.get('CMAKE_GENERATOR_PLATFORM') ? cache.get('CMAKE_GENERATOR_PLATFORM')!.value : undefined,
      toolset: cache.get('CMAKE_GENERATOR_TOOLSET') ? cache.get('CMAKE_GENERATOR_TOOLSET')!.value : undefined
    } as CMakeGenerator;

    this._generatorInformation = {
      name: cache.get('CMAKE_GENERATOR')!.value,
      platform: cache.get('CMAKE_GENERATOR_PLATFORM') ? cache.get('CMAKE_GENERATOR_PLATFORM')!.value : undefined
    };
  }

  async doInit() {
    // The seems to be a difference between server mode and fileapi on load of a existing project
    // If the existing project is not generated by the IDE then the fileapi queries are missing.
    // but the generator information are needed to get the code model, cache and cmake files.
    // This workaround load the information from cache.
    // Make an exception when the current deduced generator differs from the one saved in cache.
    // We need to treat this case as if the cache is not present and let a reconfigure
    // refresh the cache information.
    const cacheExists: boolean = await fs.exists(this.cachePath);
    if (cacheExists && this.generator?.name === await this.getGeneratorFromCache(this.cachePath)) {
      await this.loadGeneratorInformationFromCache(this.cachePath);
      const code_model_exist = await this.updateCodeModel();
      if (!code_model_exist) {
        await this.doConfigure([], undefined);
      }
    } else {
      if (cacheExists) {
        // No need to remove the other CMake files for the generator change to work properly
        log.info(localize('removing', 'Removing {0}', this.cachePath));
        await fs.unlink(this.cachePath);
      }

      this._generatorInformation = this.generator;
    }
    if (!this.generator && !this.useCMakePresets) {
      throw new NoGeneratorError();
    }

    this._cacheWatcher.onDidChange(() => {
      log.debug(`Reload CMake cache: ${this.cachePath} changed`);
      rollbar.invokeAsync('Reloading CMake Cache', () => this.updateCodeModel());
    });

    this.config.onChange('sourceDirectory', async () => {
      // The configure process can determine correctly whether the features set activation
      // should be full or partial, so there is no need to proactively enable full here,
      // unless the automatic configure is disabled.
      // If there is a configure or a build in progress, we should avoid setting full activation here,
      // even if cmake.configureOnEdit is true, because this may overwrite a different decision
      // that was done earlier by that ongoing configure process.
      if (!this.configOrBuildInProgress()) {
        if (this.config.configureOnEdit) {
          log.debug(localize('cmakelists.save.trigger.reconfigure', "Detected 'cmake.sourceDirectory' setting update, attempting automatic reconfigure..."));
          await this.configure(ConfigureTrigger.sourceDirectoryChange, []);
        }

        // Evaluate for this folder (whose sourceDirectory setting just changed)
        // if the new value points to a valid CMakeLists.txt.
        if (this.workspaceFolder) {
          const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.workspaceFolder));
          if (folder) {
            await ext.updateFullFeatureSetForFolder(folder);
          }
        }
      }
    });
  }

  doConfigureSettingsChange() { this._needsReconfigure = true; }
  async checkNeedsReconfigure(): Promise<boolean> { return this._needsReconfigure; }

  async doSetKit(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
    this._needsReconfigure = true;
    if (need_clean) {
      await this._cleanPriorConfiguration();
    }
    await cb();
    if (!this.generator) {
      throw new NoGeneratorError();
    }
  }

  async doSetConfigurePreset(need_clean: boolean, cb: () => Promise<void>): Promise<void> {
    this._needsReconfigure = true;
    if (need_clean) {
      await this._cleanPriorConfiguration();
    }
    await cb();
    if (!this.generator) {
      throw new NoGeneratorError();
    }
  }

  doSetBuildPreset(cb: () => Promise<void>): Promise<void> {
    return cb();
  }

  doSetTestPreset(cb: () => Promise<void>): Promise<void> {
    return cb();
  }

  async asyncDispose() {
    this._codeModelChanged.dispose();
    this._cacheWatcher.dispose();
  }

  protected async doPreCleanConfigure(): Promise<void> {
    await this._cleanPriorConfiguration();
  }

  async doCacheConfigure(): Promise<number> {
    this._needsReconfigure = true;
    await this.updateCodeModel();
    return 0;
  }

  async doConfigure(args_: string[], outputConsumer?: proc.OutputConsumer, showCommandOnly?: boolean): Promise<number> {
    const api_path = this.getCMakeFileApiPath();
    await createQueryFileForApi(api_path);

    // Dup args so we can modify them
    const args = Array.from(args_);
    args.push(`-H${util.lightNormalizePath(this.sourceDir)}`);
    const bindir = util.lightNormalizePath(this.binaryDir);
    args.push(`-B${bindir}`);
    const gen = this.generator;
    let has_gen = false;
    for (const arg of args) {
      if (arg.startsWith("-DCMAKE_GENERATOR:STRING=")) {
        has_gen = true;
      }
    }
    if (!has_gen && gen) {
      args.push('-G');
      args.push(gen.name);
      if (gen.toolset) {
        args.push('-T');
        args.push(gen.toolset);
      }
      if (gen.platform) {
        args.push('-A');
        args.push(gen.platform);
      }
    }
    const cmake = this.cmake.path;
    if (showCommandOnly) {
      log.showChannel();
      log.info(proc.buildCmdStr(this.cmake.path, args));
      return 0;
    } else {
      log.debug(`Configuring using ${this.useCMakePresets ? 'preset' : 'kit'}`);
      log.debug('Invoking CMake', cmake, 'with arguments', JSON.stringify(args));
      const env = await this.getConfigureEnvironment();
      const res = await this.executeCommand(cmake, args, outputConsumer, {environment: env}).result;
      log.trace(res.stderr);
      log.trace(res.stdout);
      if (res.retc === 0) {
        this._needsReconfigure = false;
        await this.updateCodeModel();
      }
      return res.retc === null ? -1 : res.retc;
    }
  }

  async doPostBuild(): Promise<boolean> {
    await this.updateCodeModel();
    return true;
  }

  private getCMakeFileApiPath() { return path.join(this.binaryDir, '.cmake', 'api', 'v1'); }
  private getCMakeReplyPath() {
    const api_path = this.getCMakeFileApiPath();
    return path.join(api_path, 'reply');
  }

  private toolchainWarningProvided: boolean = false;
  private async updateCodeModel(): Promise<boolean> {
    const reply_path = this.getCMakeReplyPath();
    const indexFile = await loadIndexFile(reply_path);
    if (indexFile) {
      this._generatorInformation = indexFile.cmake.generator;

      // load cache
      const cache_obj = indexFile.objects.find((value: index_api.Index.ObjectKind) => value.kind === 'cache');
      if (!cache_obj) {
        throw Error('No cache object found');
      }

      this._cache = await loadCacheContent(path.join(reply_path, cache_obj.jsonFile));

      // load targets
      const codemodel_obj = indexFile.objects.find((value: index_api.Index.ObjectKind) => value.kind === 'codemodel');
      if (!codemodel_obj) {
        throw Error('No code model object found');
      }
      this._target_map = await loadConfigurationTargetMap(reply_path, codemodel_obj.jsonFile);
      this._codeModelContent = await loadExtCodeModelContent(reply_path, codemodel_obj.jsonFile);

      // load toolchains
      const toolchains_obj = indexFile.objects.find((value: index_api.Index.ObjectKind) => value.kind === 'toolchains');

      // The "toolchains" object kind wasn't introduced until CMake 3.20, so
      // it's not fatal if it's missing in the response.
      if (!toolchains_obj) {
        if (!this.toolchainWarningProvided) {
          this.toolchainWarningProvided = true;
          log.info(localize(
            'toolchains.object.unsupported',
            'This version of CMake does not support the "toolchains" object kind. Compiler paths will be determined by reading CMakeCache.txt.'));
        }
      } else {
        this._codeModelContent.toolchains = await loadToolchains(path.join(reply_path, toolchains_obj.jsonFile));
      }

      this._codeModelChanged.fire(this._codeModelContent);
    }
    return indexFile !== null;
  }

  private _codeModelContent: codemodel.CodeModelContent|null = null;
  get codeModelContent() { return this._codeModelContent; }

  get cmakeCacheEntries(): Map<string, api.CacheEntryProperties> { return this._cache; }
  get generatorName(): string|null { return this._generatorInformation ? this._generatorInformation.name : null; }
  get targets(): api.Target[] {
    const targets = this._target_map.get(this.currentBuildType);
    if (targets) {
      const metaTargets = [{
        type: 'rich' as 'rich',
        name: this.allTargetName,
        filepath: 'A special target to build all available targets',
        targetType: 'META'
      }];
      return [...metaTargets, ...targets].filter((value, idx, self) => self.findIndex(e => value.name === e.name)
                                                     === idx);
    } else {
      return [];
    }
  }

  /**
   * List of unique targets known to CMake
   */
  get uniqueTargets(): api.Target[] { return this.targets.reduce(targetReducer, []); }

  get executableTargets(): ExecutableTarget[] {
    return this.uniqueTargets.filter(t => t.type === 'rich' && (t as api.RichTarget).targetType === 'EXECUTABLE')
        .map(t => ({
               name: t.name,
               path: (t as api.RichTarget).filepath
             }));
  }

  private readonly _codeModelChanged = new vscode.EventEmitter<null|codemodel.CodeModelContent>();
  get onCodeModelChanged() { return this._codeModelChanged.event; }
}

/**
 * Helper function for Array.reduce
 *
 * @param set the accumulator
 * @t the RichTarget currently being examined.
 */
function targetReducer(set: api.Target[], t: api.Target): api.Target[] {
  if (!set.find(t2 => compareTargets(t, t2))) {
    set.push(t);
  }
  return set;
}

function compareTargets(a: api.Target, b: api.Target): boolean {
  let same = false;
  if (a.type === b.type) {
    same = a.name === b.name;
    if (a.type === 'rich' && b.type === 'rich') {
      same = same && (a.filepath === b.filepath);
      same = same && (a.targetType === b.targetType);
    }
  }

  return same;
}
