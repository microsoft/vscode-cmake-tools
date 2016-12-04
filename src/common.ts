import * as ajv from 'ajv';
import * as proc from 'child_process';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import * as async from './async';
import {config} from './config';
import * as ctest from './ctest';
import * as environment from './environment';
import * as status from './status';
import * as util from './util';
import {Maybe} from './util';

async function readWorkspaceCache(
    path: string, defaultContent: util.WorkspaceCache) {
  console.log(`Loading CMake Tools from ${path}`);
  try {
    if (await async.exists(path)) {
      const buf = await async.readFile(path);
      return JSON
          .parse(buf.toString(), (key: string, val) => {
            if (key === 'keywordSettings') {
              const acc = new Map<string, string>();
              for (const key in val) {
                acc.set(key, val[key]);
              }
              return acc;
            }
            return val;
          }) as util.WorkspaceCache;
    } else {
      return defaultContent;
    }
  } catch (err) {
    console.error('Error reading CMake Tools workspace cache', err);
    return defaultContent;
  }
}


function
writeWorkspaceCache(path: string, content: util.WorkspaceCache) {
  return util.writeFile(path, JSON.stringify(content, (key, value) => {
    if (key === 'keywordSettings' && value instanceof Map) {
      return Array.from((value as Map<string, string>).entries())
          .reduce((acc, el) => {
            acc[el[0]] = el[1];
            return acc;
          }, {});
    }
    return value;
  }, 2));
}

class ThrottledOutputChannel implements vscode.OutputChannel {
  private _channel: vscode.OutputChannel;
  private _accumulatedData: string;
  private _throttler: async.Throttler<void>;

  constructor(name: string) {
    this._channel = vscode.window.createOutputChannel(name);
    this._accumulatedData = '';
    this._throttler = new async.Throttler();
  }

  get name(): string {
    return this._channel.name;
  }

  dispose(): void {
    this._accumulatedData = '';
    this._channel.dispose();
  }

  append(value: string): void {
    this._accumulatedData += value;
    this._throttler.queue(() => {
      if (this._accumulatedData) {
        const data = this._accumulatedData;
        this._accumulatedData = '';
        this._channel.append(data);
      }
      return Promise.resolve();
    });
  }

  appendLine(value: string): void {
    this.append(value + '\n');
  }

  clear(): void {
    this._accumulatedData = '';
    this._channel.clear();
  }

  show(columnOrPreserveFocus?, preserveFocus?): void {
    this._channel.show(columnOrPreserveFocus, preserveFocus);
  }

  hide(): void {
    this._channel.hide();
  }
}


export abstract class CommonCMakeToolsBase {
  abstract cacheEntry(name: string): api.CacheEntry|null;
  abstract get needsReconfigure(): boolean;
  abstract get activeGenerator(): Maybe<string>;
  abstract get executableTargets(): api.ExecutableTarget[];
  abstract get targets(): api.Target[];
  abstract markDirty(): void;

  protected _disposables: vscode.Disposable[] = [];
  protected readonly _statusBar = new status.StatusBar();
  protected readonly _diagnostics =
      vscode.languages.createDiagnosticCollection('cmake-build-diags');
  protected readonly _failingTestDecorationType =
      vscode.window.createTextEditorDecorationType({
        borderColor: 'rgba(255, 0, 0, 0.2)',
        borderWidth: '1px',
        borderRadius: '3px',
        borderStyle: 'solid',
        cursor: 'pointer',
        backgroundColor: 'rgba(255, 0, 0, 0.1)',
        overviewRulerColor: 'red',
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        after: {
          contentText: 'Failed',
          backgroundColor: 'darkred',
          margin: '10px',
        },
      });

  protected readonly _channel = new ThrottledOutputChannel('CMake/Build');
  protected readonly _ctestChannel =
      new ThrottledOutputChannel('CTest Results');

  private readonly _workspaceCachePath = path.join(
      vscode.workspace.rootPath || '~', '.vscode', '.cmaketools.json');

  protected _workspaceCacheContent: util.WorkspaceCache = {};

  protected _writeWorkspaceCacheContent() {
    return writeWorkspaceCache(
        this._workspaceCachePath, this._workspaceCacheContent);
  }

  constructor(protected readonly _context: vscode.ExtensionContext) {}

