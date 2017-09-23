import * as vscode from 'vscode';

import {RollbarController} from './rollbar';
import {KitManager} from './kit';

export class CMakeProject implements vscode.Disposable {
  private _rollbar = new RollbarController(this.extensionContext);
  private _kitManager = new KitManager(this.extensionContext);
  private constructor(readonly extensionContext: vscode.ExtensionContext) {
    this._kitManager.onKitsChanged(kits => {
      console.log('New kits:');
      kits.map(k => { console.log('  -', k.name); });
    });
  }

  dispose() { this._kitManager.dispose(); }

  // Two-phase initialize
  private async _init() {
    await this._rollbar.requestPermissions();
    await this._kitManager.initialize();
  }

  static async create(ctx: vscode.ExtensionContext): Promise<CMakeProject> {
    const inst = new CMakeProject(ctx);
    await inst._init();
    return inst;
  }

  editKits() {
    return this._kitManager.openKitsEditor();
  }

  scanForKits() {
    return this._kitManager.rescanForKits();
  }
}
