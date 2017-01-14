import * as ajv from 'ajv';
import * as proc from 'child_process';
import * as yaml from 'js-yaml';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import * as async from './async';
import {config} from './config';
import * as ctest from './ctest';
import {BuildParser} from './diagnostics';
import * as environment from './environment';
import * as status from './status';
import * as util from './util';
import {Maybe} from './util';
import {VariantManager} from './variants';

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



export abstract class CommonCMakeToolsBase implements api.CMakeToolsAPI {
  abstract cacheEntry(name: string): api.CacheEntry|null;
  abstract get needsReconfigure(): boolean;
  abstract get activeGenerator(): Maybe<string>;
  abstract get executableTargets(): api.ExecutableTarget[];
  abstract get targets(): api.Target[];
  abstract get compilerId(): string|null;
  abstract markDirty(): void;
  abstract configure(extraArgs?: string[], runPrebuild?: boolean):
      Promise<number>;
  abstract compilationInfoForFile(filepath: string):
      Promise<api.CompilationInfo>;
  abstract cleanConfigure(): Promise<number>;
  abstract stop(): Promise<boolean>;
  abstract selectDebugTarget();

  protected _refreshAfterConfigure() {}

  /**
   * A list of all the disposables we keep track of
   */
  protected _disposables: vscode.Disposable[] = [];

  /**
   * The statusbar manager. Controls updating and refreshing the content of
   * the statusbar.
   */
  protected readonly _statusBar = new status.StatusBar();

  /**
   * The variant manager, controls and updates build variants
   */
  public readonly variants = new VariantManager(this._context);
  public setActiveVariantCombination(settings: api.VariantKeywordSettings) {
    return this.variants.setActiveVariantCombination(settings);
  }
  /**
   * ctestController manages running ctest and reportrs ctest results via an
   * event emitter.
   */
  protected _ctestController = new ctest.CTestController();
  public async ctest(): Promise<Number> {
    this._channel.show();
    const build_retc = await this.build();
    if (build_retc !== 0) {
      return build_retc;
    }
    return this._ctestController.executeCTest(
        this.binaryDir, this.selectedBuildType || 'Debug',
        this.executionEnvironmentVariables);
  }

  /**
   * Manages build environments
   */
  private readonly _environments = new environment.EnvironmentManager();
  public selectEnvironments() {
    return this._environments.selectEnvironments();
  }
  public get currentEnvironmentVariables() {
    return this._environments.currentEnvironmentVariables;
  }

  /**
   * The main diagnostic collection for this extension. Contains both build
   * errors and cmake diagnostics.
   */
  protected readonly _diagnostics =
      vscode.languages.createDiagnosticCollection('cmake-build-diags');
  public get diagnostics(): vscode.DiagnosticCollection {
    return this._diagnostics;
  }

  /**
   * The primary build output channel. We use the ThrottledOutputChannel because
   * large volumes of output can make VSCode choke
   */
  protected readonly _channel = new util.ThrottledOutputChannel('CMake/Build');

  /**
   * The workspace cache stores extension state that is convenient to remember
   * between executions. Things like the active variant or enabled environments
   * are stored here so that they may be recalled quickly upon extension
   * restart.
   */
  private readonly _workspaceCachePath = path.join(
      vscode.workspace.rootPath || '~', '.vscode', '.cmaketools.json');
  protected _workspaceCacheContent: util.WorkspaceCache = {};
  protected _writeWorkspaceCacheContent() {
    return writeWorkspaceCache(
        this._workspaceCachePath, this._workspaceCacheContent);
  }

