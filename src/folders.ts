/**
 * Class for managing workspace folders
 */ /** */

import CMakeTools from '@cmt/cmake-tools';
import { KitsController } from '@cmt/kitsController';
import rollbar from '@cmt/rollbar';
import { disposeAll } from '@cmt/util';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as util from './util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class CMakeToolsFolder {
  private constructor(readonly cmakeTools: CMakeTools, readonly kitsController: KitsController) { }

  static async init(cmakeTools: CMakeTools) {
    return new CMakeToolsFolder(cmakeTools, await KitsController.init(cmakeTools));
  }

  get folder() { return this.cmakeTools.folder; }

  dispose() {
    this.cmakeTools.dispose();
    this.kitsController.dispose();
  }
}

export class CMakeToolsFolderController implements vscode.Disposable {
  private readonly _instances = new Map<string, CMakeToolsFolder>();

  private readonly _beforeAddFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
  private readonly _afterAddFolderEmitter = new vscode.EventEmitter<CMakeToolsFolder>();
  private readonly _beforeRemoveFolderEmitter = new vscode.EventEmitter<CMakeToolsFolder>();
  private readonly _afterRemoveFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
  private readonly _subscriptions: vscode.Disposable[] = [
    this._beforeAddFolderEmitter,
    this._afterAddFolderEmitter,
    this._beforeRemoveFolderEmitter,
    this._afterRemoveFolderEmitter,
  ];

  get onBeforeAddFolder() { return this._beforeAddFolderEmitter.event; }
  get onAfterAddFolder() { return this._afterAddFolderEmitter.event; }
  get onBeforeRemoveFolder() { return this._beforeRemoveFolderEmitter.event; }
  get onAfterRemoveFolder() { return this._afterRemoveFolderEmitter.event; }

  /**
   * The active workspace folder. This controls several aspects of the extension,
   * including:
   *
   * - Which CMakeTools backend receives commands from the user
   * - Where we search for variants
   * - Where we search for workspace-local kits
   */
  private _activeFolder?: CMakeToolsFolder;
  get activeFolder() { return this._activeFolder; }
  setActiveFolder(ws: vscode.WorkspaceFolder | undefined) {
    if (ws) {
      this._activeFolder = this.get(ws);
    } else {
      this._activeFolder = undefined;
    }
  }

  get size() { return this._instances.size; }

  get isMultiRoot() { return this.size > 1; }

  constructor(readonly extensionContext: vscode.ExtensionContext) {
    this._subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(
        e => rollbar.invokeAsync(localize('update.workspace.folders', 'Update workspace folders'), () => this._onChange(e))),
    ];
  }

  dispose() { disposeAll(this._subscriptions); }

  /**
   * Get the CMakeTools instance associated with the given workspace folder, or undefined
   * @param ws The workspace folder to search, or array of command and workspace path
   */
  get(ws: vscode.WorkspaceFolder | Array<string> | undefined): CMakeToolsFolder | undefined {
    if (ws) {
      if (util.isArrayOfString(ws)) {
        return this._instances.get(ws[ws.length - 1]);
      } else if (util.isWorkspaceFolder(ws)) {
        const folder = ws as vscode.WorkspaceFolder;
        return this._instances.get(folder.uri.fsPath);
      }
    }
    return undefined;
  }

  /**
   * Load all the folders currently open in VSCode
   */
  async loadAllCurrent() {
    this._instances.forEach(folder => folder.dispose());
    this._instances.clear();
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        await this._addFolder(folder);
      }
    }
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
        this._beforeRemoveFolderEmitter.fire(cmtf);
      }
      await this._removeFolder(folder);
      this._afterRemoveFolderEmitter.fire(folder);
    }
    // Load a new CMake Tools instance for each folder that has been added.
    for (const folder of e.added) {
      this._beforeAddFolderEmitter.fire(folder);
      const cmtf = await this._addFolder(folder);
      this._afterAddFolderEmitter.fire(cmtf);
    }
  }

  /**
   * Load a new CMakeTools for the given workspace folder and remember it.
   * @param folder The workspace folder to load for
   */
  private _loadCMakeToolsForWorkspaceFolder(folder: vscode.WorkspaceFolder) {
    // Create the backend:
    return CMakeTools.createForDirectory(folder, this.extensionContext);
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
      rollbar.error(localize('same.folder.loaded.twice','The same workspace folder was loaded twice'), { wsUri: folder.uri.toString() });
      return existing;
    }
    // Load for the workspace.
    const new_cmt = await this._loadCMakeToolsForWorkspaceFolder(folder);
    // Remember it
    const inst = await CMakeToolsFolder.init(new_cmt);

    this._instances.set(folder.uri.fsPath, inst);

    // initialize kits for the cmake tools
    // Check if the CMakeTools remembers what kit it was last using in this dir:
    const kit_name = new_cmt.workspaceContext.state.activeKitName;
    if (!kit_name) {
      // No prior kit. Done.
      return inst;
    }
    // It remembers a kit. Find it in the kits avail in this dir:
    const kit = inst.kitsController.availableKits.find(k => k.name == kit_name) || null;
    // Set the kit: (May do nothing if no kit was found)
    await new_cmt.setKit(kit);

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
      rollbar.error(localize('removed.folder.not.on.record', 'Workspace folder removed, but not associated with an extension instance'), { wsUri: folder.uri.toString() });
      // Keep the UI running, just don't remove this instance.
      return;
    }
    // Drop the instance from our table. Forget about it.
    this._instances.delete(folder.uri.fsPath);
    // Finally, dispose of the CMake Tools now that the workspace is gone.
    inst.dispose();
  }

  [Symbol.iterator]() { return this._instances.values(); }
}