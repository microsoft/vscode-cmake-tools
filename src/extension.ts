/**
 * Extension startup/teardown
 */ /** */

'use strict';

require('module-alias/register');

import * as vscode from 'vscode';
import * as path from 'path';
import * as logging from './logging';
import * as util from './util';

const log = logging.createLogger('extension');

// import * as api from './api';
// import { CMakeToolsWrapper } from './wrapper';
// import { log } from './logging';
// import { outputChannels } from "./util";

import CMakeTools from './cmake-tools';
import rollbar from './rollbar';
import {DirectoryContext} from '@cmt/workspace';
import {StateManager} from '@cmt/state';
import {Kit, readKitsFile, scanForKits, descriptionForKit, USER_KITS_FILEPATH} from '@cmt/kit';
import {fs} from '@cmt/pr';
import {MultiWatcher} from '@cmt/watcher';
import {ConfigurationReader} from '@cmt/config';
import paths from '@cmt/paths';

/**
 * A class to manage the extension.
 *
 * Yeah, yeah. It's another "Manager", but this is to be the only one.
 *
 * This is the true "singleton" of the extension. It acts as the glue between
 * the lower layers and the VSCode UX. When a user presses a button to
 * necessitate user input, this class acts as intermediary and will send
 * important information down to the lower layers.
 */
class ExtensionManager implements vscode.Disposable {
  constructor(public readonly extensionContext: vscode.ExtensionContext) {}

  /**
   * Subscription to workspace changes.
   *
   * When a workspace is added or removed, the instances of CMakeTools are
   * update to match the new state.
   *
   * For each workspace folder, a separate instance of CMake Tools is
   * maintained. This allows each folder to both share configuration as well as
   * keep its own separately.
   */
  private readonly _subWorkspaceFoldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(
      e => rollbar.invokeAsync('Update workspace folders', () => this._workspaceFoldersChanged(e)));

  private async _workspaceFoldersChanged(e: vscode.WorkspaceFoldersChangeEvent) {
    // Un-register each CMake Tools we have loaded for each removed workspace
    for (const removed of e.removed) {
      const inst = this._cmakeToolsInstances.get(removed.name);
      if (!inst) {
        // CMake Tools should always be aware of all workspace folders. If we
        // somehow missed one, that's a bug
        rollbar.error('Workspace folder removed, but not associated with an extension instance',
                      {wsName: removed.name});
        // Keep the UI running, just don't remove this instance.
        continue;
      }
      // If the removed workspace is the active one, reset the active instance.
      if (inst === this._activeCMakeTools) {
        this._activeWorkspace = null;
        // Forget about the workspace
        await this._setActiveWorkspace(null);
      }
      // Drop the instance from our table. Forget about it.
      this._cmakeToolsInstances.delete(removed.name);
      // Finally, dispose of the CMake Tools now that the workspace is gone.
      await inst.asyncDispose();
    }
    // Load a new CMake Tools instance for each folder that has been added.
    for (const added of e.added) {
      await this.loadForWorkspaceFolder(added);
    }
  }

  /**
   * The CMake Tools backend instances available in the extension. The reason
   * for multiple is so that each workspace folder may have its own unique instance
   */
  private readonly _cmakeToolsInstances: Map<string, CMakeTools> = new Map();

  /**
   * The active workspace folder. This controls several aspects of the extension,
   * including:
   *
   * - Which CMakeTools backend receives commands from the user
   * - Where we search for variants
   * - Where we search for workspace-local kits
   */
  private _activeWorkspace: vscode.WorkspaceFolder|null = null;

  /**
   * The CMake Tools instance associated with the current workspace folder, or
   * `null` if no folder is open.
   */
  private get _activeCMakeTools(): CMakeTools|null {
    if (this._activeWorkspace) {
      const ret = this._cmakeToolsInstances.get(this._activeWorkspace.name);
      if (!ret) {
        rollbar.error('No active CMake Tools attached to the current workspace. Impossible!');
        return null;
      }
      return ret;
    }
    return null;
  }

  private async _ensureActiveKit(): Promise<boolean> {
    const cmt = this._activeCMakeTools;
    if (!cmt) {
      return false;
    }
    if (cmt.activeKit) {
      return true;
    }
    const did_choose_kit = await this.selectKit();
    if (!did_choose_kit) {
      return false;
    }
    return !!cmt.activeKit;
  }