  private _availableEnvironments = new Map<string, environment.Environment>();
  public get availableEnvironments(): Map<string, environment.Environment> {
    return this._availableEnvironments;
  }

  /**
   * The environments (by name) which are currently active in the workspace
   */
  public activeEnvironments: string[] = [];
  public activateEnvironments(...names: string[]) {
    for (const name of names) {
      const env = this.availableEnvironments.get(name);
      if (!env) {
        const msg = `Invalid build environment named ${name}`;
        vscode.window.showErrorMessage(msg);
        console.error(msg);
        continue;
      }
      for (const other of this.availableEnvironments.values()) {
        if (other.mutex === env.mutex && env.mutex !== undefined) {
          const other_idx = this.activeEnvironments.indexOf(other.name);
          if (other_idx >= 0) {
            this.activeEnvironments.splice(other_idx, 1);
          }
        }
      }
      this.activeEnvironments.push(name);
    }
    this._statusBar.activeEnvironments = this.activeEnvironments;
    this._workspaceCacheContent.activeEnvironments = this.activeEnvironments;
    this._writeWorkspaceCacheContent();
  }

  public deactivateEnvironment(name: string): Promise<void> {
    const idx = this.activeEnvironments.indexOf(name);
    if (idx >= 0) {
      this.activeEnvironments.splice(idx, 1);
      this._statusBar.activeEnvironments = this.activeEnvironments;
      this._workspaceCacheContent.activeEnvironments = this.activeEnvironments;
      return this._writeWorkspaceCacheContent();
    } else {
      throw new Error(`Attempted to deactivate environment ${name
                      } which is not yet active!`);
    }
  }

  public async selectEnvironments(): Promise<void> {
    const entries =
        Array.from(this.availableEnvironments.keys())
            .map(name => ({
                   name: name,
                   label: this.activeEnvironments.indexOf(name) >= 0 ?
                       `$(check) ${name}` :
                       name,
                   description: '',
                 }));
    const chosen = await vscode.window.showQuickPick(entries);
    if (!chosen) {
      return;
    }
    this.activeEnvironments.indexOf(chosen.name) >= 0 ?
        this.deactivateEnvironment(chosen.name) :
        this.activateEnvironments(chosen.name);
  }

  /**
   * @brief The current environment variables to use when executing commands,
   *    as specified by the active build environments.
   */
  public get currentEnvironmentVariables(): {[key: string]: string} {
    const active_env = this.activeEnvironments.reduce<Object>((acc, name) => {
      const env_ = this.availableEnvironments.get(name);
      console.assert(env_);
      const env = env_!;
      for (const entry of env.variables.entries()) {
        acc[entry[0]] = entry[1];
      }
      return acc;
    }, {});
    const proc_env = process.env;
    if (process.platform == 'win32') {
      // Env vars on windows are case insensitive, so we take the ones from
      // active env and overwrite the ones in our current process env
      const norm_active_env = Object.getOwnPropertyNames(active_env)
                                  .reduce<Object>((acc, key: string) => {
                                    acc[key.toUpperCase()] = active_env[key];
                                    return acc;
                                  }, {});
      const norm_proc_env = Object.getOwnPropertyNames(proc_env).reduce<Object>(
          (acc, key: string) => {
            acc[key.toUpperCase()] = proc_env[key];
            return acc;
          },
          {});
      return Object.assign({}, norm_proc_env, norm_active_env);
    } else {
      return Object.assign({}, proc_env, active_env);
    }
  }

  public get projectName(): string {
    const entry = this.cacheEntry('CMAKE_PROJECT_NAME');
    if (!entry) {
      return 'Unconfigured';
    }
    return entry.as<string>();
  }

