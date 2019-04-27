/**
 * Root of the extension
 */
import {CMakeCache} from '@cmt/cache';
import {maybeUpgradeCMake} from '@cmt/cm-upgrade';
import {CMakeExecutable, getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import {CompilationDatabase} from '@cmt/compdb';
import * as debugger_mod from '@cmt/debugger';
import diagCollections from '@cmt/diagnostics/collections';
import * as shlex from '@cmt/shlex';
import {StateManager} from '@cmt/state';
import {Strand} from '@cmt/strand';
import {ProgressHandle, versionToString} from '@cmt/util';
import {DirectoryContext} from '@cmt/workspace';
import * as path from 'path';
import * as vscode from 'vscode';

import * as api from './api';
import {ExecutionOptions, ExecutionResult} from './api';
import {BadHomeDirectoryError, CodeModelContent, NoGeneratorError} from './cms-client';
import {CMakeServerClientDriver} from './cms-driver';
import {CTestDriver} from './ctest';
import {BasicTestResults} from './ctest';
import {CMakeBuildConsumer} from './diagnostics/build';
import {CMakeOutputConsumer} from './diagnostics/cmake';
import {populateCollection} from './diagnostics/util';
import {CMakeDriver} from './driver';
import {expandString, ExpansionOptions} from './expand';
import {Kit} from './kit';
import {LegacyCMakeDriver} from './legacy-driver';
import * as logging from './logging';
import {NagManager} from './nag';
import {fs} from './pr';
import {buildCmdStr} from './proc';
import {Property} from './prop';
import rollbar from './rollbar';
import {setContextValue} from './util';
import {VariantManager} from './variant';

const open = require('open') as ((url: string, appName?: string, callback?: Function) => void);

const log = logging.createLogger('main');
const BUILD_LOGGER = logging.createLogger('build');
const CMAKE_LOGGER = logging.createLogger('cmake');

enum ConfigureType {
  Normal,
  Clean,
}

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

  private readonly _nagManager = new NagManager(this.extensionContext);
  private readonly _nagUpgradeSubscription = this._nagManager.onCMakeLatestVersion(info => {
    this.getCMakeExecutable().then(
        async cmake => {
          if (!cmake.version) {
            log.error('Failed to get version information for CMake during upgarde');
            return;
          }
          await maybeUpgradeCMake(this.extensionContext, {currentVersion: cmake.version, available: info});
        },
        e => { rollbar.exception('Error during CMake upgrade', e, info); },
    );
  });

  /**
   * Construct a new instance. The instance isn't ready, and must be initalized.
   * @param extensionContext The extension context
   *
   * This is private. You must call `create` to get an instance.
   */
  private constructor(readonly extensionContext: vscode.ExtensionContext, readonly workspaceContext: DirectoryContext) {
    // Handle the active kit changing. We want to do some updates and teardown
    log.debug('Constructing new CMakeTools instance');
  }

  // Events that effect the user-interface
  /**
   * The status of this backend
   */
  get statusMessage() { return this._statusMessage.value; }
  get onStatusMessageChanged() { return this._statusMessage.changeEvent; }
  private readonly _statusMessage = new Property<string>('Initializing');

  /**
   * The current target to build.
   */
  get targetName() { return this._targetName.value; }
  get onTargetNameChanged() { return this._targetName.changeEvent; }
  private readonly _targetName = new Property<string>('all');

  /**
   * The current build type
   */
  get buildType() { return this._buildType.value; }
  get onBuildTypeChanged() { return this._buildType.changeEvent; }
  private readonly _buildType = new Property<string>('Unconfigured');

  /**
   * The "launch target" (the target that will be run by debugging)
   */
  get launchTargetName() { return this._launchTargetName.value; }
  get onLaunchTargetNameChanged() { return this._launchTargetName.changeEvent; }
  private readonly _launchTargetName = new Property<string|null>(null);

  /**
   * Whether CTest is enabled
   */
  get ctestEnabled() { return this._ctestEnabled.value; }
  get onCTestEnabledChanged() { return this._ctestEnabled.changeEvent; }
  private readonly _ctestEnabled = new Property<boolean>(false);

  /**
   * The current CTest results
   */
  get testResults() { return this._testResults.value; }
  get onTestResultsChanged() { return this._testResults.changeEvent; }
  private readonly _testResults = new Property<BasicTestResults|null>(null);

  /**
   * Whether the backend is busy running some task
   */
  get isBusy() { return this._isBusy.value; }
  get onIsBusyChanged() { return this._isBusy.changeEvent; }
  private readonly _isBusy = new Property<boolean>(false);

  /**
   * Event fired when the code model from CMake is updated
   */
  get codeModel() { return this._codeModel.value; }
  get onCodeModelChanged() { return this._codeModel.changeEvent; }
  private readonly _codeModel = new Property<CodeModelContent|null>(null);
  private _codeModelDriverSub: vscode.Disposable|null = null;

  /**
   * The variant manager keeps track of build variants. Has two-phase init.
   */
  private readonly _variantManager = new VariantManager(this.workspaceContext.state, this.workspaceContext.config);

  /**
   * A strand to serialize operations with the CMake driver
   */
  private readonly _driverStrand = new Strand();

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
  // private readonly _statusBar_1: StatusBar = new StatusBar();

  /**
   * Dispose the extension
   */
  dispose() {
    log.debug('Disposing CMakeTools extension');
    this._nagUpgradeSubscription.dispose();
    this._nagManager.dispose();
    this._termCloseSub.dispose();
    if (this._launchTerminal)
      this._launchTerminal.dispose();
    rollbar.invokeAsync('Root dispose', () => this.asyncDispose());
  }

  /**
   * Dispose of the extension asynchronously.
   */
  async asyncDispose() {
    diagCollections.reset();
    if (this._cmakeDriver) {
      const drv = await this._cmakeDriver;
      if (drv) {
        await drv.asyncDispose();
      }
    }
    for (const disp of [this._statusMessage,
                        this._targetName,
                        this._buildType,
                        this._ctestEnabled,
                        this._testResults,
                        this._isBusy,
                        this._variantManager,
                        this._ctestController,
    ]) {
      disp.dispose();
    }
  }

  /**
   * Start up a new CMake driver and return it. This is so that the initialization
   * of the driver is atomic to those using it
   */
  private async _startNewCMakeDriver(cmake: CMakeExecutable): Promise<CMakeDriver> {
    const kit = this.activeKit;
    log.debug('Starting CMake driver');
    if (!cmake.isPresent) {
      throw new Error(`Bad CMake executable "${cmake.path}".`);
    }

    let drv: CMakeDriver;
    if (this.workspaceContext.config.useCMakeServer) {
      if (cmake.isServerModeSupported) {
        drv = await CMakeServerClientDriver.create(cmake, this.workspaceContext, kit);
      } else {
        log.warning(
            `CMake Server is not available with the current CMake executable. Please upgrade to CMake
            ${versionToString(cmake.minimalServerModeVersion)} or newer.`);
        drv = await LegacyCMakeDriver.create(cmake, this.workspaceContext, kit);
      }
    } else {
      // We didn't start the server backend, so we'll use the legacy one
      try {
        this._statusMessage.set('Starting CMake Server...');
        drv = await LegacyCMakeDriver.create(cmake, this.workspaceContext, kit);
      } finally { this._statusMessage.set('Ready'); }
    }
    await drv.setVariantOptions(this._variantManager.activeVariantOptions);
    this._targetName.set(this.defaultBuildTarget || drv.allTargetName);
    await this._ctestController.reloadTests(drv);
    // All set up. Fulfill the driver promise.
    return drv;
  }

  /**
   * Event fired after CMake configure runs
   */
  get onReconfigured() { return this._onReconfiguredEmitter.event; }
  private readonly _onReconfiguredEmitter = new vscode.EventEmitter<void>();

  get reconfigured() { return this.onReconfigured; }

  private readonly _onTargetChangedEmitter = new vscode.EventEmitter<void>();
  get targetChangedEvent() { return this._onTargetChangedEmitter.event; }

  async executeCMakeCommand(args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
    const drv = await this.getCMakeDriverInstance();
    if (drv) {
      return drv.executeCommand(drv.cmake.path, args, undefined, options).result;
    } else {
      throw new Error('Unable to execute cmake command, there is no valid cmake driver instance.');
    }
  }

  async execute(program: string, args: string[], options?: ExecutionOptions): Promise<ExecutionResult> {
    const drv = await this.getCMakeDriverInstance();
    if (drv) {
      return drv.executeCommand(program, args, undefined, options).result;
    } else {
      throw new Error('Unable to execute program, there is no valid cmake driver instance.');
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
    this._buildType.set(this._variantManager.activeVariantOptions.short);
    // Restore the debug target
    this._launchTargetName.set(this.workspaceContext.state.launchTargetName || '');

    // Hook up event handlers
    // Listen for the variant to change
    this._variantManager.onActiveVariantChanged(() => {
      log.debug('Active build variant changed');
      rollbar.invokeAsync('Changing build variant', async () => {
        const drv = await this.getCMakeDriverInstance();
        if (drv) {
          await drv.setVariantOptions(this._variantManager.activeVariantOptions);
          this._buildType.set(this._variantManager.activeVariantOptions.short);
          // We don't configure yet, since someone else might be in the middle of a configure
        }
      });
    });
    this._ctestController.onTestingEnabledChanged(enabled => { this._ctestEnabled.set(enabled); });
    this._ctestController.onResultsChanged(res => { this._testResults.set(res); });

    this._statusMessage.set('Ready');

    // Additional, non-extension: Start up nagging.
    this._nagManager.start();
  }

  async setKit(kit: Kit|null) {
    this._activeKit = kit;
    if (kit) {
      log.debug('Injecting new Kit into CMake driver');
      const drv = await this._cmakeDriver;
      if (drv) {
        try {
          this._statusMessage.set('Reloading...');
          await drv.setKit(kit);
        } finally { this._statusMessage.set('Ready'); }
      }
      this.workspaceContext.state.activeKitName = kit.name;
    }
  }

  async getCMakeExecutable() {
    let cmakePath = await this.workspaceContext.cmakePath;
    if (cmakePath === null)
      cmakePath = '';
    return getCMakeExecutableInformation(cmakePath);
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
    return this._driverStrand.execute(async () => {
      if (!this.activeKit) {
        log.debug('Not starting CMake driver: no kits defined');
        return null;
      }

      const cmake = await this.getCMakeExecutable();
      if (!cmake.isPresent) {
        vscode.window.showErrorMessage(`Bad CMake executable "${
            cmake.path}". Is it installed or settings contain the correct path (cmake.cmakePath)?`);
        return null;
      }

      if ((await this._cmakeDriver) === null) {
        log.debug('Starting new CMake driver');
        this._cmakeDriver = this._startNewCMakeDriver(cmake);

        try {
          await this._cmakeDriver;
        } catch (e) {
          this._cmakeDriver = Promise.resolve(null);
          if (e instanceof BadHomeDirectoryError) {
            vscode.window
                .showErrorMessage(
                    `The source directory "${e.expecting}" does not match ` +
                        `the source directory in the CMake cache: ${e.cached}. ` +
                        `You will need to run a clean-configure to configure this project.`,
                    {},
                    {title: 'Clean Configure'},
                    )
                .then(chosen => {
                  if (chosen) {
                    // There was only one choice: to clean-configure
                    rollbar.invokeAsync('Clean reconfigure after bad home dir', async () => {
                      try {
                        await fs.unlink(e.badCachePath);
                      } catch (e2) { log.error('Failed to remove bad cache file: ', e.badCachePath, e2); }
                      try {
                        await fs.rmdir(path.join(path.dirname(e.badCachePath), 'CMakeFiles'));
                      } catch (e2) { log.error('Failed to remove CMakeFiles for cache: ', e.badCachePath, e2); }
                      await this.cleanConfigure();
                    });
                  }
                });
          } else if (e instanceof NoGeneratorError) {
            const message = `Unable to determine what CMake generator to use. ` +
            `Please install or configure a preferred generator, or update settings.json, your Kit configuration or PATH variable.`;
            log.error(message, e);
            vscode.window.showErrorMessage(message);
          } else {
            throw e;
          }
          return null;
        }

        if (this._codeModelDriverSub) {
          this._codeModelDriverSub.dispose();
        }
        const drv = await this._cmakeDriver;
        console.assert(drv !== null, 'Null driver immediately after creation?');
        if (drv instanceof CMakeServerClientDriver) {
          this._codeModelDriverSub = drv.onCodeModelChanged(cm => { this._codeModel.set(cm); });
        }
      }
      return this._cmakeDriver;
    });
  }

  /**
   * Create an instance asynchronously
   * @param ctx The extension context
   *
   * The purpose of making this the only way to create an instance is to prevent
   * us from creating uninitialized instances of the CMake Tools extension.
   */
  static async create(ctx: vscode.ExtensionContext, wsc: DirectoryContext): Promise<CMakeTools> {
    log.debug('Safe constructing new CMakeTools instance');
    const inst = new CMakeTools(ctx, wsc);
    await inst._init();
    log.debug('CMakeTools instance initialization complete.');
    return inst;
  }

  /**
   * Create a new CMakeTools for the given directory.
   * @param dirPath Path to the directory for which to create
   * @param ext The extension context
   */
  static async createForDirectory(dirPath: string, ext: vscode.ExtensionContext): Promise<CMakeTools> {
    // Create a context for the directory
    const dir_ctx = DirectoryContext.createForDirectory(dirPath, new StateManager(ext));
    return CMakeTools.create(ext, dir_ctx);
  }

  /**
   * Implementation of `cmake.viewLog`
   */
  async viewLog() { await logging.showLogFile(); }

  private _activeKit: Kit|null = null;
  get activeKit(): Kit|null { return this._activeKit; }

  /**
   * The compilation database for this driver.
   */
  private _compilationDatabase: CompilationDatabase|null = null;

  private async _refreshCompileDatabase(opts: ExpansionOptions): Promise<void> {
    const compdb_path = path.join(await this.binaryDir, 'compile_commands.json');
    if (await fs.exists(compdb_path)) {
      // Read the compilation database, and update our db property
      const new_db = await CompilationDatabase.fromFilePath(compdb_path);
      this._compilationDatabase = new_db;
      // Now try to copy the compdb to the user-requested path
      const copy_dest = this.workspaceContext.config.copyCompileCommands;
      if (!copy_dest) {
        return;
      }
      const expanded_dest = await expandString(copy_dest, opts);
      const pardir = path.dirname(expanded_dest);
      try {
        await fs.mkdir_p(pardir);
      } catch (e) {
        vscode.window.showErrorMessage(`Tried to copy "${compdb_path}" to "${expanded_dest}", but failed to create ` +
                                       `the parent directory "${pardir}": ${e}`);
        return;
      }
      try {
        await fs.copyFile(compdb_path, expanded_dest);
      } catch (e) {
        // Just display the error. It's the best we can do.
        vscode.window.showErrorMessage(`Failed to copy "${compdb_path}" to "${expanded_dest}": ${e}`);
        return;
      }
    }
  }

  /**
   * Implementation of `cmake.configure`
   */
  configure(extra_args: string[] = [], type: ConfigureType = ConfigureType.Normal): Thenable<number> {
    return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Configuring project',
        },
        async progress => {
          progress.report({message: 'Preparing to configure'});
          log.debug('Run configure ', extra_args);
          return this._doConfigure(progress, async consumer => {
            const drv = await this.getCMakeDriverInstance();
            if (drv) {
              let old_prog = 0;
              const prog_sub = drv.onProgress(pr => {
                const new_prog
                    = 100 * (pr.progressCurrent - pr.progressMinimum) / (pr.progressMaximum - pr.progressMinimum);
                const increment = new_prog - old_prog;
                if (increment >= 1) {
                  old_prog += increment;
                  progress.report({increment});
                }
              });
              try {
                progress.report({message: 'Configuring project'});
                let retc: number;
                switch (type) {
                case ConfigureType.Normal:
                  retc = await drv.configure(extra_args, consumer);
                  break;
                case ConfigureType.Clean:
                  retc = await drv.cleanConfigure(consumer);
                  break;
                default:
                  rollbar.error('Unexpected configure type', {type});
                  retc = await this.configure(extra_args, ConfigureType.Normal);
                  break;
                }
                if (retc === 0) {
                  await this._refreshCompileDatabase(drv.expansionOptions);
                }
                this._onReconfiguredEmitter.fire();
                return retc;
              } finally {
                progress.report({message: 'Finishing configure'});
                prog_sub.dispose();
              }
            } else {
              return -1;
            }
          });
        },
    );
  }

  /**
   * Implementation of `cmake.cleanConfigure()
   */
  cleanConfigure() { return this.configure([], ConfigureType.Clean); }

  /**
   * Save all open files. "maybe" because the user may have disabled auto-saving
   * with `config.saveBeforeBuild`.
   */
  async maybeAutoSaveAll(): Promise<boolean> {
    // Save open files before we configure/build
    if (this.workspaceContext.config.saveBeforeBuild) {
      log.debug('Saving open files before configure/build');
      const save_good = await vscode.workspace.saveAll();
      if (!save_good) {
        log.debug('Saving open files failed');
        const chosen = await vscode.window.showErrorMessage<
            vscode.MessageItem>('Not all open documents were saved. Would you like to continue anyway?',
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

  /**
   * Wraps pre/post configure logic around an actual configure function
   * @param cb The actual configure callback. Called to do the configure
   */
  private async _doConfigure(progress: ProgressHandle,
                             cb: (consumer: CMakeOutputConsumer) => Promise<number>): Promise<number> {
    progress.report({message: 'Saving open files'});
    if (!await this.maybeAutoSaveAll()) {
      return -1;
    }
    if (!this.activeKit) {
      throw new Error('Cannot configure: No kit is active for this CMake Tools');
    }
    if (!this._variantManager.haveVariant) {
      progress.report({message: 'Waiting on variant selection'});
      await this._variantManager.selectVariant();
      if (!this._variantManager.haveVariant) {
        log.debug('No variant selected. Abort configure');
        return -1;
      }
    }
    if (this.workspaceContext.config.clearOutputBeforeBuild) {
      log.clearOutputChannel();
    }
    log.showChannel();
    const consumer = new CMakeOutputConsumer(await this.sourceDir, CMAKE_LOGGER);
    const retc = await cb(consumer);
    populateCollection(diagCollections.cmake, consumer.diagnostics);
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
   * Check if the current project needs to be (re)configured
   */
  private async _needsReconfigure(): Promise<boolean> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv || await drv.checkNeedsReconfigure()) {
      return true;
    } else {
      return false;
    }
  }

  async ensureConfigured(): Promise<number|null> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      return null;
    }
    // First, save open files
    if (!await this.maybeAutoSaveAll()) {
      return -1;
    }
    if (await drv.checkNeedsReconfigure()) {
      log.clearOutputChannel();
      return this.configure();
    } else {
      return null;
    }
  }

  /**
   * Implementation of `cmake.tasksBuildCommand`
   */
  async tasksBuildCommand(): Promise<string|null> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      throw new Error('CMake driver died during tasksBuildCommand');
    }

    const target = this.workspaceContext.state.defaultBuildTarget || await this.allTargetName;
    const buildargs = await drv.getCMakeBuildCommand(target);
    return (buildargs)? buildCmdStr(buildargs.command, buildargs.args) : null;
  }

  /**
   * Implementation of `cmake.build`
   */
  async build(target_?: string): Promise<number> {
    log.debug('Run build', target_ ? target_ : '');
    const config_retc = await this.ensureConfigured();
    if (config_retc === null) {
      // Already configured. Clear console
      log.clearOutputChannel();
    } else if (config_retc !== 0) {
      return config_retc;
    }
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      throw new Error('Impossible: CMake driver died immediately after successful configure');
    }
    const target = target_ ? target_ : this.workspaceContext.state.defaultBuildTarget || await this.allTargetName;
    const consumer = new CMakeBuildConsumer(BUILD_LOGGER);
    const IS_BUILDING_KEY = 'cmake:isBuilding';
    try {
      this._statusMessage.set('Building');
      this._isBusy.set(true);
      return await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Building: ${target}`,
            cancellable: true,
          },
          async (progress, cancel) => {
            let old_progress = 0;
            consumer.onProgress(pr => {
              const increment = pr.value - old_progress;
              if (increment >= 1) {
                progress.report({increment});
                old_progress += increment;
              }
            });
            cancel.onCancellationRequested(() => { rollbar.invokeAsync('Stop on cancellation', () => this.stop()); });
            log.showChannel();
            BUILD_LOGGER.info('Starting build');
            await setContextValue(IS_BUILDING_KEY, true);
            const rc = await drv.build(target, consumer);
            await setContextValue(IS_BUILDING_KEY, false);
            if (rc === null) {
              BUILD_LOGGER.info('Build was terminated');
            } else {
              BUILD_LOGGER.info('Build finished with exit code', rc);
            }
            const file_diags = consumer.compileConsumer.resolveDiagnostics(drv.binaryDir);
            populateCollection(diagCollections.build, file_diags);
            return rc === null ? -1 : rc;
          },
      );
    } finally {
      await setContextValue(IS_BUILDING_KEY, false);
      this._statusMessage.set('Ready');
      this._isBusy.set(false);
      consumer.dispose();
    }
  }

  /**
   * Attempt to execute the compile command associated with the file. If it
   * fails for _any reason_, returns `null`. Otherwise returns the terminal in
   * which the compilation is running
   * @param filePath The path to a file to try and compile
   */
  async tryCompileFile(filePath: string): Promise<vscode.Terminal|null> {
    const config_retc = await this.ensureConfigured();
    if (config_retc !== null && config_retc !== 0) {
      // Config failed?
      return null;
    }
    if (!this._compilationDatabase) {
      return null;
    }
    const cmd = this._compilationDatabase.get(filePath);
    if (!cmd) {
      return null;
    }
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      return null;
    }
    return drv.runCompileCommand(cmd);
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

    vscode.workspace.openTextDocument(vscode.Uri.file(drv.cachePath)).then(doc => {
      vscode.window.showTextDocument(doc);
    });
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
      return (await vscode.window.showInputBox({prompt: 'Enter a target name'})) || null;
    } else {
      const choices = drv.targets.map((t): vscode.QuickPickItem => {
        switch (t.type) {
        case 'named': {
          return {
            label: t.name,
            description: 'Target to build',
          };
        }
        case 'rich': {
          return {label: t.name, description: t.targetType, detail: t.filepath};
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

  private readonly _ctestController = new CTestDriver(this.workspaceContext);
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
    const drv = await this._cmakeDriver;
    if (!drv) {
      return false;
    }

    return drv.stopCurrentProcess().then(() => {
      this._cmakeDriver = Promise.resolve(null);
      return true;
    }, () => false);
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
  public get defaultBuildTarget(): string|null { return this.workspaceContext.state.defaultBuildTarget; }
  private async _setDefaultBuildTarget(v: string) {
    this.workspaceContext.state.defaultBuildTarget = v;
    this._targetName.set(v);
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
  async selectLaunchTarget(name?: string): Promise<string|null> { return this.setLaunchTargetByName(name); }

  /**
   * Used by vscode and as test interface
   */
  async setLaunchTargetByName(name?: string|null) {
    if (await this._needsReconfigure()) {
      const rc = await this.configure();
      if (rc !== 0) {
        return null;
      }
    }
    const executableTargets = await this.executableTargets;
    if (executableTargets.length === 0) {
      return null;
    }

    const choices = executableTargets.map(e => ({
                                            label: e.name,
                                            description: '',
                                            detail: e.path,
                                          }));
    let chosen: {label: string, detail: string}|undefined = undefined;
    if (!name) {
      chosen = await vscode.window.showQuickPick(choices);
    } else {
      chosen = choices.find(choice => choice.label == name);
    }
    if (!chosen) {
      return null;
    }
    this.workspaceContext.state.launchTargetName = chosen.label;
    this._launchTargetName.set(chosen.label);
    return chosen.detail;
  }

  async getCurrentLaunchTarget(): Promise<api.ExecutableTarget|null> {
    const target_name = this.workspaceContext.state.launchTargetName;
    const target = (await this.executableTargets).find(e => e.name == target_name);

    if (!target) {
      return null;
    }
    return target;
  }

  /**
   * Implementation of `cmake.launchTargetPath`
   */
  async launchTargetPath(): Promise<string|null> {
    const executable = await this.prepareLaunchTargetExecutable();
    if (!executable) {
      log.showChannel();
      log.warning('=======================================================');
      log.warning('No executable target was found to launch. Please check:');
      log.warning(' - Have you called add_executable() in your CMake project?');
      log.warning(' - Have you executed a successful CMake configure? ');
      log.warning('No program will be executed');
      return null;
    }
    return executable.path;
  }

  /**
   * Implementation of `cmake.launchTargetDirectory`. It just calls launchTargetPath and
   * extracts the directory form the result.
   */
  async launchTargetDirectory(): Promise<string|null> {
    const targetPath = await this.launchTargetPath();
    if (targetPath === null) {
      return null;
    }
    return path.dirname(targetPath);
  }

  async prepareLaunchTargetExecutable(name?: string): Promise<api.ExecutableTarget|null> {
    let chosen: api.ExecutableTarget;
    if (name) {
      const found = (await this.executableTargets).find(e => e.name === name);
      if (!found) {
        return null;
      }
      chosen = found;
    } else {
      const current = await this.getOrSelectLaunchTarget();
      if (!current) {
        return null;
      }
      chosen = current;
    }

    // Ensure that we've configured the project already. If we haven't, `getOrSelectLaunchTarget` won't see any
    // executable targets and may show an uneccessary prompt to the user
    const isReconfigurationNeeded = await this._needsReconfigure();
    if (isReconfigurationNeeded) {
      const rc = await this.configure();
      if (rc !== 0) {
        log.debug('Configuration of project failed.');
        return null;
      }
    }

    const buildOnLaunch = this.workspaceContext.config.buildBeforeRun;
    if (buildOnLaunch || isReconfigurationNeeded) {
      const rc_build = await this.build(chosen.name);
      if (rc_build !== 0) {
        log.debug('Build failed');
        return null;
      }
    }

    return chosen;
  }

  async getOrSelectLaunchTarget(): Promise<api.ExecutableTarget|null> {
    const current = await this.getCurrentLaunchTarget();
    if (current) {
      return current;
    }
    // Ask the user if we don't already have a target
    await this.selectLaunchTarget();
    return this.getCurrentLaunchTarget();
  }

  /**
   * Implementation of `cmake.debugTarget`
   */
  async debugTarget(name?: string): Promise<vscode.DebugSession|null> {
    const drv = await this.getCMakeDriverInstance();
    if (!drv) {
      vscode.window.showErrorMessage('Set up and build your CMake project before debugging.');
      return null;
    }
    if (drv instanceof LegacyCMakeDriver) {
      vscode.window
          .showWarningMessage('Target debugging is no longer supported with the legacy driver', {
            title: 'Learn more',
            isLearnMore: true,
          })
          .then(item => {
            if (item && item.isLearnMore) {
              open('https://vector-of-bool.github.io/docs/vscode-cmake-tools/debugging.html');
            }
          });
      return null;
    }

    const targetExecutable = await this.prepareLaunchTargetExecutable(name);
    if (!targetExecutable) {
      log.error(`Failed to prepare executable target with name '${name}'`);
      return null;
    }

    let debug_config;
    try {
      const cache = await CMakeCache.fromPath(drv.cachePath);
      debug_config = await debugger_mod.getDebugConfigurationFromCache(cache, targetExecutable, process.platform);
      log.debug('Debug configuration from cache: ', JSON.stringify(debug_config));
    } catch (error) {
      vscode.window
          .showErrorMessage(error.message, {
            title: 'Debugging documentation',
            isLearnMore: true,
          })
          .then(item => {
            if (item && item.isLearnMore) {
              open('https://vector-of-bool.github.io/docs/vscode-cmake-tools/debugging.html');
            }
          });
      log.debug('Problem to get debug from cache.', error);
      return null;
    }

    if (debug_config === null) {
      log.error('Failed to generate debugger configuration');
      vscode.window.showErrorMessage('Unable to generate a debugging configuration.');
      return null;
    }

    // add debug configuration from settings
    const user_config = this.workspaceContext.config.debugConfig;
    Object.assign(debug_config, user_config);
    log.debug('Starting debugger with following configuration.', JSON.stringify({
      workspace: vscode.workspace.workspaceFolders![0].uri.toString(),
      config: debug_config,
    }));
    await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], debug_config);
    return vscode.debug.activeDebugSession!;
  }

  private _launchTerminal?: vscode.Terminal;
  // Watch for the user closing our terminal
  private readonly _termCloseSub = vscode.window.onDidCloseTerminal(term => {
    if (term === this._launchTerminal) {
      this._launchTerminal = undefined;
    }
  });

  /**
   * Implementation of `cmake.launchTarget`
   */
  async launchTarget(name?: string) {
    const executable = await this.prepareLaunchTargetExecutable(name);
    if (!executable) {
      // The user has nothing selected and cancelled the prompt to select
      // a target.
      return null;
    }
    const termOptions: vscode.TerminalOptions = {
      name: 'CMake/Launch',
    };
    if (process.platform == 'win32') {
      // Use cmd.exe on Windows
      termOptions.shellPath = 'C:\\Windows\\System32\\cmd.exe';
    }
    if (!this._launchTerminal)
      this._launchTerminal = vscode.window.createTerminal(termOptions);
    const quoted = shlex.quote(executable.path);
    this._launchTerminal.sendText(quoted);
    this._launchTerminal.show();
    return this._launchTerminal;
  }

  /**
   * Implementation of `cmake.quickStart`
   */
  public async quickStart(): Promise<Number> {
    if (vscode.workspace.workspaceFolders === undefined) {
      vscode.window.showErrorMessage('No folder is open.');
      return -2;
    }

    const sourceDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const mainListFile = path.join(sourceDir, 'CMakeLists.txt');

    if (await fs.exists(mainListFile)) {
      vscode.window.showErrorMessage('This workspace already contains a CMakeLists.txt!');
      return -1;
    }

    const project_name = await vscode.window.showInputBox({
      prompt: 'Enter a name for the new project',
      validateInput: (value: string): string => {
        if (!value.length)
          return 'A project name is required';
        return '';
      },
    });
    if (!project_name)
      return -1;

    const target_type = (await vscode.window.showQuickPick([
      {
        label: 'Library',
        description: 'Create a library',
      },
      {label: 'Executable', description: 'Create an executable'}
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

    if (type === 'Library') {
      if (!(await fs.exists(path.join(sourceDir, project_name + '.cpp')))) {
        await fs.writeFile(path.join(sourceDir, project_name + '.cpp'), [
          '#include <iostream>',
          '',
          'void say_hello(){',
          `    std::cout << "Hello, from ${project_name}!\\n";`,
          '}',
          '',
        ].join('\n'));
      }
    } else {
      if (!(await fs.exists(path.join(sourceDir, 'main.cpp')))) {
        await fs.writeFile(path.join(sourceDir, 'main.cpp'), [
          '#include <iostream>',
          '',
          'int main(int, char**) {',
          '    std::cout << "Hello, world!\\n";',
          '}',
          '',
        ].join('\n'));
      }
    }
    await fs.writeFile(mainListFile, init);
    const doc = await vscode.workspace.openTextDocument(mainListFile);
    await vscode.window.showTextDocument(doc);
    return this.configure();
  }

  /**
   * Implementation of `cmake.resetState`
   */
  async resetState() {
    this.workspaceContext.state.reset();
    vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  get sourceDir() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.sourceDir;
    });
  }

  get mainListFile() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.mainListFile;
    });
  }

  get binaryDir() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.binaryDir;
    });
  }

  get cachePath() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return '';
      }
      return d.cachePath;
    });
  }

  get targets() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return [];
      }
      return d.targets;
    });
  }

  get executableTargets() {
    const drv = this.getCMakeDriverInstance();

    return drv.then(d => {
      if (!d) {
        return [];
      }
      return d.executableTargets;
    });
  }

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
