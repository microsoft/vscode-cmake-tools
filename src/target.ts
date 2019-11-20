/**
 * Module for dealing with CMake Targets
 */ /** */

import { CMakeTools } from '@cmt/cmake-tools';
import * as api from '@cmt/api';
import { disposeAll } from '@cmt/util';
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
 * Target information provider. Ask it about the targets available.
 */
export class TargetProvider implements vscode.Disposable {
  private constructor(private readonly _sub: CMakeToolsSubscription) {}

  static async create(cmt: CMakeTools): Promise<TargetProvider> {
    const targetProvider = new TargetProvider({
      cmakeTools: cmt,
      targets: [],
      subscriptions: [],
      dispose() { disposeAll(this.subscriptions); }
    });
    targetProvider._sub.subscriptions.push(cmt.onReconfigured(() => targetProvider._reload(cmt)));
    // Load the targets already present
    await targetProvider._reload(cmt);
    return targetProvider;
  }

  private async _reload(cmt: CMakeTools) {
    this._sub.targets = await getTargets(cmt);
  }

  /**
   * Get all the targets available for all workspaces
   */
  provideTargets(): TargetInformation[] { return this._sub.targets; }

  dispose() {
    this._sub.dispose();
  }
}