/**
 * Class for managing workspace folders
 */ /** */

import CMakeTools from '@cmt/cmake-tools';
import {Kit, kitsAvailableInWorkspaceDirectory} from '@cmt/kit';
import rollbar from '@cmt/rollbar';
import {disposeAll} from '@cmt/util';
import * as vscode from 'vscode';

export class CMakeToolsFolder {
  constructor(readonly cmakeTools: CMakeTools) { }

  get folder() {
    return this.cmakeTools.folder;
  }

  folderKits: Kit[] = [];
  readonly subscriptions: vscode.Disposable[] = [];

  async shutdown() { await this.cmakeTools.shutdown(); }

  dispose() {
    disposeAll(this.subscriptions);
    this.cmakeTools.dispose();
  }
}

export class CMakeToolsFolderController implements vscode.Disposable {
  private readonly _instances = new Map<string, CMakeToolsFolder>();

  private readonly _willAddFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
  private readonly _didAddFolderEmitter = new vscode.EventEmitter<CMakeToolsFolder>();
  private readonly _willRemoveFolderEmitter = new vscode.EventEmitter<CMakeToolsFolder>();
  private readonly _didRemoveFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
  private readonly _subscriptions: vscode.Disposable[] = [
    this._willAddFolderEmitter,
    this._didAddFolderEmitter,
    this._willRemoveFolderEmitter,
    this._didRemoveFolderEmitter,
  ];

  get onWillAddFolder() { return this._willAddFolderEmitter.event; }
  get onDidAddFolder() { return this._didAddFolderEmitter.event; }
  get onWillRemoveFolder() { return this._willRemoveFolderEmitter.event; }
  get onDidRemoveFolder() { return this._didRemoveFolderEmitter.event; }

  constructor(readonly extensionContext: vscode.ExtensionContext) {
    this._subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(
          e => rollbar.invokeAsync('Update workspace folders', () => this._onChange(e))),
    ];
  }

  dispose() { disposeAll(this._subscriptions); }

  /**
   * Get the CMakeTools instance associated with the given workspace folder, or `null`
   * @param ws The workspace folder to search
   */
  get(ws: vscode.WorkspaceFolder): CMakeToolsFolder|undefined { return this._instances.get(ws.name); }

  /**
   * Load all the folders currently open in VSCode
   */
  async loadAllCurrent() {
    for (const wsf of vscode.workspace.workspaceFolders || []) {
      await this.addFolder(wsf);
    }
  }

  /**
   * Activate the given workspace folder
   * @param wsf The folder to add
   */
  addFolder(wsf: vscode.WorkspaceFolder) {
    return this._addFolder(wsf);
  }

  /**
   * Handle workspace change event.
   * @param e Workspace change event
   */
  private async _onChange(e: vscode.WorkspaceFoldersChangeEvent) {
    // Un-register each CMake Tools we have loaded for each removed workspace
    for (const folder of e.removed) {
      const cmtf = this.get(folder);
      if (cmtf) {
        this._willRemoveFolderEmitter.fire(cmtf);
      }
      await this._removeFolder(folder);
      this._didRemoveFolderEmitter.fire(folder);
    }
    // Load a new CMake Tools instance for each folder that has been added.
    for (const folder of e.added) {
      this._willAddFolderEmitter.fire(folder);
      const cmtf = await this._addFolder(folder);
      this._didAddFolderEmitter.fire(cmtf);
    }
  }

  /**
   * Load a new CMakeTools for the given workspace folder and remember it.
   * @param folder The workspace folder to load for
   */
  private async _loadCMakeToolsForWorkspaceFolder(folder: vscode.WorkspaceFolder) {
    // Get the kits that will be available for the new workspace directory
    const ws_kits = await kitsAvailableInWorkspaceDirectory(folder.uri.fsPath);
    // Create the backend:
    const new_cmt = await CMakeTools.createForDirectory(folder, this.extensionContext);
    // Check if the CMakeTools remembers what kit it was last using in this dir:
    const kit_name = new_cmt.workspaceContext.state.activeKitName;
    if (!kit_name) {
      // No prior kit. Done.
      return new_cmt;
    }
    // It remembers a kit. Find it in the kits avail in this dir:
    const kit = ws_kits.find(k => k.name == kit_name) || null;
    // Set the kit: (May do nothing if no kit was found)
    await new_cmt.setKit(kit);
    // Done.
    return new_cmt;
  }

  /**
   * Create a new instance of the backend to support the given workspace folder.
   * The given folder *must not* already be loaded.
   * @param folder The workspace folder to load for
   * @returns The newly created CMakeTools backend for the given folder
   */
  private async _addFolder(folder: vscode.WorkspaceFolder) {
    const existing = this.get(folder);
    if (existing) {
      rollbar.error('Double-loaded CMake Tools instance for workspace folder', {wsUri: folder.uri.toString()});
      // Not even sure how to best handle this...
      return existing;
    }
    // Load for the workspace.
    const new_cmt = await this._loadCMakeToolsForWorkspaceFolder(folder);
    // Remember it
    const inst = new CMakeToolsFolder(new_cmt);
    this._instances.set(folder.name, inst);
    // Return the newly created instance
    return inst;
  }

  /**
   * Remove knowledge of the given workspace folder. Disposes of the CMakeTools
   * instance associated with the workspace.
   * @param folder The workspace to remove for
   */
  private async _removeFolder(folder: vscode.WorkspaceFolder) {
    const inst = this.get(folder);
    if (!inst) {
      // CMake Tools should always be aware of all workspace folders. If we
      // somehow missed one, that's a bug
      rollbar.error('Workspace folder removed, but not associated with an extension instance', {wsName: folder.name});
      // Keep the UI running, just don't remove this instance.
      return;
    }
    // Drop the instance from our table. Forget about it.
    this._instances.delete(folder.name);
    // Finally, dispose of the CMake Tools now that the workspace is gone.
    await inst.shutdown();
    inst.dispose();
  }

  [Symbol.iterator]() { return this._instances.values(); }
}