  constructor(protected readonly _context: vscode.ExtensionContext) {
    // We want to rewrite our workspace cache and updare our statusbar whenever
    // the active build variant changes
    this.variants.onActiveVariantCombinationChanged(v => {
      this._workspaceCacheContent.variant = v;
      this._writeWorkspaceCacheContent();
      this._statusBar.buildTypeLabel = v.label;
    });
    // These events are simply to update the statusbar
    this._ctestController.onTestingEnabledChanged(enabled => {
      this._statusBar.ctestEnabled = enabled;
    });
    this._ctestController.onResultsChanged((res) => {
      if (res) {
        this._statusBar.haveTestResults = true;
        this._statusBar.testResults = res;
      } else {
        this._statusBar.haveTestResults = false;
      }
    });
    this._environments.onActiveEnvironmentsChanges(envs => {
      this._statusBar.activeEnvironments = envs;
      this._workspaceCacheContent.activeEnvironments = envs;
      this._writeWorkspaceCacheContent();
    });
    this._disposables.push(this._statusBar);
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
    this._statusBar.targetName = this.defaultBuildTarget;

    async.exists(this.mainListFile).then(e => this._statusBar.visible = e);

    this._workspaceCacheContent = await readWorkspaceCache(
        this._workspaceCachePath, {variant: null, activeEnvironments: []});

    if (this._workspaceCacheContent.variant) {
      this.variants.activeVariantCombination =
          this._workspaceCacheContent.variant;
    }

    await this._environments.environmentsLoaded;
    this._statusBar.environmentsAvailable =
        this._environments.availableEnvironments.size !== 0;
    const envs = this._workspaceCacheContent.activeEnvironments || [];
    for (const e of envs) {
      if (this._environments.availableEnvironments.has(e)) {
        this._environments.activateEnvironments(e);
      }
    }

    if (this.isMultiConf && config.buildDirectory.includes('${buildType}')) {
      vscode.window.showWarningMessage(
          'It is not advised to use ${buildType} in the cmake.buildDirectory settings when the generator supports multiple build configurations.');
    }

    // Refresh any test results that may be left aroud from a previous run
    this._ctestController.reloadTests(
        this.binaryDir, this.selectedBuildType || 'Debug');

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
   * Determine if the project is using a multi-config generator
   */
  public get isMultiConf(): boolean {
    const gen = this.activeGenerator;
    return !!gen && util.isMultiConfGenerator(gen);
  }

  /**
   * Shows a QuickPick containing the available build targets.
   */
  public showTargetSelector(): Thenable<Maybe<string>> {
    if (!this.targets.length) {
      return vscode.window.showInputBox({prompt: 'Enter a target name'});
    } else {
      const choices = this.targets.map((t): vscode.QuickPickItem => {
        switch (t.type) {
          case 'rich': {
            return {
              label: t.name,
              description: t.targetType,
              detail: t.filepath,
            };
          }
          case 'named': {
            return {
              label: t.name,
              description: '',
            };
          }
        }
      });
      return vscode.window.showQuickPick(choices).then(
          sel => sel ? sel.label : null);
    }
  }

  /**
   * @brief Get the name of the "all" target. This is used as the default build
   * target when none is already specified. We cannot simply use the name 'all'
   * because with Visual Studio the target is named ALL_BUILD.
   */
  public get allTargetName() {
    const gen = this.activeGenerator;
    return (gen && /Visual Studio/.test(gen)) ? 'ALL_BUILD' : 'all';
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
    const cached = this.variants.activeConfigurationOptions.buildType;
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
        (accdir, [needle, what]) => util.replaceAll(accdir, needle, what), str);
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

  /**
   * @brief Execute tasks required before doing the build. Returns true if we
   * should continue with the build, false otherwise.
   */
  protected async _prebuild(): Promise<boolean> {
    if (config.clearOutputBeforeBuild) {
      this._channel.clear();
    }

    if (config.saveBeforeBuild &&
        vscode.workspace.textDocuments.some(doc => doc.isDirty)) {
      this._channel.appendLine('[vscode] Saving unsaved text documents...');
      const is_good = await vscode.workspace.saveAll();
      if (!is_good) {
        const chosen = await vscode.window.showErrorMessage<vscode.MessageItem>(
            'Not all open documents were saved. Would you like to build anyway?',
            {
              title: 'Yes',
              isCloseAffordance: false,
            },
            {
              title: 'No',
              isCloseAffordance: true,
            });
        return chosen.title === 'Yes';
      }
    }
    return true;
  }

  public executeCMakeCommand(
      args: string[],
      options: api.ExecuteOptions = {silent: false, environment: {}},
      parser: util.OutputParser = new util.NullParser):
      Promise<api.ExecutionResult> {
    console.info('Execute cmake with arguments:', args);
    return this.execute(config.cmakePath, args, options, parser);
  }


  public get executionEnvironmentVariables(): {[key: string]: string} {
    return Object.assign(config.environment, this.currentEnvironmentVariables)
  }

  /**
   * @brief Execute a CMake command. Resolves to the result of the execution.
   */
  public execute(
      program: string, args: string[],
      options: api.ExecuteOptions =
          {silent: false, environment: {}, collectOutput: false},
      parser: util.OutputParser = new util.NullParser()):
      Promise<api.ExecutionResult> {
    const silent: boolean = options && options.silent || false;
    const final_env = Object.assign(
        {
          // We set NINJA_STATUS to force Ninja to use the format
          // that we would like to parse
          NINJA_STATUS: '[%f/%t %p] '
        },
        options.environment, this.executionEnvironmentVariables);
    const info = util.execute(
        program, args, final_env, options.workingDirectory,
        silent ? null : this._channel);
    const pipe = info.process;
    if (!silent) {
      this.currentChildProcess = pipe;
    }

    pipe.stdout.on('line', (line: string) => {
      const progress = parser.parseLine(line);
      if (!silent && progress) {
        this.buildProgress = progress;
      }
    });
    pipe.stderr.on('line', (line: string) => {
      const progress = parser.parseLine(line);
      if (!silent && progress) {
        this.buildProgress = progress;
      }
    });

    pipe.on('close', (retc: number) => {
      // Reset build progress to null to disable the progress bar
      this.buildProgress = null;
      if (parser instanceof BuildParser) {
        parser.fillDiagnosticCollection(this._diagnostics);
      }
      if (silent) {
        return;
      }
      const msg = `${program} exited with status ${retc}`;
      if (retc !== null) {
        vscode.window.setStatusBarMessage(msg, 4000);
        if (retc !== 0) {
          this._statusBar.showWarningMessage(
              `${program} failed with status ${retc
              }. See CMake/Build output for details.`)
        }
      }

      this.currentChildProcess = null;
    });
    return info.onComplete;
  };

  public async jumpToCacheFile(): Promise<Maybe<vscode.TextEditor>> {
    if (!(await async.exists(this.cachePath))) {
      const do_conf = !!(await vscode.window.showErrorMessage(
          'This project has not yet been configured.', 'Configure Now'));
      if (do_conf) {
        if (await this.configure() !== 0) return null;
      }
    }

    const cache = await vscode.workspace.openTextDocument(this.cachePath);
    return await vscode.window.showTextDocument(cache);
  }

  public async cleanRebuild(): Promise<Number> {
    const clean_result = await this.clean();
    if (clean_result) return clean_result;
    return await this.build();
  }

  public install() {
    return this.build('install');
  }

  public clean() {
    return this.build('clean');
  }

  public async buildWithTarget(): Promise<Number> {
    const target = await this.showTargetSelector();
    if (target === null || target === undefined) return -1;
    return await this.build(target);
  }

  public async setDefaultTarget() {
    const new_default = await this.showTargetSelector();
    if (!new_default) return;
    this.defaultBuildTarget = new_default;
  }

  public async setBuildTypeWithoutConfigure(): Promise<boolean> {
    const changed = await this.variants.showVariantSelector();
    if (changed) {
      // Changing the build type can affect the binary dir
      this._ctestController.reloadTests(
          this.binaryDir, this.selectedBuildType || 'Debug');
    }
    return changed;
  }

  public async setBuildType(): Promise<Number> {
    const do_configure = await this.setBuildTypeWithoutConfigure();
    if (do_configure) {
      return await this.configure();
    } else {
      return -1;
    }
  }
  public async quickStart(): Promise<Number> {
    if (await async.exists(this.mainListFile)) {
      vscode.window.showErrorMessage(
          'This workspace already contains a CMakeLists.txt!');
      return -1;
    }

    const project_name = await vscode.window.showInputBox({
      prompt: 'Enter a name for the new project',
      validateInput: (value: string): string => {
        if (!value.length) return 'A project name is required';
        return '';
      },
    });
    if (!project_name) return -1;

    const target_type = (await vscode.window.showQuickPick([
      {
        label: 'Library',
        description: 'Create a library',
      },
      {label: 'Executable', description: 'Create an executable'}
    ]));

    if (!target_type) return -1;

    const type = target_type.label;

    const init = [
      'cmake_minimum_required(VERSION 3.0.0)',
      `project(${project_name} VERSION 0.0.0)`,
      '',
      'include(CTest)',
      'enable_testing()',
      '',
      {
        Library: `add_library(${project_name} ${project_name}.cpp)`,
        Executable: `add_executable(${project_name} main.cpp)`,
      }[type],
      '',
      'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
      'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
      'include(CPack)',
      '',
    ].join('\n');

    if (type === 'Library') {
      if (!(await async.exists(
              path.join(this.sourceDir, project_name + '.cpp')))) {
        await util.writeFile(path.join(this.sourceDir, project_name + '.cpp'), [
          '#include <iostream>',
          '',
          `void say_hello(){ std::cout << "Hello, from ${project_name}!\\n"; }`,
          '',
        ].join('\n'));
      }
    } else {
      if (!(await async.exists(path.join(this.sourceDir, 'main.cpp')))) {
        await util.writeFile(path.join(this.sourceDir, 'main.cpp'), [
          '#include <iostream>',
          '',
          'int main(int, char**)',
          '{',
          '   std::cout << "Hello, world!\\n";',
          '}',
          '',
        ].join('\n'));
      }
    }
    await util.writeFile(this.mainListFile, init);
    const doc = await vscode.workspace.openTextDocument(this.mainListFile);
    await vscode.window.showTextDocument(doc);
    return this.configure();
  }

  public async debugTarget() {
    if (!this.executableTargets.length) {
      vscode.window.showWarningMessage(
          'No targets are available for debugging. Be sure you have included CMakeToolsHelpers in your CMake project.');
      return;
    }
    const target =
        this.executableTargets.find(e => e.name === this.currentDebugTarget);
    if (!target) {
      vscode.window.showErrorMessage(
          `The current debug target "${this.currentDebugTarget
          }" no longer exists. Select a new target to debug.`);
          return;
    }
    const build_retc = await this.build(target.name);
    if (build_retc !== 0) return;
    const real_config = {
      name: `Debugging Target ${target.name}`,
      type: (this.compilerId && this.compilerId.includes('MSVC')) ? 'cppvsdbg' :
                                                                    'cppdbg',
      request: 'launch',
      cwd: '${workspaceRoot}',
      args: [],
      MIMode: process.platform === 'darwin' ? 'lldb' : 'gdb',
    };
    const user_config = config.debugConfig;
    Object.assign(real_config, user_config);
    real_config['program'] = target.path;
    return vscode.commands.executeCommand('vscode.startDebug', real_config);
  }

  public async build(target_: Maybe<string> = null): Promise<Number> {
    let target = target_;
    if (!target_) {
      target = this.defaultBuildTarget || this.allTargetName;
    }
    if (!this.sourceDir) {
      vscode.window.showErrorMessage('You do not have a source directory open');
      return -1;
    }

    if (this.isBusy) {
      vscode.window.showErrorMessage(
          'A CMake task is already running. Stop it before trying to build.');
      return -1;
    }

    const cachepath = this.cachePath;
    if (!(await async.exists(cachepath))) {
      const retc = await this.configure();
      if (retc !== 0) {
        return retc;
      }
      // We just configured which may change what the "all" target is.
      if (!target_) {
        target = this.defaultBuildTarget || this.allTargetName;
      }
    }
    if (!target) {
      throw new Error(
          'Unable to determine target to build. Something has gone horribly wrong!');
    }
    const ok = await this._prebuild();
    if (!ok) {
      return -1;
    }
    if (this.needsReconfigure) {
      const retc = await this.configure([], false);
      if (!!retc) return retc;
    }
    // Pass arguments based on a particular generator
    const gen = this.activeGenerator;
    const generator_args = (() => {
      if (!gen)
        return [];
      else if (/(Unix|MinGW) Makefiles|Ninja/.test(gen) && target !== 'clean')
        return ['-j', config.numJobs.toString()];
      else if (/Visual Studio/.test(gen))
        return ['/m', '/property:GenerateFullPaths=true'];
      else
        return [];
    })();
    this._channel.show();
    this.statusMessage = `Building ${target}...`;
    const result = await this.executeCMakeCommand(
        [
          '--build',
          this.binaryDir,
          '--target',
          target,
          '--config',
          this.selectedBuildType || 'Debug',
        ].concat(config.buildArgs)
            .concat(['--'].concat(generator_args).concat(config.buildToolArgs)),
        {
          silent: false,
          environment: config.buildEnvironment,
        },
        (config.parseBuildDiagnostics ?
             new BuildParser(
                 this.binaryDir, config.enableOutputParsers,
                 this.activeGenerator) :
             new util.NullParser()));
    this.statusMessage = 'Ready';
    return result.retc;
  }

  protected async _preconfigure(): Promise<boolean> {
    if (this.isBusy) {
      vscode.window.showErrorMessage(
          'A CMake task is already running. Stop it before trying to configure.');
      return false;
    }

    if (!this.sourceDir) {
      vscode.window.showErrorMessage('You do not have a source directory open');
      return false;
    }

    const cmake_list = this.mainListFile;
    if (!(await async.exists(cmake_list))) {
      const do_quickstart = !!(await vscode.window.showErrorMessage(
          'You do not have a CMakeLists.txt',
          'Quickstart a new CMake project'));
      if (do_quickstart) await this.quickStart();
      return false;
    }

    // If no build variant has been chosen, ask the user now
    if (!this.variants.activeVariantCombination) {
      const ok = await this.setBuildTypeWithoutConfigure();
      if (!ok) {
        return false;
      }
    }
    this._channel.show();
    return true;
  }

  protected _buildCacheInitializer(
      settings: {[key: string]: (string | number | boolean | string[])}) {
    const initial_cache_content = [
      '# This file is generated by CMake Tools! DO NOT EDIT!',
      'cmake_policy(PUSH)',
      'if(POLICY CMP0053)',
      '   cmake_policy(SET CMP0053 NEW)',
      'endif()',
    ];

    for (const key in settings) {
      let value = settings[key];
      let typestr = 'UNKNOWN';
      if (value === true || value === false) {
        typestr = 'BOOL';
        value = value ? 'TRUE' : 'FALSE';
      }
      if (typeof(value) === 'string') {
        typestr = 'STRING';
        value = this.replaceVars(value)
        value = util.replaceAll(value, ';', '\\;');
      }
      if (value instanceof Number || typeof value === 'number') {
        typestr = 'STRING';
      }
      if (value instanceof Array) {
        typestr = 'STRING';
        value = value.join(';');
      }
      initial_cache_content.push(`set(${key} "${value.toString().replace(
          /"/g,
          '\\"')}" CACHE ${typestr
                } "Variable supplied by CMakeTools. Value is forced." FORCE)`);
    }
    initial_cache_content.push('cmake_policy(POP)');
    return initial_cache_content.join('\n');
  }
}