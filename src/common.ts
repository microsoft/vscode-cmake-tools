import * as ajv from 'ajv';
import * as proc from 'child_process';
import * as http from 'http';
import * as yaml from 'js-yaml';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ws from 'ws';

import * as api from './api';
import * as async from './async';
import {CacheEditorContentProvider} from './cache-edit';
import {config} from './config';
import * as ctest from './ctest';
import {BuildParser} from './diagnostics';
import * as environment from './environment';
import * as status from './status';
import * as util from './util';
import {Maybe} from './util';
import {VariantManager} from './variants';
import { log } from './logging';
import {CMakeToolsBackend} from './backend';
import { Generator } from './environment';

const CMAKETOOLS_HELPER_SCRIPT = `
get_cmake_property(is_set_up _CMAKETOOLS_SET_UP)
if(NOT is_set_up)
    set_property(GLOBAL PROPERTY _CMAKETOOLS_SET_UP TRUE)
    macro(_cmt_invoke fn)
        file(WRITE "\${CMAKE_BINARY_DIR}/_cmt_tmp.cmake" "
            set(_args \\"\${ARGN}\\")
            \${fn}(\\\${_args})
        ")
        include("\${CMAKE_BINARY_DIR}/_cmt_tmp.cmake" NO_POLICY_SCOPE)
    endmacro()

    set(_cmt_add_executable add_executable)
    set(_previous_cmt_add_executable _add_executable)
    while(COMMAND "\${_previous_cmt_add_executable}")
        set(_cmt_add_executable "_\${_cmt_add_executable}")
        set(_previous_cmt_add_executable _\${_previous_cmt_add_executable})
    endwhile()
    macro(\${_cmt_add_executable} target)
        _cmt_invoke(\${_previous_cmt_add_executable} \${ARGV})
        get_target_property(is_imported \${target} IMPORTED)
        if(NOT is_imported)
            file(APPEND
                "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                "executable;\${target};$<TARGET_FILE:\${target}>\n"
                )
            _cmt_generate_system_info()
        endif()
    endmacro()

    set(_cmt_add_library add_library)
    set(_previous_cmt_add_library _add_library)
    while(COMMAND "\${_previous_cmt_add_library}")
        set(_cmt_add_library "_\${_cmt_add_library}")
        set(_previous_cmt_add_library "_\${_previous_cmt_add_library}")
    endwhile()
    macro(\${_cmt_add_library} target)
        _cmt_invoke(\${_previous_cmt_add_library} \${ARGV})
        get_target_property(type \${target} TYPE)
        if(NOT type MATCHES "^(INTERFACE_LIBRARY|OBJECT_LIBRARY)$")
            get_target_property(imported \${target} IMPORTED)
            get_target_property(alias \${target} ALIAS)
            if(NOT imported AND NOT alias)
                file(APPEND
                    "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                    "library;\${target};$<TARGET_FILE:\${target}>\n"
                    )
            endif()
        else()
            file(APPEND
                "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
                "interface-library;\${target}\n"
                )
        endif()
        _cmt_generate_system_info()
    endmacro()

    if({{{IS_MULTICONF}}})
        set(condition CONDITION "$<CONFIG:Debug>")
    endif()

    file(WRITE "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt" "")
    file(GENERATE
        OUTPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta-$<CONFIG>.txt"
        INPUT "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
        \${condition}
        )

    function(_cmt_generate_system_info)
        get_property(done GLOBAL PROPERTY CMT_GENERATED_SYSTEM_INFO)
        if(NOT done)
            set(_compiler_id "\${CMAKE_CXX_COMPILER_ID}")
            if(MSVC AND CMAKE_CXX_COMPILER MATCHES ".*clang-cl.*")
                set(_compiler_id "MSVC")
            endif()
            file(APPEND "\${CMAKE_BINARY_DIR}/CMakeToolsMeta.in.txt"
    "system;\${CMAKE_HOST_SYSTEM_NAME};\${CMAKE_SYSTEM_PROCESSOR};\${_compiler_id}\n")
        endif()
        set_property(GLOBAL PROPERTY CMT_GENERATED_SYSTEM_INFO TRUE)
    endfunction()
endif()
`;

interface WsMessage {
  data: string;
  target: ws;
  type: string;
}