  /**
   * Dispose of the CMake Tools extension.
   *
   * If you can, prefer to call `asyncDispose`, which awaits on the children.
   */
  dispose() { rollbar.invokeAsync('Dispose of CMake Tools', () => this.asyncDispose()); }

  /**
   * Asynchronously dispose of all the child objects.
   */
  async asyncDispose() {
    this._subWorkspaceFoldersChanged.dispose();
    this._kitsWatcher.dispose();
    this._editorWatcher.dispose();
    // Dispose of each CMake Tools we still have loaded
    for (const cmt of this._cmakeToolsInstances.values()) {
      await cmt.asyncDispose();
    }
  }

  /**
   * Create a new instance of the backend to support the given workspace folder.
   * The given folder *must not* already be loaded.
   * @param ws The workspace folder to load for
   * @returns The newly created CMakeTools backend for the given folder
   */
  async loadForWorkspaceFolder(ws: vscode.WorkspaceFolder): Promise<CMakeTools> {
    // Check that we aren't double-loading for this workspace. That would be bad...
    if (this._cmakeToolsInstances.has(ws.name)) {
      rollbar.error('Double-loaded CMake Tools instance for workspace folder', {wsUri: ws.uri.toString()});
      // Not even sure how to best handle this...
      return this._cmakeToolsInstances.get(ws.name)!;
    }
    // Create the directory context
    const dirCtx = DirectoryContext.createForDirectory(ws.uri.fsPath, new StateManager(this.extensionContext));
    // Load up a new instance of the backend:
    const new_cmt = await CMakeTools.create(this.extensionContext, dirCtx);
    // Save the instance:
    this._cmakeToolsInstances.set(ws.name, new_cmt);
    // If we didn't have anything active, mark the freshly loaded instance as active
    if (this._activeWorkspace === null) {
      await this._setActiveWorkspace(ws);
    }
    // Return the newly created instance
    return new_cmt;
  }

  /**
   * Set the active workspace folder. This reloads a lot of differnt bits and
   * pieces to control which backend has control and receives user input.
   * @param ws The workspace to activate
   */
  private async _setActiveWorkspace(ws: vscode.WorkspaceFolder|null) {
    this._activeWorkspace = ws;
    this._kitsWatcher.dispose();
    if (ws) {
      const inst = this._cmakeToolsInstances.get(ws.name);
      if (!inst) {
        rollbar.error('No CMake Tools instance ready for the active workspace. Impossible!',
                      {wsUri: ws.uri.toString()});
        return;
      }
      console.assert(this._workspaceKitsPath, 'No kits path for workspace?');
      this._kitsWatcher = new MultiWatcher(USER_KITS_FILEPATH, this._workspaceKitsPath!);
    } else {
      this._kitsWatcher = new MultiWatcher(USER_KITS_FILEPATH);
    }
    this._kitsWatcher.onAnyEvent(_ => rollbar.invokeAsync('Re-reading kits', () => this._rereadKits()));
    await this._rereadKits();
  }

  /**
   * The path to the workspace-local kits file, dependent on the path to the
   * active workspace folder.
   */
  private get _workspaceKitsPath(): string|null {
    if (this._activeWorkspace) {
      return path.join(this._activeWorkspace.uri.fsPath, '.vscode/cmake-kits.json');
    }
    return null;
  }

  /**
   * The kits available from the user-local kits file
   */
  private _userKits: Kit[] = [];

  /**
   * The kits available from the workspace kits file
   */
  private _wsKits: Kit[] = [];

  private _kitsWatcher: MultiWatcher = new MultiWatcher(USER_KITS_FILEPATH);

