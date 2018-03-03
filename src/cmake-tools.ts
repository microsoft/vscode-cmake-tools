/**
 * Root of the extension
 */
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ws from 'ws';

import * as api from './api';
import {ExecutionOptions, ExecutionResult} from "./api";
import {CacheEditorContentProvider} from "./cache-editor";
import {CMakeServerClientDriver} from './cms-driver';
import config from "./config";
import {CTestDriver} from './ctest';
import * as diags from './diagnostics';
import {populateCollection} from './diagnostics';
import {CMakeDriver} from './driver';
import {KitManager} from './kit';
import {LegacyCMakeDriver} from './legacy-driver';
import * as logging from './logging';
import {NagManager} from "./nag";
import paths from './paths';
import {fs} from './pr';
import * as proc from './proc';
import rollbar from './rollbar';
import {StateManager} from './state';
import {StatusBar} from './status';
import * as util from './util';
import {VariantManager} from './variant';

const log = logging.createLogger('main');
const build_log = logging.createLogger('build');

/**
 * Class implementing the extension. It's all here!
 *
 * The class internally uses a two-phase initialization, since proper startup
 * requires asynchrony. To ensure proper initialization. The class must be
 * created via the `create` static method. This will run the two phases
 * internally and return a promise to the new instance. This ensures that the
 * class invariants are maintained at all times.
 *
 * Some fields also require two-phase init. Their first phase is in the first
 * phase of the CMakeTools init, ie. the constructor.
 *
 * The second phases of fields will be called by the second phase of the parent
 * class. See the `_init` private method for this initialization.
 */
export class CMakeTools implements vscode.Disposable, api.CMakeToolsAPI {
  private _http_server: http.Server;
  private _ws_server: ws.Server;

  private _nagManager = new NagManager(this.extensionContext);

