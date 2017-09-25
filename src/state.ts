import * as vscode from 'vscode';

/**
 * This class keeps track of all state that needs to persist between sessions
 * within a single workspace. Objects that wish to persist state should store
 * it here to ensure that we keep state consistent.
 *
 * This uses VSCode's Memento objects to ensure consistency. The user cannot
 * easily modify the contents of a Memento, so we can be sure that the contents
 * won't be torn or invalid, unless we make them that way. This class prevents
 * invalid states.
 */
export class StateManager {
  constructor(readonly extensionContext: vscode.ExtensionContext) {}

  /**
   * The name of the workspace-local active kit.
   */
  public get activeKitName(): string | null {
    const kit = this.extensionContext.workspaceState.get<string>('activeKitName');
    return kit || null;
  }
  public set activeKitName(v: string | null) {
    this.extensionContext.workspaceState.update('activeKitName', v);
  }
}