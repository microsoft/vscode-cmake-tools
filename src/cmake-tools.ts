/**
 * Root of the extension
 */
import * as vscode from 'vscode';

import rollbar from './rollbar';
import * as diags from './diagnostics';
import {KitManager} from './kit';
import {VariantManager} from './variant';
import {StateManager} from './state';
import {CMakeDriver} from './driver';
import {LegacyCMakeDriver} from './legacy-driver';
import {StatusBar} from './status';
import config from "./config";

import * as logging from './logging';
import { CTestDriver } from './ctest';

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
export class CMakeTools implements vscode.Disposable {
  /**
   * Construct a new instance. The instance isn't ready, and must be initalized.
   * @param extensionContext The extension context
   *
   * This is private. You must call `create` to get an instance.
   */
  private constructor(readonly extensionContext: vscode.ExtensionContext) {
    // Handle the active kit changing. We want to do some updates and teardown
    log.debug('Constructing new CMakeTools instance');
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
   * The variant manager keeps track of build variants. Has two-phase inti.
   */
  private readonly _variantManager = new VariantManager(this.extensionContext, this._stateManager);

  /**
   * The object in charge of talking to CMake. It starts out as invalid because
   * we don't know what driver to use at the current time. The driver also has
   * two-phase init and a private constructor. The driver may be replaced at
   * any time by the user making changes to the workspace configuration.
   */
  private _cmakeDriver:
      Promise<CMakeDriver> = Promise.reject(new Error('Accessing CMake driver too early!'));

  /**
   * The status bar manager. Has two-phase init.
   */
  private _statusBar: StatusBar = new StatusBar();

  /**
   * Dispose the extension
   */
  dispose() {
    log.debug('Disposing CMakeTools extension');
    rollbar.invoke('Root dispose', () => this.asyncDispose());
  }

  /**
   * Dispose of the extension asynchronously.
   */
  async asyncDispose() {
    this._kitManager.dispose();
    this._diagnostics.dispose();
    const drv = await this._cmakeDriver;
    if (drv) {
      await drv.asyncDispose();
    }
    this._statusBar.dispose();
    this._variantManager.dispose();
  }

  /**
   * Start up a new CMake driver and return it. This is so that the initialization
   * of the driver is atomic to those using it
   */
  private async _startNewCMakeDriver(): Promise<CMakeDriver> {
    log.debug('Loading legacy (non-cmake-server) driver');
    const drv = await LegacyCMakeDriver.create();
    if (this._kitManager.activeKit) {
      log.debug('Pushing active Kit into driver');
      await drv.setKit(this._kitManager.activeKit);
    }
    await drv.setVariantOptions(this._variantManager.activeVariantOptions);
    const project = await drv.projectName;
    if (project) {
      this._statusBar.setProjectName(project);
    }
    drv.onProjectNameChanged(name => { this._statusBar.setProjectName(name); });
    // All set up. Fulfill the driver promise.
    return drv;
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
    this._statusBar.setBuildTypeLabel(this._variantManager.activeVariantOptions.oneWordSummary);
    // Start up the kit manager
    await this._kitManager.initialize();
    this._statusBar.setActiveKitName(this._kitManager.activeKit ? this._kitManager.activeKit.name
                                                                : '');

    // Hook up event handlers
    // Listen for the variant to change
    this._variantManager.onActiveVariantChanged(() => {
      log.debug('Active build variant changed');
      rollbar.invokeAsync('Changing build variant', async() => {
        const drv = await this._cmakeDriver;
        await drv.setVariantOptions(this._variantManager.activeVariantOptions);
        this._statusBar.setBuildTypeLabel(this._variantManager.activeVariantOptions.oneWordSummary);
        // We don't configure yet, since someone else might be in the middle of a configure
      })
    });
    // Listen for the kit to change
    this._kitManager.onActiveKitChanged(kit => {
      log.debug('Active CMake Kit changed:', kit ? kit.name : 'null');
      rollbar.invokeAsync('Changing CMake kit', async() => {
        if (kit) {
          log.debug('Injecting new Kit into CMake driver');
          const drv = await this._cmakeDriver;
          await drv.setKit(kit);
        }
        this._statusBar.setActiveKitName(kit ? kit.name : '');
      });
    });
    this._ctestController.onTestingEnabledChanged(enabled => {
      this._statusBar.ctestEnabled = enabled;
    });
    this._ctestController.onResultsChanged(res => {
      this._statusBar.testResults = res;
    });

    // Finally, start the CMake driver
    const drv = await (this._cmakeDriver = this._startNewCMakeDriver());
    // Reload any test results. This will also update visibility on the status
    // bar
    await this._ctestController.reloadTests(drv);
    this._statusBar.setStatusMessage('Ready');
    this._statusBar.targetName = this.defaultBuildTarget || await this.allTargetName;
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
  private readonly _diagnostics
      = vscode.languages.createDiagnosticCollection('cmake-configure-diags');

  /**
   * Implementation of `cmake.configure`
   */
  configure() {
    return this._doConfigure(async(consumer) => {
      const drv = await this._cmakeDriver;
      return drv.configure(consumer)
    });
  }

  /**
   * Implementation of `cmake.cleanConfigure()
   */
  cleanConfigure() {
    return this._doConfigure(async(consumer) => {
      const drv = await this._cmakeDriver;
      return drv.cleanConfigure(consumer);
    });
  }

  /**
   * Wraps pre/post configure logic around an actual configure function
   * @param cb The actual configure callback. Called to do the configure
   */
  private async _doConfigure(cb: (consumer: diags.CMakeOutputConsumer) => Promise<number>):
      Promise<number> {
    if (!this._kitManager.activeKit) {
      log.debug('No kit selected yet. Asking for a Kit first.');
      await this.selectKit();
    }
    if (!this._kitManager.activeKit) {
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
    const consumer = new diags.CMakeOutputConsumer();
    const retc = await cb(consumer);
    diags.populateCollection(this._diagnostics, consumer.diagnostics);
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
    const drv = await this._cmakeDriver;
    const gen = await drv.generatorName;
    if (gen && (gen.includes('Visual Studio') || gen.toLowerCase().includes('xcode'))) {
      return 'ALL_BUILD';
    } else {
      return 'all';
    }
  }

  /**
   * Implementation of `cmake.build`
   */
  async build(target_?: string): Promise<number> {
    // First, reconfigure if necessary
    const drv = await this._cmakeDriver;
    if (await drv.needsReconfigure) {
      const retc = await this.configure();
      if (retc) {
        return retc;
      }
    } else if (config.clearOutputBeforeBuild) {
      log.clearOutputChannel();
    }
    const target
        = target_ ? target_ : this._stateManager.defaultBuildTarget || await this.allTargetName;
    const consumer = new diags.CMakeBuildConsumer();
    try {
      this._statusBar.setStatusMessage('Building');
      this._statusBar.setVisible(true);
      this._statusBar.setIsBusy(true);
      consumer.onProgress(pr => { this._statusBar.setProgress(pr.value); });
      log.showChannel();
      build_log.info('Starting build');
      const subproc = await drv.build(target, consumer);
      if (!subproc) {
        build_log.error('Build failed to start');
        return -1;
      }
      const rc = (await subproc.result).retc;
      if (rc === null) {
        build_log.info('Build was terminated');
      } else {
        build_log.info('Build finished with exit code', rc);
      }
      return rc === null ? -1 : rc;
    } finally {
      this._statusBar.setIsBusy(false);
      consumer.dispose();
    }
  }

  async buildWithTarget(): Promise<number> {
    const target = await this.showTargetSelector();
    if (target === null)
      return -1;
    return this.build(target);
  }

  async showTargetSelector(): Promise<string | null> {
    const drv = await this._cmakeDriver;
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
    const drv = await this._cmakeDriver;
    // TODO: Pass build configuration type to CTest
    return this._ctestController.runCTest(drv);
  }

  /**
   * Implementation of `cmake.install`
   */
  async install(): Promise<number> { return this.build('install'); }

  /**
   * Implementation of `cmake.stop`
   */
  async stop(): Promise<void> {
    const drv = await this._cmakeDriver;
    await drv.stopCurrentProcess();
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
  public get defaultBuildTarget(): string | null { return this._stateManager.defaultBuildTarget; }
  private async _setDefaultBuildTarget(v: string) {
    this._stateManager.defaultBuildTarget = v;
    this._statusBar.targetName = v || await this.allTargetName;
  }

  /**
   * Set the default target to build. Implementation of `cmake.setDefaultTarget`
   * @param target If specified, set this target instead of asking the user
   */
  async setDefaultTarget(target?: string | null) {
    if (!target) {
      target = await this.showTargetSelector();
    }
    if (!target) {
      return;
    }
    await this._setDefaultBuildTarget(target);
  }
}

export default CMakeTools;