  /**
   * @brief Performs asynchronous extension initialization
   */
  protected async _init(): Promise<CommonCMakeToolsBase> {
    // Start loading up available environments early, this may take a few
    // seconds
    const env_promises = environment.availableEnvironments().map(async(pr) => {
      try {
        const env = await pr;
        if (env.variables) {
          console.log(`Detected available environment "${env.name}`);
          this._availableEnvironments.set(env.name, {
            name: env.name,
            variables: env.variables,
            mutex: env.mutex,
          });
        }
      } catch (e) {
        console.error('Error detecting an environment', e);
      }
    });

    this._statusBar.targetName = this.defaultBuildTarget;

    async.exists(this.mainListFile).then(e => this._statusBar.visible = e);

    this._workspaceCacheContent = await readWorkspaceCache(
        this._workspaceCachePath, {variant: null, activeEnvironments: []});

    if (this._workspaceCacheContent.variant) {
      this.activeVariantCombination = this._workspaceCacheContent.variant;
    }

    const variants_watcher = vscode.workspace.createFileSystemWatcher(
        path.join(vscode.workspace.rootPath, 'cmake-variants.*'));
    this._disposables.push(variants_watcher);
    variants_watcher.onDidChange(this._reloadVariants.bind(this));
    variants_watcher.onDidCreate(this._reloadVariants.bind(this));
    variants_watcher.onDidDelete(this._reloadVariants.bind(this));
    await this._reloadVariants();

    await Promise.all(env_promises);
    this._statusBar.environmentsAvailable =
        this.availableEnvironments.size !== 0;

    const envs = this._workspaceCacheContent.activeEnvironments || [];
    for (const e of envs) {
      if (this.availableEnvironments.has(e)) {
        this.activateEnvironments(e);
      }
    }

    if (this.isMultiConf && config.buildDirectory.includes('${buildType}')) {
      vscode.window.showWarningMessage(
          'It is not advised to use ${buildType} in the cmake.buildDirectory settings when the generator supports multiple build configurations.');
    }
    return this;
  }

  dispose() {
    this._disposables.map(d => d.dispose());
  }

  /**
   * @brief The currently executing child process.
   */
  private _currentChildProcess: Maybe<proc.ChildProcess> = null;
  public get currentChildProcess(): Maybe<proc.ChildProcess> {
    return this._currentChildProcess;
  }
  public set currentChildProcess(v: Maybe<proc.ChildProcess>) {
    this._currentChildProcess = v;
    this._statusBar.isBusy = v !== null;
  }

  /**
   * @brief A property that determines whether we are currently running a job
   * or not.
   */
  public get isBusy(): boolean {
    return !!this.currentChildProcess;
  }

  /**
   * @brief The status message for the status bar.
   *
   * When this value is changed, we update our status bar item to show the
   * statusMessage. This could be something like 'Configuring...',
   * 'Building...' etc.
   */
  public get statusMessage(): string {
    return this._statusBar.statusMessage;
  }
  public set statusMessage(v: string) {
    this._statusBar.statusMessage = v;
  }

  /**
   * @brief Determine if the project is using a multi-config generator
   */
  public get isMultiConf(): boolean {
    const gen = this.activeGenerator;
    return !!gen && util.isMultiConfGenerator(gen);
  }

  public showTargetSelector(): Thenable<string> {
    return this.targets.length ?
        vscode.window.showQuickPick(this.targets.map(t => t.name)) :
        vscode.window.showInputBox({prompt: 'Enter a target name'});
  }

  /**
   * @brief Refreshes the content of the status bar items.
   *
   * This only changes the visible content, and doesn't manipulate the state
   * of the extension.
   */
  private _refreshStatusBarItems() {
    this._statusBar.statusMessage = this.statusMessage;
    this._statusBar.projectName = this.projectName;
    this._statusBar.isBusy = this.isBusy;
    this._statusBar.progress = this.buildProgress;
    this._statusBar.targetName = this.defaultBuildTarget;
    this._statusBar.buildTypeLabel = this.activeVariantCombination.label;
    this._statusBar.debugTargetName = this.currentDebugTarget || '';

    this._statusBar.targetName = this.defaultBuildTarget || this.allTargetName;

    this._statusBar.environmentsAvailable =
        this.availableEnvironments.size !== 0;
    this._statusBar.activeEnvironments = this.activeEnvironments;
  }

  /**
   * @brief Get the name of the "all" target
   */
  public get allTargetName() {
    const gen = this.activeGenerator;
    return (gen && /Visual Studio/.test(gen)) ? 'ALL_BUILD' : 'all';
  }

