import * as vscode from 'vscode';
import Rollbar = require('rollbar');


export class RollbarController {
  private _rollbar = new Rollbar({
    accessToken : '14d411d713be4a5a9f9d57660534cac7',
    reportLevel: 'error',
    payload: {
      platform: 'client',
    },
  });

  private _enabled = false;

  constructor(readonly extensionContext: vscode.ExtensionContext) {}

  async requestPermissions() {
    const key = 'rollbar-optin1';
    const optin = this.extensionContext.globalState.get(key);
    if (optin === true) {
      this._enabled = true;
    } else if (optin == false) {
      this._enabled = false;
    } else if (optin === undefined) {
      const item = await vscode.window.showInformationMessage(
          "Would you like to opt-in to send anonymous error and exception data to help improve CMake Tools?",
          { title: 'Yes!', isCloseAffordance: true, } as vscode.MessageItem,
          { title: 'No Thanks', isCloseAffordance: false, } as vscode.MessageItem);

      if (item === undefined) {
        return;
      }
      this.extensionContext.globalState.update(key, !item.isCloseAffordance);
      this._enabled = !item.isCloseAffordance
    }
  }

  exception(what: string, exception: Error, additional: object = {}): Rollbar.LogResult | null {
    if (this._enabled) {
      return this._rollbar.error(what, exception, additional);
    }
    return null;
  }

  error(what: string, additional: object = {}): Rollbar.LogResult | null {
    if (this._enabled) {
      return this._rollbar.error(what, additional);
    }
    return null;
  }
}