  private readonly _editorWatcher = vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.uri.fsPath === USER_KITS_FILEPATH) {
      rollbar.takePromise('Re-reading kits on text edit', {}, this._rereadKits());
    } else if (this._workspaceKitsPath && doc.uri.fsPath === this._workspaceKitsPath) {
      rollbar.takePromise('Re-reading kits on text edit', {}, this._rereadKits());
    } else {
      // Ignore
    }
  });

  private get _allKits(): Kit[] { return this._userKits.concat(this._wsKits); }

  /**
   * Reload the list of available kits from the filesystem. This will also
   * update the kit loaded into the current backend if applicable.
   */
  private async _rereadKits() {
    const user = await readKitsFile(USER_KITS_FILEPATH);
    let workspace: Kit[] = [];
    if (this._workspaceKitsPath) {
      workspace = await readKitsFile(this._workspaceKitsPath);
    }
    user.push({name: '__unspec__'});
    await this._setKits({user, workspace});
    this._startPruneOutdatedKitsAsync();
  }

  private async _setKits(opts: {user: Kit[], workspace: Kit[]}) {
    this._userKits = opts.user;
    this._wsKits = opts.workspace;
    const cmt = this._activeCMakeTools;
    if (cmt) {
      const current = cmt.activeKit;
      if (current) {
        const already_active_kit = this._allKits.find(kit => kit.name === current.name);
        // Set the current kit to the one we have named
        await this._setKit(already_active_kit || null);
      }
    }
  }

  async _setKit(k: Kit|null) {
    const inst = this._activeCMakeTools;
    if (inst) {
      await inst.setKit(k);
    }
  }

  /**
   * Opens a text editor with the user-local `cmake-kits.json` file.
   */
  async editKits() {
    log.debug('Opening TextEditor for', USER_KITS_FILEPATH);
    const doc = await vscode.workspace.openTextDocument(USER_KITS_FILEPATH);
    return vscode.window.showTextDocument(doc);
  }

  /**
   * Rescan the system for kits and save them to the user-local kits file
   */
  async scanForKits() {
    log.debug('Rescanning for kits');
    // Convert the kits into a by-name mapping so that we can restore the ones
    // we know about after the fact.
    // We only save the user-local kits: We don't want to save workspace kits
    // in the user kits file.
    const old_kits_by_name = this._userKits.reduce(
        (acc, kit) => ({...acc, [kit.name]: kit}),
        {} as {[kit: string]: Kit},
    );
    // Determine the MinGW search dirs that are available
    const cmt = this._activeCMakeTools;
    let mingw_dirs: string[];
    if (!cmt) {
      // No CMake Tools, but we can still do a scan.
      const config = ConfigurationReader.loadForPath(process.cwd());
      mingw_dirs = config.mingwSearchDirs;
    } else {
      mingw_dirs = cmt.workspaceContext.config.mingwSearchDirs;
    }
    // Do the actual scan:
    const discovered_kits = await scanForKits({
      minGWSearchDirs: mingw_dirs,
    });
    // Update the new kits we know about.
    const new_kits_by_name = discovered_kits.reduce(
        (acc, kit) => ({...acc, [kit.name]: kit}),
        old_kits_by_name,
    );

    const new_kits = Object.keys(new_kits_by_name).map(k => new_kits_by_name[k]);
    await this._setKits({user: new_kits, workspace: this._wsKits});
    await this._writeUserKitsFile(new_kits);
    this._startPruneOutdatedKitsAsync();
  }

  private async _writeUserKitsFile(kits: Kit[]) {
    log.debug('Saving kits to', USER_KITS_FILEPATH);
    const stripped_kits = kits.filter(k => k.name !== '__unspec__');
    const sorted_kits = stripped_kits.sort((a, b) => {
      if (a.name == b.name) {
        return 0;
      } else if (a.name < b.name) {
        return -1;
      } else {
        return 1;
      }
    });
    try {
      log.debug('Saving new kits to', USER_KITS_FILEPATH);
      await fs.mkdir_p(path.dirname(USER_KITS_FILEPATH));
      await fs.writeFile(USER_KITS_FILEPATH, JSON.stringify(sorted_kits, null, 2));
    } catch (e) {
      interface FailOptions extends vscode.MessageItem {
        do: 'retry' | 'cancel';
      }
      const pr = vscode.window
                     .showErrorMessage<FailOptions>(
                         `Failed to write kits file to disk: ${USER_KITS_FILEPATH}: ${e.toString()}`,
                         {
                           title: 'Retry',
                           do: 'retry',
                         },
                         {
                           title: 'Cancel',
                           do: 'cancel',
                         },
                         )
                     .then(choice => {
                       if (!choice) {
                         return false;
                       }
                       switch (choice.do) {
                       case 'retry':
                         return this.scanForKits();
                       case 'cancel':
                         return false;
                       }
                     });
      rollbar.takePromise('retry-kit-save-fail', {}, pr);
      return false;
    }
  }


  private _startPruneOutdatedKitsAsync() {
    for (const kit of this._userKits) {
      if (kit.keep === true) {
        continue;  // Kit is explicitly marked to be kept
      }
      if (kit.compilers) {
        for (const lang in kit.compilers) {
          const comp_path = kit.compilers[lang];
          let exists_pr: Promise<boolean>;
          if (path.isAbsolute(comp_path)) {
            exists_pr = fs.exists(comp_path);
          } else {
            exists_pr = paths.which(comp_path).then(v => v !== null);
          }
          const pr = exists_pr.then(async exists => {
            if (exists) {
              return;
            }
            // This kit contains a compiler that does not exist. What to do?
            interface UpdateKitsItem extends vscode.MessageItem {
              action: 'remove'|'keep';
            }
            const chosen = await vscode.window.showInformationMessage<UpdateKitsItem>(
                `The kit "${kit.name}" references a non-existent compiler binary [${comp_path}]. ` +
                    `What would you like to do?`,
                {},
                {
                  action: 'remove',
                  title: 'Remove it',
                },
                {
                  action: 'keep',
                  title: 'Keep it',
                },
            );
            if (chosen === undefined) {
              return;
            }
            switch (chosen.action) {
            case 'keep':
              return this._keepOutdatedKit(kit);
            case 'remove':
              return this._removeOutdatedKit(kit);
            }
          });
          rollbar.takePromise(`Pruning kit`, {kit}, pr);
        }
      }
    }
  }

  private async _keepOutdatedKit(kit: Kit) {
    const new_kits = this._userKits.map(k => {
      if (k.name === kit.name) {
        return {...k, keep: true};
      } else {
        return k;
      }
    });
    this._setKits({user: new_kits, workspace: this._wsKits});
    return this._writeUserKitsFile(new_kits);
  }

  private async _removeOutdatedKit(kit: Kit) {
    const new_kits = this._userKits.filter(k => k.name !== kit.name);
    this._setKits({user: new_kits, workspace: this._wsKits});
    return this._writeUserKitsFile(new_kits);
  }

  /**
   * Show UI to allow the user to select an active kit
   */
  async selectKit(): Promise<boolean> {
    log.debug('Start selection of kits. Found', this._allKits.length, 'kits.');

    if (this._allKits.length === 1 && this._allKits[0].name === '__unspec__') {
      interface FirstScanItem extends vscode.MessageItem {
        action: 'scan'|'use-unspec'|'cancel';
      }
      const choices: FirstScanItem[] = [
        {
          title: 'Scan for kits',
          action: 'scan',
        },
        {
          title: 'Do not use a kit',
          action: 'use-unspec',
        },
        {
          title: 'Close',
          isCloseAffordance: true,
          action: 'cancel',
        }
      ];
      const chosen = await vscode.window.showInformationMessage(
          'No CMake kits are available. What would you like to do?',
          {
            modal: true,
          },
          ...choices,
      );
      if (!chosen) {
        return false;
      }
      switch (chosen.action) {
      case 'scan': {
        await this.scanForKits();
        return this.selectKit();
      }
      case 'use-unspec': {
        await this._setKit({name: '__unspec__'});
        return true;
      }
      case 'cancel': {
        return false;
      }
      }
    }

    interface KitItem extends vscode.QuickPickItem {
      kit: Kit;
    }
    log.debug('Opening kit selection QuickPick');
    const items = this._allKits.map(
        (kit): KitItem => ({
          label: kit.name !== '__unspec__' ? kit.name : '[Unspecified]',
          description: descriptionForKit(kit),
          kit,
        }),
    );
    const chosen_kit = await vscode.window.showQuickPick(
        items,
        {
          placeHolder: 'Select a Kit',
        },
    );
    if (chosen_kit === undefined) {
      log.debug('User cancelled Kit selection');
      // No selection was made
      return false;
    } else {
      log.debug('User selected kit ', JSON.stringify(chosen_kit));
      await this._setKit(chosen_kit.kit);
      return true;
    }
  }

  async withCMakeTools<Ret>(def: Ret, fn: (cmt: CMakeTools) => Ret | Thenable<Ret>): Promise<Ret> {
    const cmt = this._activeCMakeTools;
    if (!cmt) {
      vscode.window.showErrorMessage('CMake Tools is not available without an open workspace');
      return Promise.resolve(def);
    }
    if (!await this._ensureActiveKit()) {
      return Promise.resolve(def);
    }
    return Promise.resolve(fn(cmt));
  }

  cleanConfigure() { return this.withCMakeTools(-1, cmt => cmt.cleanConfigure()); }

  configure() { return this.withCMakeTools(-1, cmt => cmt.configure()); }

  build() { return this.withCMakeTools(-1, cmt => cmt.build()); }

  setVariant() { return this.withCMakeTools(false, cmt => cmt.setVariant()); }

  install() { return this.withCMakeTools(-1, cmt => cmt.install()); }

  editCache() { return this.withCMakeTools(undefined, cmt => cmt.editCache()); }

  clean() { return this.withCMakeTools(-1, cmt => cmt.clean()); }

  cleanRebuild() { return this.withCMakeTools(-1, cmt => cmt.cleanRebuild()); }

  buildWithTarget() { return this.withCMakeTools(-1, cmt => cmt.buildWithTarget()); }

  setDefaultTarget() { return this.withCMakeTools(undefined, cmt => cmt.setDefaultTarget()); }

  ctest() { return this.withCMakeTools(-1, cmt => cmt.ctest()); }

  stop() { return this.withCMakeTools(false, cmt => cmt.stop()); }

  quickStart() { return this.withCMakeTools(-1, cmt => cmt.quickStart()); }

  launchTargetPath() { return this.withCMakeTools(null, cmt => cmt.launchTargetPath()); }

  debugTarget() { return this.withCMakeTools(null, cmt => cmt.debugTarget()); }

  launchTarget() { return this.withCMakeTools(null, cmt => cmt.launchTarget()); }

  selectLaunchTarget() { return this.withCMakeTools(null, cmt => cmt.selectLaunchTarget()); }

  resetState() { return this.withCMakeTools(null, cmt => cmt.resetState()); }

  viewLog() { return this.withCMakeTools(null, cmt => cmt.viewLog()); }
}