  /**
   * @brief Called to reload the contents of cmake-variants.json
   */
  protected async _reloadVariants() {
    const schema_path =
        this._context.asAbsolutePath('schemas/variants-schema.json');
    const schema = JSON.parse((await async.readFile(schema_path)).toString());
    const validate = new ajv({
                       allErrors: true,
                       format: 'full',
                     }).compile(schema);

    const workdir = vscode.workspace.rootPath;
    const yaml_file = path.join(workdir, 'cmake-variants.yaml');
    const json_file = path.join(workdir, 'cmake-variants.json');
    let variants: any;
    if (await async.exists(yaml_file)) {
      const content = (await async.readFile(yaml_file)).toString();
      try {
        variants = yaml.load(content);
      } catch (e) {
        vscode.window.showErrorMessage(
            `${yaml_file} is syntactically invalid.`);
        variants = config.defaultVariants;
      }
    } else if (await async.exists(json_file)) {
      const content = (await async.readFile(json_file)).toString();
      try {
        variants = JSON.parse(content);
      } catch (e) {
        vscode.window.showErrorMessage(
            `${json_file} is syntactically invalid.`);
        variants = config.defaultVariants;
      }
    } else {
      variants = config.defaultVariants;
    }
    const validated = validate(variants);
    if (!validated) {
      const errors = validate.errors as ajv.ErrorObject[];
      const error_strings =
          errors.map(err => `${err.dataPath}: ${err.message}`);
      vscode.window.showErrorMessage(
          `Invalid cmake-variants: ${error_strings.join('; ')}`);
      variants = config.defaultVariants;
    }
    const sets = new Map() as util.VariantSet;
    for (const key in variants) {
      const sub = variants[key];
      const def = sub['default$'];
      const desc = sub['description$'];
      const choices = new Map<string, util.VariantConfigurationOptions>();
      for (const name in sub) {
        if (!name || ['default$', 'description$'].indexOf(name) !== -1) {
          continue;
        }
        const settings = sub[name] as util.VariantConfigurationOptions;
        choices.set(name, settings);
      }
      sets.set(key, {description: desc, default: def, choices: choices});
    }
    this.buildVariants = sets;
  }

  private _buildVariants: util.VariantSet;
  public get buildVariants(): util.VariantSet {
    return this._buildVariants;
  }
  public set buildVariants(v: util.VariantSet) {
    const before = this.activeVariant;
    this._buildVariants = v;
    if (JSON.stringify(this.activeVariant) !== JSON.stringify(before)) {
      this.markDirty();
    }
  }


  /**
   * @brief The active variant combination
   */
  private _activeVariantCombination: util.VariantCombination;
  public get activeVariantCombination(): util.VariantCombination {
    return this._activeVariantCombination;
  }
  public set activeVariantCombination(v: util.VariantCombination) {
    this._activeVariantCombination = v;
    this._workspaceCacheContent.variant = v;
    this._writeWorkspaceCacheContent();
    this._statusBar.buildTypeLabel = v.label;
  }

  /**
   * Get the configuration options associated with the active build variant
   */
  public get activeVariant(): util.VariantConfigurationOptions {
    const vari = this._workspaceCacheContent.variant;
    if (!vari) {
      return {};
    }
    const kws = vari.keywordSettings;
    if (!kws) {
      return {};
    }
    const vars = this.buildVariants;
    if (!vars) {
      return {};
    }
    const data = Array.from(kws.entries()).map(([param, setting]) => {
      if (!vars.has(param)) {
        debugger;
        throw 12;
      }
      const choices = vars.get(param)!.choices;
      if (!choices.has(setting)) {
        debugger;
        throw 12;
      }
      return choices.get(setting)!;
    });
    const result: util.VariantConfigurationOptions = data.reduce(
        (acc, el) => ({
          buildType: el.buildType || acc.buildType,
          generator: el.generator || acc.generator,
          linkage: el.linkage || acc.linkage,
          toolset: el.toolset || acc.toolset,
          settings: Object.assign(acc.settings || {}, el.settings || {})
        }),
        {});
    return result;
  }

  private _generateVariantLabel(settings: api.VariantKeywordSettings): string {
    return Array.from(this.buildVariants.entries())
        .map(([key,
               values]) => values.choices.get(settings[key])!.oneWordSummary$)
        .join('+');
  }

  private _generateVariantDescription(settings: api.VariantKeywordSettings):
      string {
    return Array.from(this.buildVariants.entries())
        .map(([key, values]) => values.choices.get(settings[key])!.description$)
        .join(' + ');
  }