  /**
   * Construct a new instance. The instance isn't ready, and must be initalized.
   * @param extensionContext The extension context
   *
   * This is private. You must call `create` to get an instance.
   */
  private constructor(readonly extensionContext: vscode.ExtensionContext) {
    // Handle the active kit changing. We want to do some updates and teardown
    log.debug('Constructing new CMakeTools instance');

    const editor_server = this._http_server = http.createServer();
    const ready = new Promise((resolve, reject) => {
      editor_server.listen(0, 'localhost', undefined, (err: any) => {
        if (err)
          reject(err);
        else
          resolve();
      });
    });

    ready.then(() => {
      const websock_server = this._ws_server = ws.createServer({server : editor_server});
      websock_server.on('connection', (client) => {
        const sub = this.onReconfigured(() => { client.send(JSON.stringify({method : 'refreshContent'})); });
        client.onclose = () => { sub.dispose(); };
        client.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          console.log('Got message from editor client', msg);
          rollbar.invokeAsync('Handle message from cache editor', () => {
            return this._handleCacheEditorMessage(data.method, data.params)
                .then(ret => {
                  client.send(JSON.stringify({
                    id : data.id,
                    result : ret,
                  }));
                })
                .catch(e => {
                  client.send(JSON.stringify({
                    id : data.id,
                    error : (e as Error).message,
                  }));
                });
          });
        };
      });

      vscode.workspace
          .registerTextDocumentContentProvider('cmake-cache',
                                               new CacheEditorContentProvider(this.extensionContext,
                                                                              editor_server.address().port));
    });
  }

  /**
   * The state manager for the class. Workspace-persistent state is kept in here
   * on a vscode Memento so that we don't have to bother worrying about keeping
   * it persisted.
   */
  private readonly _stateManager = new StateManager(this.extensionContext);

  /**
   * It's up to the kit manager to do all things related to kits. Has two-phase
   * init.
   */
  private readonly _kitManager = new KitManager(this._stateManager);

  /**
   * The variant manager keeps track of build variants. Has two-phase init.
   */
  private readonly _variantManager = new VariantManager(this._stateManager);

  /**
   * The object in charge of talking to CMake. It starts empty (null) because
   * we don't know what driver to use at the current time. The driver also has
   * two-phase init and a private constructor. The driver may be replaced at
   * any time by the user making changes to the workspace configuration.
   */
  private _cmakeDriver: Promise<CMakeDriver|null> = Promise.resolve(null);

  /**
   * The status bar manager. Has two-phase init.
   */
  private _statusBar: StatusBar = new StatusBar();

  /**
   * Dispose the extension
   */
  dispose() {
    log.debug('Disposing CMakeTools extension');
    if (this._launchTerminal)
      this._launchTerminal.dispose();
    rollbar.invoke('Root dispose', () => this.asyncDispose());
  }

  /**
   * Dispose of the extension asynchronously.
   */
  async asyncDispose() {
    this._kitManager.dispose();
    this._configureDiagnostics.dispose();
    if (this._cmakeDriver) {
      const drv = await this._cmakeDriver;
      if (drv) {
        await drv.asyncDispose();
      }
    }
    this._statusBar.dispose();
    this._variantManager.dispose();
    this._ctestController.dispose();
  }

  /**
   * Start up a new CMake driver and return it. This is so that the initialization
   * of the driver is atomic to those using it
   */
  private async _startNewCMakeDriver(): Promise<CMakeDriver> {
    const kit = this._kitManager.activeKit;
    const drv = await (async () => {
      log.debug('Starting CMake driver');
      const cmake = await paths.cmakePath;
      const version_ex = await proc.execute(cmake, [ '--version' ]).result;
      if (version_ex.retc !== 0 || !version_ex.stdout) {
        throw new Error(`Bad CMake executable "${cmake}". Is it installed and a valid executable?`);
      }

      if (config.useCMakeServer) {
        console.assert(version_ex.stdout);
        const version_re = /cmake version (.*?)\r?\n/;
        const version = util.parseVersion(version_re.exec(version_ex.stdout)![1]);
        // We purposefully exclude versions <3.7.1, which have some major CMake
        // server bugs
        if (util.versionGreater(version, '3.7.1')) {
          return await CMakeServerClientDriver.create(this._stateManager, kit);
        } else {
          log.info(
              'CMake Server is not available with the current CMake executable. Please upgrade to CMake 3.7.2 or newer.');
        }
      }
      // We didn't start the server backend, so we'll use the legacy one
      return await LegacyCMakeDriver.create(this._stateManager, kit);
    })();
    await drv.setVariantOptions(this._variantManager.activeVariantOptions);
    const project = drv.projectName;
    if (project) {
      this._statusBar.setProjectName(project);
    }
    drv.onProjectNameChanged(name => { this._statusBar.setProjectName(name); });
    drv.onReconfigured(() => this._onReconfiguredEmitter.fire());
    // All set up. Fulfill the driver promise.
    return drv;
  }

  /**
   * Event fired after CMake configure runs
   */
  get onReconfigured() { return this._onReconfiguredEmitter.event; }
  private _onReconfiguredEmitter = new vscode.EventEmitter<void>();

  get reconfigured() { return this.onReconfigured; }

  private _onTargetChangedEmitter = new vscode.EventEmitter<void>();
  get targetChangedEvent() { return this._onTargetChangedEmitter.event; }

  async executeCMakeCommand(args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
    const drv = await this.getCMakeDriverInstance();
    const cmake = await paths.cmakePath;
    if (drv) {
      return drv.executeCommand(cmake, args, undefined, options).result;
    } else {
      throw new Error("Unable to execute cmake command, there is no valid cmake driver instance.");
    }
  }

  async execute(program: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
    const drv = await this.getCMakeDriverInstance();
    if (drv) {
      return drv.executeCommand(program, args, undefined, options).result;
    } else {
      throw new Error("Unable to execute program, there is no valid cmake driver instance.");
    }
  }

  async compilationInfoForFile(filepath: string): Promise<api.CompilationInfo|null> {
    const drv = await this.getCMakeDriverInstance();
    if (drv) {
      return drv.compilationInfoForFile(filepath);
    } else {
      throw new Error("Unable to get compilation information, there is no valid cmake driver instance.");
    }
  }

  /**
   * Reload/restarts the CMake Driver
   */
  // private async _reloadCMakeDriver() {
  //   log.debug('Reloading CMake driver');
  //   const drv = await this._cmakeDriver;
  //   log.debug('Diposing old CMake driver');
  //   await drv.asyncDispose();
  //   return this._cmakeDriver = this._startNewCMakeDriver();
  // }

  /**
   * Second phase of two-phase init. Called by `create`.
   */
  private async _init() {
    log.debug('Starting CMakeTools second-phase init');
    // First, start up Rollbar
    await rollbar.requestPermissions(this.extensionContext);
    // Start up the variant manager
    await this._variantManager.initialize();
    // Set the status bar message
    this._statusBar.setBuildTypeLabel(this._variantManager.activeVariantOptions.short);
    // Restore the debug target
    this._statusBar.setLaunchTargetName(this._stateManager.launchTargetName || '');
    // Start up the kit manager
    await this._kitManager.initialize();
    this._statusBar.setActiveKitName(this._kitManager.activeKit ? this._kitManager.activeKit.name : '');

    // Hook up event handlers
    // Listen for the variant to change
    this._variantManager.onActiveVariantChanged(() => {
      log.debug('Active build variant changed');
      rollbar.invokeAsync('Changing build variant', async () => {
        const drv = await this.getCMakeDriverInstance();
        if (drv) {
          await drv.setVariantOptions(this._variantManager.activeVariantOptions);
          this._statusBar.setBuildTypeLabel(this._variantManager.activeVariantOptions.short);
          // We don't configure yet, since someone else might be in the middle of a configure
        }
      })
    });
    // Listen for the kit to change
    this._kitManager.onActiveKitChanged(kit => {
      log.debug('Active CMake Kit changed:', kit ? kit.name : 'null');
      rollbar.invokeAsync('Changing CMake kit', async () => {
        if (kit) {
          log.debug('Injecting new Kit into CMake driver');
          const drv = await this.getCMakeDriverInstance();
          if (drv) {
            await drv.setKit(kit);
          }
        }
        this._statusBar.setActiveKitName(kit ? kit.name : '');
      });
    });
    this._ctestController.onTestingEnabledChanged(enabled => { this._statusBar.ctestEnabled = enabled; });
    this._ctestController.onResultsChanged(res => { this._statusBar.testResults = res; });

    this._statusBar.setStatusMessage('Ready');

    // Additional, non-extension: Start up nagging.
    this._nagManager.start();
  }

  /**
   * Returns, if possible a cmake driver instance. To creation the driver instance,
   * there are preconditions that should be fulfilled, such as an active kit is selected.
   * These preconditions are checked before it driver instance creation. When creating a
   * driver instance, this function waits until the driver is ready before returning.
   * This ensures that user commands can always be executed, because error criterials like
   * exceptions would assign a null driver and it is possible to create a new driver instance later again.
   */
  async getCMakeDriverInstance(): Promise<CMakeDriver|null> {
    if (!this._kitManager.hasActiveKit) {
      return null;
    }

    if ((await this._cmakeDriver) == null) {
      try {
        this._cmakeDriver = this._startNewCMakeDriver();
        let cmakeInstance = await this._cmakeDriver;
        // Reload any test results. This will also update visibility on the status
        // bar
        await this._ctestController.reloadTests(cmakeInstance!);
        this._statusBar.targetName = this.defaultBuildTarget || await this.allTargetName;
      } catch (ex) {
        log.debug("Exception on start of cmake driver.", ex.stack);
        this._cmakeDriver = Promise.resolve(null);
      }
    }
    return this._cmakeDriver;
  }

  /**
   * Create an instance asynchronously
   * @param ctx The extension context
   *
   * The purpose of making this the only way to create an instance is to prevent
   * us from creating uninitialized instances of the CMake Tools extension.
   */
  static async create(ctx: vscode.ExtensionContext): Promise<CMakeTools> {
    log.debug('Safe constructing new CMakeTools instance');
    const inst = new CMakeTools(ctx);
    await inst._init();
    log.debug('CMakeTools instance initialization complete.');
    return inst;
  }

  /**
   * Implementation of `cmake.editKits`
   */
  editKits() { return this._kitManager.openKitsEditor(); }

  /**
   * Implementation of `cmake.scanForKits`
   */
  scanForKits() { return this._kitManager.rescanForKits(); }

  /**
   * Implementation of `cmake.selectKit`
   */
  selectKit() { return this._kitManager.selectKit(); }

  /**
   * The `DiagnosticCollection` for the CMake configure diagnostics.
   */
  private readonly _configureDiagnostics = vscode.languages.createDiagnosticCollection('cmake-configure-diags');

  /**
   * The `DiagnosticCollection` for build diagnostics
   */
  private readonly _buildDiagnostics = vscode.languages.createDiagnosticCollection('cmake-build-diags');

  /**
   * Implementation of `cmake.configure`
   */
  configure(extra_args: string[] = []) {
    return this._doConfigure(async (consumer) => {
      const drv = await this.getCMakeDriverInstance();
      if (drv) {
        return drv.configure(extra_args, consumer);
      } else {
        return -1;
      }
    });
  }

  /**
   * Implementation of `cmake.cleanConfigure()
   */
  cleanConfigure() {
    return this._doConfigure(async (consumer) => {
      const drv = await this.getCMakeDriverInstance();
      if (drv) {
        return drv.cleanConfigure(consumer);
      } else {
        return -1;
      }
    });
  }

  /**
   * Wraps pre/post configure logic around an actual configure function
   * @param cb The actual configure callback. Called to do the configure
   */
  private async _doConfigure(cb: (consumer: diags.CMakeOutputConsumer) => Promise<number>): Promise<number> {
    if (!this._kitManager.hasActiveKit) {
      log.debug('No kit selected yet. Asking for a Kit first.');
      await this.selectKit();
    }
    if (!this._kitManager.hasActiveKit) {
      log.debug('No kit selected. Abort configure.');
      vscode.window.showErrorMessage('Cannot configure without a Kit');
      return -1;
    }
    if (!this._variantManager.haveVariant) {
      await this._variantManager.selectVariant();
      if (!this._variantManager.haveVariant) {
        log.debug('No variant selected. Abort configure');
        return -1;
      }
    }
    if (config.clearOutputBeforeBuild) {
      log.clearOutputChannel();
    }
    log.showChannel();
    const consumer = new diags.CMakeOutputConsumer(await this.sourceDir);
    const retc = await cb(consumer);
    diags.populateCollection(this._configureDiagnostics, consumer.diagnostics);
    return retc;
  }

  /**
   * Get the name of the "all" target; that is, the target name for which CMake
   * will build all default targets.
   *
   * This is required because simply using `all` as the target name is incorrect
   * for some generators, such as Visual Studio and Xcode.
   *
   * This is async because it depends on checking the active generator name
   */
  get allTargetName() { return this._allTargetName(); }
  private async _allTargetName(): Promise<string> {
    const drv = await this.getCMakeDriverInstance();
    if (drv) {
      return drv.allTargetName;
    } else {
      return '';
    }
  }

  /**
   * Implementation of `cmake.build`
   */
  async build(target_?: string): Promise<number> {
    // First, reconfigure if necessary
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      log.debug('Build of project is not possible, because driver is not ready.');
      vscode.window.showErrorMessage('Unable to build, try to run configure before build.');
      return -1;
    }

    if (await drv.needsReconfigure) {
      const retc = await this.configure();
      if (retc) {
        return retc;
      }
    } else if (config.clearOutputBeforeBuild) {
      log.clearOutputChannel();
    }
    const target = target_ ? target_ : this._stateManager.defaultBuildTarget || await this.allTargetName;
    const consumer = new diags.CMakeBuildConsumer();
    try {
      this._statusBar.setStatusMessage('Building');
      this._statusBar.setVisible(true);
      this._statusBar.setIsBusy(true);
      consumer.onProgress(pr => { this._statusBar.setProgress(pr.value); });
      log.showChannel();
      build_log.info('Starting build');
      const rc = await drv.build(target, consumer);
      if (rc === null) {
        build_log.info('Build was terminated');
      } else {
        build_log.info('Build finished with exit code', rc);
      }
      const diags = consumer.compileConsumer.createDiagnostics(drv.binaryDir);
      populateCollection(this._buildDiagnostics, diags);
      return rc === null ? -1 : rc;
    } finally {
      this._statusBar.setIsBusy(false);
      consumer.dispose();
    }
  }

  async editCache(): Promise<void> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      vscode.window.showErrorMessage('Set up your CMake project before trying to edit the cache.');
      return;
    }

    if (!await fs.exists(drv.cachePath)) {
      const do_conf
          = !!(await vscode.window.showErrorMessage('This project has not yet been configured', 'Configure Now'));
      if (do_conf) {
        if (await this.configure() !== 0)
          return;
      } else {
        return;
      }
    }

    await vscode.commands.executeCommand('vscode.previewHtml',
                                         'cmake-cache://' + drv.cachePath,
                                         vscode.ViewColumn.Three,
                                         'CMake Cache');
  }

  async buildWithTarget(): Promise<number> {
    const target = await this.showTargetSelector();
    if (target === null)
      return -1;
    return this.build(target);
  }

  async showTargetSelector(): Promise<string|null> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      vscode.window.showErrorMessage('Set up your CMake project before selecting a target.');
      return '';
    }

    if (!drv.targets.length) {
      return (await vscode.window.showInputBox({prompt : 'Enter a target name'})) || null;
    } else {
      const choices = drv.targets.map((t): vscode.QuickPickItem => {
        switch (t.type) {
        case 'named': {
          return {
            label : t.name,
            description : 'Target to build',
          };
        }
        case 'rich': {
          return { label: t.name, description: t.targetType, detail: t.filepath }
        }
        }
      });
      const sel = await vscode.window.showQuickPick(choices);
      return sel ? sel.label : null;
    }
  }

  /**
   * Implementaiton of `cmake.clean`
   */
  async clean(): Promise<number> { return this.build('clean'); }

  /**
   * Implementation of `cmake.cleanRebuild`
   */
  async cleanRebuild(): Promise<number> {
    const clean_res = await this.clean();
    if (clean_res !== 0)
      return clean_res;
    return this.build();
  }

  private _ctestController = new CTestDriver();
  async ctest(): Promise<number> {
    const build_retc = await this.build();
    if (build_retc !== 0) {
      return build_retc;
    }

    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      throw new Error('Impossible: CMake driver died immediately after build succeeded.');
    }
    return this._ctestController.runCTest(drv);
  }

  /**
   * Implementation of `cmake.install`
   */
  async install(): Promise<number> { return this.build('install'); }

  /**
   * Implementation of `cmake.stop`
   */
  async stop(): Promise<boolean> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      return false;
    }

    return drv.stopCurrentProcess();
  }

  /**
   * Implementation of `cmake.setVariant`
   */
  async setVariant() {
    const ret = await this._variantManager.selectVariant();
    if (ret) {
      await this.configure();
    }
    return ret;
  }

  /**
   * The target that will be built with a regular build invocation
   */
  public get defaultBuildTarget(): string|null { return this._stateManager.defaultBuildTarget; }
  private async _setDefaultBuildTarget(v: string) {
    this._stateManager.defaultBuildTarget = v;
    this._statusBar.targetName = v || await this.allTargetName;
  }

  /**
   * Set the default target to build. Implementation of `cmake.setDefaultTarget`
   * @param target If specified, set this target instead of asking the user
   */
  async setDefaultTarget(target?: string|null) {
    if (!target) {
      target = await this.showTargetSelector();
    }
    if (!target) {
      return;
    }
    await this._setDefaultBuildTarget(target);
  }

  /**
   * Implementation of `cmake.selectLaunchTarget`
   */
  async selectLaunchTarget(): Promise<string|null> {
    const executableTargets = await this.executableTargets;
    if (executableTargets.length === 0) {
      vscode.window.showWarningMessage('There are no known executable targets to choose from');
      return null;
    }

    const choices = executableTargets.map(e => ({
                                            label : e.name,
                                            description : '',
                                            detail : e.path,
                                          }));
    const chosen = await vscode.window.showQuickPick(choices);
    if (!chosen) {
      return null;
    }
    this._stateManager.launchTargetName = chosen.label;
    this._statusBar.setLaunchTargetName(chosen.label);
    return chosen.detail;
  }

  /**
   * Implementation of `cmake.launchTargetPath`
   */
  async launchTargetPath(): Promise<string|null> {
    const target_name = this._stateManager.launchTargetName;
    const chosen = (await this.executableTargets).find(e => e.name == target_name);
    if (!chosen) {
      return null;
    }
    return chosen.path;
  }

  launchTargetProgramPath(): Promise<string|null> { return this.launchTargetPath(); }

  /**
   * Implementation of `cmake.debugTarget`
   */
  async debugTarget(): Promise<vscode.DebugSession|null> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      vscode.window.showErrorMessage('Set up and build your CMake project before debugging.');
      return null;
    }
    if (drv instanceof LegacyCMakeDriver) {
      vscode.window.showWarningMessage('Target debugging is no longer supported with the legacy driver');
      return null;
    }
    const target_name = this._stateManager.launchTargetName;
    const target_path = await this.launchTargetPath();
    if (!target_path) {
      vscode.window.showWarningMessage('No target selected for debugging');
      return null;
    }
    const is_msvc
        = drv.compilerID ? drv.compilerID.includes('MSVC') : (drv.linkerID ? drv.linkerID.includes('MSVC') : false);
    const debug_config: vscode.DebugConfiguration = {
      type : is_msvc ? 'cppvsdbg' : 'cppdbg',
      name : `Debug target: ${target_name}`,
      request : 'launch',
      cwd : '${workspaceRoot}',
      args : [],
      MIMode : process.platform == 'darwin' ? 'lldb' : 'gdb',
    };
    const user_config = config.debugConfig;
    Object.assign(debug_config, user_config);
    debug_config.program = target_path;
    await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], debug_config);
    return vscode.debug.activeDebugSession!;
  }

  private _launchTerminal: vscode.Terminal|null;

  /**
   * Implementation of `cmake.launchTarget`
   */
  async launchTarget() {
    const target_name = this._stateManager.launchTargetName;
    const target_path = await this.launchTargetPath();
    if (!target_path || !target_name) {
      vscode.window.showWarningMessage('No target selected for launching');
      return null;
    }
    if (!this._launchTerminal)
      this._launchTerminal = vscode.window.createTerminal("CMake/Launch");
    this._launchTerminal.sendText(target_path);
    this._launchTerminal.show();
    return this._launchTerminal;
  }

  /**
   * Implementation of `cmake.quickStart`
   */
  public async quickStart(): Promise<Number> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      vscode.window.showErrorMessage('CMake driver is not yet ready.');
      return -2;
    }

    if (await fs.exists(drv.mainListFile)) {
      vscode.window.showErrorMessage('This workspace already contains a CMakeLists.txt!');
      return -1;
    }

    const project_name = await vscode.window.showInputBox({
      prompt : 'Enter a name for the new project',
      validateInput : (value: string) : string => {
        if (!value.length)
          return 'A project name is required';
        return '';
      },
    });
    if (!project_name)
      return -1;

    const target_type = (await vscode.window.showQuickPick([
      {
        label : 'Library',
        description : 'Create a library',
      },
      {label : 'Executable', description : 'Create an executable'}
    ]));

    if (!target_type)
      return -1;

    const type = target_type.label;

    const init = [
      'cmake_minimum_required(VERSION 3.0.0)',
      `project(${project_name} VERSION 0.1.0)`,
      '',
      'include(CTest)',
      'enable_testing()',
      '',
      type == 'Library' ? `add_library(${project_name} ${project_name}.cpp)`
                        : `add_executable(${project_name} main.cpp)`,
      '',
      'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
      'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
      'include(CPack)',
      '',
    ].join('\n');

    const source_dir = await this.sourceDir;

    if (type === 'Library') {
      if (!(await fs.exists(path.join(source_dir, project_name + '.cpp')))) {
        await fs.writeFile(path.join(source_dir, project_name + '.cpp'), [
          '#include <iostream>',
          '',
          'void say_hello(){',
          `    std::cout << "Hello, from ${project_name}!\\n";`,
          '}',
          '',
        ].join('\n'));
      }
    } else {
      if (!(await fs.exists(path.join(source_dir, 'main.cpp')))) {
        await fs.writeFile(path.join(source_dir, 'main.cpp'), [
          '#include <iostream>',
          '',
          'int main(int, char**) {',
          '   std::cout << "Hello, world!\\n";',
          '}',
          '',
        ].join('\n'));
      }
    }
    const main_list_file = await this.mainListFile;
    await fs.writeFile(main_list_file, init);
    const doc = await vscode.workspace.openTextDocument(main_list_file);
    await vscode.window.showTextDocument(doc);
    return this.configure();
  }

  /**
   * Implementation of `cmake.resetState`
   */
  async resetState() {
    this._stateManager.reset();
    vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  private async _handleCacheEditorMessage(method: string, params: {[key: string]: any}): Promise<any> {
    switch (method) {
    case 'getEntries': {
      const drv = await this.getCMakeDriverInstance();
      if (!drv) {
        return null;
      }
      return drv.cmakeCacheEntries;
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

  get sourceDir() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.sourceDir
    });
  }

  get mainListFile() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.mainListFile
    });
  }

  get binaryDir() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.binaryDir
    });
  }

  get cachePath() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.cachePath
    });
  }

  get targets() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return [];
      }
      return d.targets
    });
  }

  get executableTargets() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return [];
      }
      return d.executableTargets
    });
  }

  get diagnostics() { return Promise.resolve(this._configureDiagnostics); }

  async jumpToCacheFile() {
    // Do nothing.
    return null;
  }

  async setBuildType() {
    // Do nothing
    return -1;
  }

  async selectEnvironments() { return null; }
}

export default CMakeTools;