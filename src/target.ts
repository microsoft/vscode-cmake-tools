/**
 * Module for dealing with CMake Targets
 */ /** */

import { CMakeTools } from '@cmt/cmake-tools';
import * as api from '@cmt/api';
import rollbar from '@cmt/rollbar';
import { disposeAll, flatMap } from '@cmt/util';
import * as vscode from 'vscode';

/**
 * Basic information about a target
 */
export interface TargetInformation {
  target: api.Target;
  cmakeTools: CMakeTools;
}

/**
 * Get TargetInformation for the given CMakeTools instance
 * @param cmakeTools The CMakeTools instance to ask about
 */
export async function getTargets(cmakeTools: CMakeTools): Promise<TargetInformation[]> {
  return (await cmakeTools.targets).map(target => ({ cmakeTools, target }));
}

/**
 * Subscription used by `TargetProvider` to keep track of
 */
interface CMakeToolsSubscription {
  cmakeTools: CMakeTools;
  targets: TargetInformation[];
  subscriptions: vscode.Disposable[];
  dispose(): void;
}

/**
 * Target information provider. Register CMakeTools instances with it and then
 * ask it about the targets available.
 */
export class TargetProvider implements vscode.Disposable {
  private _subs = new Map<string, CMakeToolsSubscription>();

  async registerCMakeTools(cmt: CMakeTools) {
    const folder_name = cmt.folderName;
    const disp1 = cmt.onReconfigured(() => this._reload(cmt));
    const disp2 = cmt.onDispose(() => {
      const existing = this._subs.get(folder_name);
      if (!existing) {
        rollbar.error('Dispose for unregistered CMake Tools');
        return;
      }
      existing.dispose();
      this._subs.delete(folder_name);
    });
    // Register the subscrition
    this._subs.set(cmt.folderName, {
      cmakeTools: cmt,
      targets: [],
      subscriptions: [disp1, disp2],
      dispose() { disposeAll(this.subscriptions); }
    });
    // Load the targets already present
    await this._reload(cmt);
  }

  private async _reload(cmt: CMakeTools) {
    const existing = this._subs.get(cmt.folderName);
    if (!existing) {
      rollbar.error('Update on non-registered CMake Tools instance?');
      return;
    }
    existing.targets = await getTargets(cmt);
  }

  /**
   * Get all the targets available for all workspaces
   */
  provideTargets(): TargetInformation[] { return [...flatMap(this._subs.values(), sub => sub.targets)]; }

  dispose() {
    disposeAll(this._subs.values());
    this._subs.clear();
  }
}