  async setActiveVariantCombination(settings: api.VariantKeywordSettings) {
    const v = this._activeVariantCombination = {
      label: this._generateVariantLabel(settings),
      description: this._generateVariantDescription(settings),
      keywordSettings: Object.keys(settings).reduce<Map<string, string>>(
          (acc, key) => {
            acc.set(key, settings[key]);
            return acc;
          },
          new Map<string, string>()),
    };
    this._workspaceCacheContent.variant = v;
    this._statusBar.buildTypeLabel = v.label;
    await this._writeWorkspaceCacheContent();
  }

  /**
   * @brief The build type (configuration) which the user has most recently
   * selected.
   *
   * The build type is passed to CMake when configuring and building the
   * project. For multiconf generators, such as visual studio with msbuild,
   * the build type is not determined at configuration time. We need to store
   * the build type that the user wishes to use here so that when a user
   * invokes cmake.build, we will be able to build with the desired
   * configuration. This value is also reflected on the status bar item that
   * the user can click to change the build type.
   */
  public get selectedBuildType(): Maybe<string> {
    const cached = this.activeVariant.buildType;
    return cached ? cached : null;
  }

  public replaceVars(str: string): string {
    const replacements = [
      ['${buildType}', this.selectedBuildType || 'Unknown'],
      ['${workspaceRoot}', vscode.workspace.rootPath],
      [
        '${workspaceRootFolderName}', path.basename(vscode.workspace.rootPath)
      ]
    ] as [string, string][];
    return replacements.reduce(
        (accdir, [needle, what]) => util.replaceAll(accdir, needle, what),
        str, );
  }

  /**
   * @brief Read the source directory from the config
   */
  public get sourceDir(): string {
    const dir = this.replaceVars(config.sourceDirectory);
    return util.normalizePath(dir);
  }

  /**
   * @brief Get the path to the root CMakeLists.txt
   */
  public get mainListFile(): string {
    const listfile = path.join(this.sourceDir, 'CMakeLists.txt');
    return util.normalizePath(listfile);
  }

  /**
   * @brief Get the path to the binary dir
   */
  public get binaryDir(): string {
    const dir = this.replaceVars(config.buildDirectory);
    return util.normalizePath(dir, false);
  }

  /**
   * @brief Get the path to the CMakeCache file in the build directory
   */
  public get cachePath(): string {
    const file = path.join(this.binaryDir, 'CMakeCache.txt');
    return util.normalizePath(file);
  }

  private _tests: api.Test[] = [];
  public get tests(): api.Test[] {
    return this._tests;
  }
  public set tests(v: api.Test[]) {
    this._tests = v;
    this._refreshTestResultsStatus();
  }

  private _testResults: Maybe<ctest.Results>;
  public get testResults(): Maybe<ctest.Results> {
    return this._testResults;
  }
  public set testResults(v: Maybe<ctest.Results>) {
    this._testResults = v;
    this._refreshTestResultsStatus
  }

  private _refreshTestResultsStatus() {
    const total = this.tests.length;
    if (this.testResults) {
      const passing = this.testResults.Site.Testing.Test.reduce(
          (acc, test) => acc + (test.Status !== 'failed' ? 1 : 0), 0);
      this._statusBar.testResults = {passing, total};
    }
  }

  /**
   * @brief The default target to build when no target is specified
   */
  private _defaultBuildTarget: string = 'all';
  public get defaultBuildTarget(): string {
    return this._defaultBuildTarget;
  }
  public set defaultBuildTarget(v: string) {
    this._defaultBuildTarget = v;
    this._statusBar.targetName = v;
  }

  /**
   * The progress of the currently running task
   */
  private _buildProgress: Maybe<number> = null;
  public get buildProgress(): Maybe<number> {
    return this._buildProgress;
  }
  public set buildProgress(v: Maybe<number>) {
    this._buildProgress = v;
    this._statusBar.progress = v;
  }

  /**
   * The selected target for debugging
   */
  private _currentDebugTarget: Maybe<string> = null;
  public get currentDebugTarget(): Maybe<string> {
    return this._currentDebugTarget;
  }
  public set currentDebugTarget(v: Maybe<string>) {
    this._currentDebugTarget = v;
    this._statusBar.debugTargetName = v || '';
  }
}