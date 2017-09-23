import * as vscode from 'vscode';

import {RollbarController} from './rollbar';
import {KitManager, Kit} from './kit';
import {StateManager} from './state';

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

  //
  private constructor(readonly extensionContext: vscode.ExtensionContext) {
    // Handle the active kit changing. We want to do some updates and teardowns
    this._kitManager.onActiveKitChanged(kit => {
      this._activeKit = kit;
    });
  }

  // Teardown
  dispose() { this._kitManager.dispose(); }

  // Two-phase initialize
  private async _init() {
    await this._rollbar.requestPermissions();
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
}