let _EXT_MANAGER: ExtensionManager|null = null;

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext) {
  const ext = _EXT_MANAGER = new ExtensionManager(context);
  for (const wsf of vscode.workspace.workspaceFolders || []) {
    await ext.loadForWorkspaceFolder(wsf);
  }

  // A register function helps us bind the commands to the extension
  function register<K extends keyof ExtensionManager>(name: K) {
    return vscode.commands.registerCommand(`cmake.${name}`, () => {
      const id = util.randint(1000, 10000);
      const pr = (async () => {
        log.debug(`[${id}]`, `cmake.${name}`, 'started');
        const fn = (ext[name] as Function).bind(ext);
        const ret = await fn();
        try {
          log.debug(`[${id}] cmake.${name} finished (returned ${JSON.stringify(ret)})`);
        } catch (e) { log.debug(`[${id}] cmake.${name} finished (returned an unserializable value)`); }
        return ret;
      })();
      rollbar.takePromise(name, {}, pr);
      return pr;
    });
  }

  // List of functions that will be bound commands
  const funs: (keyof ExtensionManager)[] = [
    'editKits',     'scanForKits',      'selectKit',        'cleanConfigure', 'configure',
    'build',        'setVariant',       'install',          'editCache',      'clean',
    'cleanRebuild', 'buildWithTarget',  'setDefaultTarget', 'ctest',          'stop',
    'quickStart',   'launchTargetPath', 'debugTarget',      'launchTarget',   'selectLaunchTarget',
    'resetState',   'viewLog',
    // 'toggleCoverageDecorations', // XXX: Should coverage decorations be revived?
  ];

  // Register the functions before the extension is done loading so that fast
  // fingers won't cause "unregistered command" errors while CMake Tools starts
  // up. The command wrapper will await on the extension promise.
  for (const key of funs) {
    log.trace(`Register CMakeTools extension command cmake.${key}`);
    context.subscriptions.push(register(key));
  }

  // TODO: Return the extension API
  // context.subscriptions.push(vscode.commands.registerCommand('cmake._extensionInstance', () => cmt));
}

// this method is called when your extension is deactivated
export async function deactivate() {
  log.debug('Deactivate CMakeTools');
  //   outputChannels.dispose();
  if (_EXT_MANAGER) {
    await _EXT_MANAGER.asyncDispose();
  }
}
