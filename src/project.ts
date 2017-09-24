import * as vscode from 'vscode';

import {RollbarController} from './rollbar';
import {KitManager, Kit} from './kit';
import {StateManager} from './state';
import {CMakeDriver} from './driver';
import {LegacyCMakeDriver} from './legacy-driver';

export class CMakeProject implements vscode.Disposable {
  // Let's us submit rollbar messages
  private _rollbar = new RollbarController(this.extensionContext);

  private _stateManager = new StateManager(this.extensionContext);

  /**
   * It's up to the kit manager to do all things related to kits. We only listen
   * to it for kit changes.
   */
  private _kitManager = new KitManager(this._stateManager);
  // We store the active kit here
  private _activeKit: Kit | null = null;

  /**
   * The object in charge of talking to CMake
   */
  private _cmakeDriver: CMakeDriver;

  private constructor(readonly extensionContext: vscode.ExtensionContext) {
    // Handle the active kit changing. We want to do some updates and teardown
    this._kitManager.onActiveKitChanged(kit => {
      this._activeKit = kit;
      if (kit) {
        this._cmakeDriver.setKit(kit);
      }
    });
  }

  // Teardown
  dispose() {
    this._kitManager.dispose();
    if (this._cmakeDriver) {
      this._cmakeDriver.dispose();
    }
  }

  /**
   * Reload/restarts the CMake Driver
   */
  private async _reloadCMakeDriver() {
    if (this._cmakeDriver) {
      await this._cmakeDriver.asyncDispose();
    }
    this._cmakeDriver = await LegacyCMakeDriver.create(this._rollbar);
    if (this._activeKit) {
      await this._cmakeDriver.setKit(this._activeKit);
    }
  }

  // Two-phase initialize
  private async _init() {
    // First, start up Rollbar
    await this._rollbar.requestPermissions();
    // Now start the CMake driver
    await this._reloadCMakeDriver();
    // Start up the kit manager. This will also inject the current kit into
    // the CMake driver
    await this._kitManager.initialize();
  }

  // Static creation, because we never want to hand-out an uninitialized
  // instance
  static async create(ctx: vscode.ExtensionContext): Promise<CMakeProject> {
    const inst = new CMakeProject(ctx);
    await inst._init();
    return inst;
  }

  // Extension command implementations
  editKits() { return this._kitManager.openKitsEditor(); }
  scanForKits() { return this._kitManager.rescanForKits(); }
  selectKit() { return this._kitManager.selectKit(); }
  async configure() {
    while (!this._activeKit) {
      await this.selectKit();
    }
    return this._cmakeDriver.configure();
  }
}