async function readWorkspaceCache(
    path: string, defaultContent: util.WorkspaceCache) {
  log.info(`Loading CMake Tools from ${path}`);
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
    log.error(`Error reading CMake Tools workspace cache: ${err}`);
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



export abstract class CommonCMakeToolsBase implements CMakeToolsBackend {
  abstract allCacheEntries(): api.CacheEntryProperties[];
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
  abstract get reconfigured(): vscode.Event<void>;

  private _targetChangedEmitter = new vscode.EventEmitter<void>();
  readonly targetChanged = this._targetChangedEmitter.event;

  protected _refreshAfterConfigure() {}

  protected noExecutablesMessage: string = 'No targets are available for debugging.';

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
   * ctestController manages running ctest and reports ctest results via an
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
        this.sourceDir, this.binaryDir, this.selectedBuildType || 'Debug',
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

  public getPreferredGenerators(): Generator[] {
    const configGenerators = config.preferredGenerators.map(g => <Generator>{ name: g });
    return configGenerators.concat(this._environments.preferredEnvironmentGenerators);
  }

  protected async testHaveCommand(program: string, args: string[] = ['--version']): Promise<Boolean> {
    const env = util.mergeEnvironment(process.env, this.currentEnvironmentVariables);
    return await new Promise<Boolean>((resolve, _) => {
      const pipe = proc.spawn(program, args, {
        env: env
      });
      pipe.on('error', () => resolve(false));
      pipe.on('exit', () => resolve(true));
    });
  }

  // Returns the first one available on this system
  public async pickGenerator(): Promise<Maybe<Generator>> {
    // The user can override our automatic selection logic in their config
    const generator = config.generator;
    if (generator) {
      // User has explicitly requested a certain generator. Use that one.
      log.verbose(`Using generator from configuration: ${generator}`);
      return {
        name: generator,
        platform: config.platform || undefined,
        toolset: config.toolset || undefined,
      };
    }
    log.verbose("Trying to detect generator supported by system");
    const platform = process.platform;
    const candidates = this.getPreferredGenerators();
    for (const gen of candidates) {
      const delegate = {
        Ninja: async () => {
          return await this.testHaveCommand('ninja-build') ||
            await this.testHaveCommand('ninja');
        },
        'MinGW Makefiles': async () => {
          return platform === 'win32' && await this.testHaveCommand('make')
            || await this.testHaveCommand('mingw32-make');
        },
        'NMake Makefiles': async () => {
          return platform === 'win32' &&
            await this.testHaveCommand('nmake', ['/?']);
        },
        'Unix Makefiles': async () => {
          return platform !== 'win32' && await this.testHaveCommand('make');
        }
      }[gen.name];
      if (!delegate) {
        const vsMatch = /^(Visual Studio \d{2} \d{4})($|\sWin64$|\sARM$)/.exec(gen.name);
        if (platform === 'win32' && vsMatch) {
          return {
            name: vsMatch[1],
            platform: gen.platform || vsMatch[2],
            toolset: gen.toolset,
          };
        }
        if (gen.name.toLowerCase().startsWith('xcode') && platform === 'darwin') {
          return gen;
        }
        vscode.window.showErrorMessage('Unknown CMake generator "' + gen.name + '"');
        continue;
      }
      if (await delegate.bind(this)()) {
        return gen;
      }
      else {
        log.info(`Build program for generator ${gen.name} is not found. Skipping...`);
      }
    }
    return null;
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
   * Toggle on/off highlighting of coverage data in the editor
   */
  public toggleCoverageDecorations() {
    this.showCoverageData = !this.showCoverageData;
  }
  public get showCoverageData(): boolean {
    return this._ctestController.showCoverageData;
  }
  public set showCoverageData(v: boolean) {
    this._ctestController.showCoverageData = v;
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

  /**
   * Find a target in our code model
   */
  protected _findTarget(codeModel, targetName) {
    if (codeModel) {
      const targets = codeModel.configurations[0].projects[0].targets;
      for (var t in targets) {
        const target = targets[t];
        if (target.name === targetName) {
          return target;
        }
      }
    }
    return undefined;
  }

  /**
   * Extract the include paths from the given target
   *
   * @todo Check for duplicated paths ?
   */
  protected _getIncludePaths(target) {
    var includePaths: string[] = [];

    // add the config paths
    includePaths = includePaths.concat(config.cppToolsAdditionalIncludePaths);

    // add the target paths
    if (target) {
      for (var f in target.fileGroups) {
        const fileGroup = target.fileGroups[f];
        if (fileGroup.language === "CXX") {
          if (fileGroup.includePath) {
            for (var p in fileGroup.includePath) {
              if (fileGroup.includePath[p].path) {
                includePaths.push(fileGroup.includePath[p].path);
              }
            }
          }
        }
      }
    }
    return includePaths;
  }

  /**
   * RegExp used to identify defines
   *
   * @see _getDefines
   */
  private static _defineRegexp = /-D([^ ]+)/g

  /**
   * Extract the defines from the given target

   * @todo Check for duplicated defines ?
   */
  protected _getDefines(target) {
    var defines: string[] = [];
    if (target) {
      for (var f in target.fileGroups) {
        const fileGroup = target.fileGroups[f];
        if (fileGroup.language === "CXX") {
          // handle explicit defines list
          if (fileGroup.defines) {
            for (var d in fileGroup.defines) {
              defines.push(fileGroup.defines[d]);
            }
          }

          // scan the compil flags
          const compileFlags: string = fileGroup.compileFlags;
          CommonCMakeToolsBase._defineRegexp.lastIndex = 0;
          var result;
          while ((result = CommonCMakeToolsBase._defineRegexp.exec(compileFlags)) !== null) {
            defines.push(result[1]);
          }
        }
      }
    }
    return defines;
  }

  /**
   * Generate a c_cpp_properties.json file with the include path, defines, etc.
   * of the current build type
   */
  protected _generateCppToolsSettings() {
    // if the integration is disabled, leave c_cpp_properties.json alone !
    if (config.cppToolsEnabled === false) {
      return;
    }

    // get the target
    const targetName = this._defaultBuildTarget && this._defaultBuildTarget !== "all" ?
      this._defaultBuildTarget :
      config.cppToolsDefaultTarget;
    const target = this._findTarget(this._workspaceCacheContent.codeModel, targetName);

    // check for errors and notify the user accordingly without returning
    // note: in case of errors, we still want to update the c_cpp_settings.json properties
    // if we didn't update it, it would continue using the previous file, resulting in a
    // really bad thing: Intellisense might still work, so the user might think that everything
    // went well, while a few defines might be wrong, some include paths too, leading  to
    // a lot of headaches understanding why things don't work as expected.
    // So the best way to avoid this is to just report the error and clear the file.
    // This way the user instantly notice that something's wrong, and knows why.
    if (this._workspaceCacheContent.variant) {
      if (target === undefined) {
        vscode.window.showWarningMessage(
          "CMake Tools: Couldn't update cpptools configuration. " +
          "Make sure the build type is selected and `cmake.cpptools.defaultTarget` " +
          "is set to a valid target name."
        );
      }
    }

    // create the c_cpp_properties.json content
    const includePaths = this._getIncludePaths(target);
    const defines = this._getDefines(target);
    const settings = {
      "configurations": [
        {
          "name": os.platform(),
          "includePath": includePaths,
          "defines": defines,
          "intelliSenseMode": config.cppToolsIntelliSenseMode,
          "browse": {
              "path": includePaths,
              "limitSymbolsToIncludedHeaders": config.cppToolsLimitSymbolsToIncludedHeaders,
              "databaseFilename": config.cppToolsDatabaseFilename
          }
        }
      ]
    };

    // and update it
    util.writeFile(
      path.join(vscode.workspace.rootPath, ".vscode", "c_cpp_properties.json"),
      JSON.stringify(settings, null, 2)
    );
  }

  public async selectLaunchTarget(): Promise<string | null> {
    const executableTargets = this.executableTargets;
    if (!executableTargets) {
      vscode.window.showWarningMessage(this.noExecutablesMessage);
      return null;
    }

    const choices = executableTargets.map(e => ({
      label: e.name,
      description: '',
      detail: e.path,
    }));
    const chosen = await vscode.window.showQuickPick(choices);
    if (!chosen) {
      return null;
    }
    this.currentLaunchTarget = chosen.label;
    return chosen.detail;
  }

  private _ws_server: ws.Server;
  private _http_server: http.Server;

  constructor(protected readonly _context: vscode.ExtensionContext) {
    const editor_server = this._http_server = http.createServer();
    const ready = new Promise((resolve, reject) => {
      editor_server.listen(0, 'localhost', undefined, (err) => {
        if (err)
          reject(err);
        else
          resolve();
      });
    });

    ready.then(() => {
      // on reconfiguration, we need to resync c/cpp properties
      this.reconfigured(() => {
        this._generateCppToolsSettings();
      });

      const websock_server = this._ws_server =
          ws.createServer({server: editor_server});
      websock_server.on('connection', (client) => {
        const sub = this.reconfigured(() => {
          client.send(JSON.stringify({method: 'refreshContent'}));
        });
        client.onclose = () => {
          sub.dispose();
        };
        client.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          console.log('Got message from editor client', msg);
          const ret = this._handleCacheEditorMessage(data.method, data.params)
                          .then(ret => {
                            client.send(JSON.stringify({
                              id: data.id,
                              result: ret,
                            }));
                          })
                          .catch(e => {
                            client.send(JSON.stringify({
                              id: data.id,
                              error: (e as Error).message,
                            }));
                          });
        };
      });

      this._disposables.push(
          vscode.workspace.registerTextDocumentContentProvider(
              'cmake-cache', new CacheEditorContentProvider(
                                 _context, editor_server.address().port)));
    });


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
    // Setting this will set the string in the statusbar, so we set it here even
    // though it has the correct default value.
    this.defaultBuildTarget = null;

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
        this.sourceDir, this.binaryDir, this.selectedBuildType || 'Debug');

    // we're initialized, time to handle the cpptools integration !
    this._generateCppToolsSettings();

    return this;
  }

  dispose() {
    this._disposables.map(d => d.dispose());
    this._ws_server.close();
    this._http_server.close();
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
  public async showTargetSelector(): Promise<string|null> {
    if (!this.targets.length) {
      return (await vscode.window.showInputBox({prompt: 'Enter a target name'})) || null;
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
    return (gen && (/Visual Studio/.test(gen) || gen.toLowerCase().includes('xcode'))) ? 'ALL_BUILD' : 'all';
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

  /**
   * @brief Replace all predefined variable by their actual values in the
   * input string.
   *
   * This method takes care of variables that depend on CMake configuration,
   * such as the built type, etc. All variables that do not need to know
   * of CMake should go to util.replaceVars instead.
   */
  public replaceVars(str: string): string {
    const replacements = [
      ['${buildType}', this.selectedBuildType || 'Unknown']
    ] as [string, string][];
    return util.replaceVars(replacements.reduce(
        (accdir, [needle, what]) => util.replaceAll(accdir, needle, what), str));
  }

  /**
   * @brief Read the source directory from the config
   */
  get sourceDir(): string {
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
  private _defaultBuildTarget: string|null = null;
  public get defaultBuildTarget(): string|null {
    return this._defaultBuildTarget;
  }
  public set defaultBuildTarget(v: string|null) {
    this._defaultBuildTarget = v;
    this._statusBar.targetName = v || this.allTargetName;
    this._targetChangedEmitter.fire();
    this._generateCppToolsSettings();
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
  private _currentLaunchTarget: Maybe<string> = null;
  public get currentLaunchTarget(): Maybe<string> {
    return this._currentLaunchTarget;
  }
  public set currentLaunchTarget(v: Maybe<string>) {
    this._currentLaunchTarget = v;
    this._statusBar.launchTargetName = v || '';
  }
  protected _setDefaultLaunchTarget() {
    // Check if the currently selected debug target is no longer a target
    const targets = this.executableTargets;
    if (targets.findIndex(e => e.name === this.currentLaunchTarget) < 0) {
      if (targets.length) {
        this.currentLaunchTarget = targets[0].name;
      } else {
        this.currentLaunchTarget = null;
      }
    }
    // If we didn't have a debug target, set the debug target to the first target
    if (this.currentLaunchTarget === null && targets.length) {
      this.currentLaunchTarget = targets[0].name;
    }
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
        return chosen !== undefined && (chosen.title === 'Yes');
      }
    }
    return true;
  }

  public executeCMakeCommand(
      args: string[],
      options: api.ExecuteOptions = {silent: false, environment: {}},
      parser: util.OutputParser = new util.NullParser):
      Promise<api.ExecutionResult> {
    log.info(`Execute cmake with arguments: ${args}`);
    return this.execute(config.cmakePath, args, options, parser);
  }


  public get executionEnvironmentVariables(): {[key: string]: string} {
    return util.mergeEnvironment(config.environment, this.currentEnvironmentVariables);
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
    const env = util.mergeEnvironment(
        {
          // We set NINJA_STATUS to force Ninja to use the format
          // that we would like to parse
          NINJA_STATUS: '[%f/%t %p] '
        },
        this.executionEnvironmentVariables, options.environment);
    const info = util.execute(
        program, args, env, options.workingDirectory,
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

    vscode.commands.executeCommand(
        'vscode.previewHtml', 'cmake-cache://' + this.cachePath,
        vscode.ViewColumn.Three, 'CMake Cache');

    return null;
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
          this.sourceDir, this.binaryDir, this.selectedBuildType || 'Debug');
    }
    return changed;
  }

  public async setBuildType(): Promise<Number> {
    const do_configure = await this.setBuildTypeWithoutConfigure();
    if (do_configure) {
     const result = await this.configure();
      if (result === 0) {
        this._generateCppToolsSettings();
      }
      return result;
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

  public getLaunchTargetInfo() {
    return this.executableTargets.find(e => e.name === this.currentLaunchTarget) || null;
  }

  public async launchTargetProgramPath() {
    const t = this.getLaunchTargetInfo();
    return t ? t.path : t;
  }

  private async _prelaunchTarget(): Promise<api.ExecutableTarget|null> {
    if (!this.executableTargets.length) {
      vscode.window.showWarningMessage(
          'No executable targets are available. Be sure you have included CMakeToolsHelpers in your CMake project.');
      return null;
    }
    const target = this.getLaunchTargetInfo();
    if (!target) {
      vscode.window.showErrorMessage(
          `The current debug target "${this.currentLaunchTarget}" no longer exists. Select a new target to debug.`);
          return null;
    }
    const build_before = config.buildBeforeRun;
    if (!build_before) return target;

    const build_retc = await this.build(target.name);
    if (build_retc !== 0) return null;
    return target;
  }

  public async launchTarget() {
    const target = await this._prelaunchTarget();
    if (!target) return;
    const term = vscode.window.createTerminal(target.name, target.path);
    this._disposables.push(term);
    term.show();
  }

  public async debugTarget(): Promise<void> {
    const target = await this._prelaunchTarget();
    if (!target) return;
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
    await vscode.commands.executeCommand('vscode.startDebug', real_config);
  }

  public async prepareConfigure(): Promise<string[]> {
    const cmake_cache_path = this.cachePath;

    const args = [] as string[];

    const settings = Object.assign({}, config.configureSettings);
    if (!this.isMultiConf) {
      settings.CMAKE_BUILD_TYPE = this.selectedBuildType;
    }

    settings.CMAKE_EXPORT_COMPILE_COMMANDS = true;

    const variant_options = this.variants.activeConfigurationOptions;
    if (variant_options) {
      Object.assign(settings, variant_options.settings || {});
      if (variant_options.linkage) {
        // Don't set BUILD_SHARED_LIBS if we don't have a specific setting
        settings.BUILD_SHARED_LIBS = variant_options.linkage === 'shared';
      }
    }

    const cmt_dir = path.join(this.binaryDir, 'CMakeTools');
    await util.ensureDirectory(cmt_dir);

    const helpers = path.join(cmt_dir, 'CMakeToolsHelpers.cmake');
    const helper_content = util.replaceAll(
        CMAKETOOLS_HELPER_SCRIPT, '{{{IS_MULTICONF}}}',
        this.isMultiConf ? '1' : '0');
    await util.writeFile(helpers, helper_content);
    const old_path = settings['CMAKE_MODULE_PATH'] as Array<string>|| [];
    settings['CMAKE_MODULE_PATH'] =
        Array.from(old_path).concat([cmt_dir.replace(/\\/g, path.posix.sep)]);

    const init_cache_path =
        path.join(this.binaryDir, 'CMakeTools', 'InitializeCache.cmake');
    const init_cache_content = this._buildCacheInitializer(settings);
    await util.writeFile(init_cache_path, init_cache_content);
    let prefix = config.installPrefix;
    if (prefix && prefix !== '') {
      prefix = this.replaceVars(prefix);
      args.push('-DCMAKE_INSTALL_PREFIX=' + prefix);
    }

    args.push('-C' + init_cache_path);
    args.push(...config.configureArgs);
    return args;
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
    this._statusBar.reloadVisibility();
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
      else if (typeof(value) === 'string') {
        typestr = 'STRING';
        value = this.replaceVars(value)
        value = util.replaceAll(value, ';', '\\;');
      }
      else if (value instanceof Number || typeof value === 'number') {
        typestr = 'STRING';
      }
      else if (value instanceof Array) {
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
  private _handleCacheEditorMessage(
      method: string, params: {[key: string]: any}): Promise<any> {
    switch (method) {
      case 'getEntries': {
        return Promise.resolve(this.allCacheEntries());
      }
      case 'configure': {
        return this.configure(params['args']);
      }
      case 'build': {
        return this.build();
      }
    }
    throw new Error('Invalid method: ' + method);
  }
}