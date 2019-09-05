/**
 * Extension startup/teardown
 */ /** */

'use strict';

require('module-alias/register');

import * as vscode from 'vscode';
import * as path from 'path';
import * as cpt from 'vscode-cpptools';
import * as logging from './logging';
import * as util from './util';
import {CppConfigurationProvider} from '@cmt/cpptools';
import {CMakeCache} from '@cmt/cache';
import CMakeTools from './cmake-tools';
import rollbar from './rollbar';
import {
  Kit,
  readKitsFile,
  scanForKits,
  descriptionForKit,
  USER_KITS_FILEPATH,
  kitsPathForWorkspaceFolder,
  kitsAvailableInWorkspaceDirectory,
  findCLCompilerPath,
  effectiveKitEnvironment,
  OLD_USER_KITS_FILEPATH,
} from '@cmt/kit';
import {fs} from '@cmt/pr';
import {MultiWatcher} from '@cmt/watcher';
import {ConfigurationReader} from '@cmt/config';
import paths from '@cmt/paths';
import {Strand} from '@cmt/strand';
import {StatusBar} from './status';
import {FireNow} from '@cmt/prop';
import {ProjectOutlineProvider, TargetNode, SourceFileNode} from '@cmt/tree';
import {ProgressHandle, DummyDisposable} from './util';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('extension');

function reportProgress(progress: ProgressHandle|undefined, message: string) {
  if (progress) {
    progress.report({message});
  }
}

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
  private readonly _workspaceFoldersChangedSub = vscode.workspace.onDidChangeWorkspaceFolders(
      e => rollbar.invokeAsync(localize('update.workspace.folders', 'Update workspace folders'), () => this._onWorkspaceFoldersChanged(e)));

  /**
   * Adding/removing workspaces should be serialized. Keep that work in a strand.
   */
  private readonly _wsModStrand = new Strand();

  /**
   * Handle workspace change event.
   * @param e Workspace change event
   */
  private async _onWorkspaceFoldersChanged(e: vscode.WorkspaceFoldersChangeEvent) {
    // Un-register each CMake Tools we have loaded for each removed workspace
    for (const removed of e.removed) {
      await this._removeWorkspaceFolder(removed);
    }
    // Load a new CMake Tools instance for each folder that has been added.
    for (const added of e.added) {
      await this.addWorkspaceFolder(added);
    }
  }

  /**
   * The CMake Tools backend instances available in the extension. The reason
   * for multiple is so that each workspace folder may have its own unique instance
   */
  private readonly _cmakeToolsInstances: Map<string, CMakeTools> = new Map();

  /**
   * The status bar controller
   */
  private readonly _statusBar = new StatusBar();
  // Subscriptions for status bar items:
  private _statusMessageSub: vscode.Disposable = new DummyDisposable();
  private _targetNameSub: vscode.Disposable = new DummyDisposable();
  private _buildTypeSub: vscode.Disposable = new DummyDisposable();
  private _launchTargetSub: vscode.Disposable = new DummyDisposable();
  private _ctestEnabledSub: vscode.Disposable = new DummyDisposable();
  private _testResultsSub: vscode.Disposable = new DummyDisposable();
  private _isBusySub: vscode.Disposable = new DummyDisposable();

  // Watch the code model so that we may update teh tree view
  private _codeModelSub: vscode.Disposable = new DummyDisposable();

  /**
   * The tree data provider
   */
  private readonly _projectOutlineProvider = new ProjectOutlineProvider();
  private readonly _projectOutlineDisposer
      = vscode.window.registerTreeDataProvider('cmake.outline', this._projectOutlineProvider);

  private readonly _configProvider = new CppConfigurationProvider();
  private _cppToolsAPI?: cpt.CppToolsApi;
  private _configProviderRegister?: Promise<void>;

  /**
   * The active workspace folder. This controls several aspects of the extension,
   * including:
   *
   * - Which CMakeTools backend receives commands from the user
   * - Where we search for variants
   * - Where we search for workspace-local kits
   */
  private _activeWorkspaceFolder: vscode.WorkspaceFolder|null = null;

  /**
   * The CMake Tools instance associated with the current workspace folder, or
   * `null` if no folder is open.
   */
  private get _activeCMakeTools(): CMakeTools|null {
    if (this._activeWorkspaceFolder) {
      const ret = this._cmakeToolsForWorkspaceFolder(this._activeWorkspaceFolder);
      if (!ret) {
        rollbar.error(localize('no.active.cmaketools.current.workspace', 'No active CMake Tools attached to the current workspace.'));
        return null;
      }
      return ret;
    }
    return null;
  }

  /**
   * Get the CMakeTools instance associated with the given workspace folder, or `null`
   * @param ws The workspace folder to search
   */
  private _cmakeToolsForWorkspaceFolder(ws: vscode.WorkspaceFolder): CMakeTools|null {
    return this._cmakeToolsInstances.get(ws.name) || null;
  }

  /**
   * Ensure that there is an active kit for the current CMakeTools.
   *
   * @returns `false` if there is not active CMakeTools, or it has no active kit
   * and the user cancelled the kit selection dialog.
   */
  private async _ensureActiveKit(cmt: CMakeTools|null = null): Promise<boolean> {
    if (!cmt) {
      cmt = this._activeCMakeTools;
    }
    if (!cmt) {
      // No CMakeTools. Probably no workspace open.
      return false;
    }
    if (cmt.activeKit) {
      // We have an active kit. We're good.
      return true;
    }
    // No kit? Ask the user what they want.
    const did_choose_kit = await this.selectKit();
    if (!did_choose_kit) {
      // The user did not choose a kit
      return false;
    }
    // Return whether we have an active kit defined.
    return !!cmt.activeKit;
  }

  /**
   * Dispose of the CMake Tools extension.
   *
   * If you can, prefer to call `asyncDispose`, which awaits on the children.
   */
  dispose() { rollbar.invokeAsync(localize('dispose.cmake.tools', 'Dispose of CMake Tools'), () => this.asyncDispose()); }

  /**
   * Asynchronously dispose of all the child objects.
   */
  async asyncDispose() {
    this._disposeSubs();
    this._workspaceFoldersChangedSub.dispose();
    this._kitsWatcher.dispose();
    this._editorWatcher.dispose();
    this._projectOutlineDisposer.dispose();
    if (this._cppToolsAPI) {
      this._cppToolsAPI.dispose();
    }
    // Dispose of each CMake Tools we still have loaded
    for (const cmt of this._cmakeToolsInstances.values()) {
      await cmt.asyncDispose();
    }
  }

  async _postWorkspaceOpen(ws: vscode.WorkspaceFolder, cmt: CMakeTools) {
    let should_configure = cmt.workspaceContext.config.configureOnOpen;
    if (should_configure === null && process.env['CMT_TESTING'] !== '1') {
      interface Choice1 {
        title: string;
        doConfigure: boolean;
      }
      const chosen = await vscode.window.showInformationMessage<Choice1>(
          localize('configure.this.project', 'Would you like to configure this project?'),
          {},
          {title: localize('yes.button', 'Yes'), doConfigure: true},
          {title: localize('not.now.button', 'Not now'), doConfigure: false},
      );
      if (!chosen) {
        // Do nothing. User cancelled
        return;
      }
      const perist_message
          = chosen.doConfigure ?
            localize('always.configure.on.open', 'Always configure projects upon opening?') :
            localize('never.configure.on.open', 'Never configure projects on opening?');
      interface Choice2 {
        title: string;
        persistMode: 'user'|'workspace';
      }
      const persist_pr
          // Try to persist the user's selection to a `settings.json`
          = vscode.window
                .showInformationMessage<Choice2>(
                    perist_message,
                    {},
                    {title: localize('yes.button', 'Yes'), persistMode: 'user'},
                    {title: localize('for.this.workspace.button', 'For this Workspace'), persistMode: 'workspace'},
                    )
                .then(async choice => {
                  if (!choice) {
                    // Use cancelled. Do nothing.
                    return;
                  }
                  const config = vscode.workspace.getConfiguration(undefined, ws.uri);
                  let config_target = vscode.ConfigurationTarget.Global;
                  if (choice.persistMode === 'workspace') {
                    config_target = vscode.ConfigurationTarget.WorkspaceFolder;
                  }
                  await config.update('cmake.configureOnOpen', chosen.doConfigure, config_target);
                });
      rollbar.takePromise(localize('persist.config.on.open.setting', 'Persist config-on-open setting'), {}, persist_pr);
      should_configure = chosen.doConfigure;
    }
    if (should_configure) {
      // We've opened a new workspace folder, and the user wants us to
      // configure it now.
      log.debug(localize('configuring.workspace.on.open', 'Configuring workspace on open {0}', ws.uri.toString()));
      // Ensure that there is a kit. This is required for new instances.
      if (!await this._ensureActiveKit(cmt)) {
        return;
      }
      await cmt.configure();
    }
  }

  /**
   * Create a new instance of the backend to support the given workspace folder.
   * The given folder *must not* already be loaded.
   * @param ws The workspace folder to load for
   * @returns The newly created CMakeTools backend for the given folder
   */
  async addWorkspaceFolder(ws: vscode.WorkspaceFolder, progress?: ProgressHandle): Promise<CMakeTools> {
    return this._wsModStrand.execute(async () => {
      // Check that we aren't double-loading for this workspace. That would be bad...
      const current_cmt = this._cmakeToolsForWorkspaceFolder(ws)!;
      if (current_cmt) {
        rollbar.error(localize('double.loaded.instance', 'Double-loaded CMake Tools instance for workspace folder'), {wsUri: ws.uri.toString()});
        // Not even sure how to best handle this...
        return current_cmt;
      }
      // Load for the workspace.
      reportProgress(progress, localize('creating.backend', 'Creating backend'));
      const new_cmt = await this._loadCMakeToolsForWorkspaceFolder(ws);
      // If we didn't have anything active, mark the freshly loaded instance as active
      if (this._activeWorkspaceFolder === null) {
        await this._setActiveWorkspaceFolder(ws, progress);
      }
      rollbar.takePromise(localize('post.folder.open', 'Post-folder-open'), {folder: ws}, this._postWorkspaceOpen(ws, new_cmt));
      // Return the newly created instance
      return new_cmt;
    });
  }

  /**
   * Load a new CMakeTools for the given workspace folder and remember it.
   * @param ws The workspace folder to load for
   */
  private async _loadCMakeToolsForWorkspaceFolder(ws: vscode.WorkspaceFolder) {
    // New instance
    const new_cmt = await this._createCMakeToolsForWorkspaceFolder(ws);
    // Save the instance:
    this._cmakeToolsInstances.set(ws.name, new_cmt);
    return new_cmt;
  }

  /**
   * Create a new CMakeTools instance for the given WorkspaceFolder
   * @param ws The workspace folder to create for
   */
  private async _createCMakeToolsForWorkspaceFolder(ws: vscode.WorkspaceFolder) {
    // Get the kits that will be available for the new workspace directory
    const ws_kits = await kitsAvailableInWorkspaceDirectory(ws.uri.fsPath);
    // Create the backend:
    const new_cmt = await CMakeTools.createForDirectory(ws.uri.fsPath, this.extensionContext);
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
   * Remove knowledge of the given workspace folder. Disposes of the CMakeTools
   * instance associated with the workspace.
   * @param ws The workspace to remove for
   */
  private _removeWorkspaceFolder(ws: vscode.WorkspaceFolder) {
    // Keep this work in a strand
    return this._wsModStrand.execute(async () => {
      const inst = this._cmakeToolsForWorkspaceFolder(ws);
      if (!inst) {
        // CMake Tools should always be aware of all workspace folders. If we
        // somehow missed one, that's a bug
        rollbar.error(localize('workspace.folder.removed', 'Workspace folder removed, but not associated with an extension instance'), {wsName: ws.name});
        // Keep the UI running, just don't remove this instance.
        return;
      }
      // If the removed workspace is the active one, reset the active instance.
      if (inst === this._activeCMakeTools) {
        // Forget about the workspace
        await this._setActiveWorkspaceFolder(null);
      }
      // Drop the instance from our table. Forget about it.
      this._cmakeToolsInstances.delete(ws.name);
      // Finally, dispose of the CMake Tools now that the workspace is gone.
      await inst.asyncDispose();
    });
  }

  /**
   * Set the active workspace folder. This reloads a lot of different bits and
   * pieces to control which backend has control and receives user input.
   * @param ws The workspace to activate
   */
  private async _setActiveWorkspaceFolder(ws: vscode.WorkspaceFolder|null, progress?: ProgressHandle) {
    if (ws) {
      reportProgress(progress, localize('loading.workspace.folder.name', 'Loading workspace folder {0}', ws.name));
    } else {
      reportProgress(progress, localize('loading.workspace.folder', 'Loading workspace folder'));
    }
    // Keep it in the strand
    // We SHOULD have a CMakeTools instance loaded for this workspace.
    // It should have been added by `addWorkspaceFolder`
    if (ws && !this._cmakeToolsInstances.has(ws.name)) {
      rollbar.error(localize('no.instance.ready.for.active.workspace', 'No CMake Tools instance ready for the active workspace.'), {wsUri: ws.uri.toString()});
      return;
    }
    // Set the new workspace
    this._activeWorkspaceFolder = ws;
    // Drop the old kit watcher on the floor
    this._resetKitsWatcher();
    // Re-read kits for the new workspace:
    await this._rereadKits(progress);
    this._setupSubscriptions();
  }

  private _disposeSubs() {
    for (const sub of [this._statusMessageSub,
                       this._targetNameSub,
                       this._buildTypeSub,
                       this._launchTargetSub,
                       this._ctestEnabledSub,
                       this._testResultsSub,
                       this._isBusySub,
                       this._codeModelSub,
    ]) {
      sub.dispose();
    }
  }

  private _updateCodeModel(cmt: CMakeTools) {
    this._projectOutlineProvider.updateCodeModel(cmt.codeModel, {
      defaultTargetName: cmt.defaultBuildTarget || 'all',
      launchTargetName: cmt.launchTargetName,
    });
    rollbar.invokeAsync(localize('update.code.model.for.cpptools', 'Update code model for cpptools'), {}, async () => {
      if (!this._cppToolsAPI) {
        this._cppToolsAPI = await cpt.getCppToolsApi(cpt.Version.v2);
      }
      if (this._cppToolsAPI && cmt.codeModel && cmt.activeKit) {
        const codeModel = cmt.codeModel;
        const kit = cmt.activeKit;
        const cpptools = this._cppToolsAPI;
        let cache: CMakeCache;
        try {
          cache = await CMakeCache.fromPath(await cmt.cachePath);
        } catch (e) {
          rollbar.exception(localize('filed.to.open.cache.file.on.code.model.update', 'Failed to open CMake cache file on code model update'), e);
          return;
        }
        const drv = await cmt.getCMakeDriverInstance();
        const opts = drv ? drv.expansionOptions : undefined;
        const env = await effectiveKitEnvironment(kit, opts);
        const clCompilerPath = await findCLCompilerPath(env);
        this._configProvider.updateConfigurationData({cache, codeModel, clCompilerPath});
        await this.ensureCppToolsProviderRegistered();
        if (cpptools.notifyReady) {
          cpptools.notifyReady(this._configProvider);
        } else {
          cpptools.didChangeCustomConfiguration(this._configProvider);
        }
      }
    });
  }

  private _setupSubscriptions() {
    this._disposeSubs();
    const cmt = this._activeCMakeTools;
    this._statusBar.setVisible(true);
    if (!cmt) {
      this._statusMessageSub = new DummyDisposable();
      this._targetNameSub = new DummyDisposable();
      this._buildTypeSub = new DummyDisposable();
      this._launchTargetSub = new DummyDisposable();
      this._ctestEnabledSub = new DummyDisposable();
      this._testResultsSub = new DummyDisposable();
      this._isBusySub = new DummyDisposable();
      this._statusBar.setActiveKitName('');
      this._codeModelSub = new DummyDisposable();
    } else {
      this._statusMessageSub = cmt.onStatusMessageChanged(FireNow, s => this._statusBar.setStatusMessage(s));
      this._targetNameSub = cmt.onTargetNameChanged(FireNow, t => {
        this._statusBar.targetName = t;
        this._updateCodeModel(cmt);
      });
      this._buildTypeSub = cmt.onBuildTypeChanged(FireNow, bt => this._statusBar.setBuildTypeLabel(bt));
      this._launchTargetSub = cmt.onLaunchTargetNameChanged(FireNow, t => {
        this._statusBar.setLaunchTargetName(t || '');
        this._updateCodeModel(cmt);
      });
      this._ctestEnabledSub = cmt.onCTestEnabledChanged(FireNow, e => this._statusBar.ctestEnabled = e);
      this._testResultsSub = cmt.onTestResultsChanged(FireNow, r => this._statusBar.testResults = r);
      this._isBusySub = cmt.onIsBusyChanged(FireNow, b => this._statusBar.setIsBusy(b));
      this._statusBar.setActiveKitName(cmt.activeKit ? cmt.activeKit.name : '');
      this._codeModelSub = cmt.onCodeModelChanged(FireNow, () => this._updateCodeModel(cmt));
    }
  }

  /**
   * Drop the current kits watcher and create a new one.
   */
  private _resetKitsWatcher() {
    // Throw the old one away
    this._kitsWatcher.dispose();
    // Determine whether we need to watch the workspace kits file:
    const ws_kits_path = this._workspaceKitsPath;
    this._kitsWatcher = ws_kits_path
        // We have workspace kits:
        ? new MultiWatcher(USER_KITS_FILEPATH, ws_kits_path)
        // No workspace:
        : new MultiWatcher(USER_KITS_FILEPATH);
    // Subscribe to its events:
    this._kitsWatcher.onAnyEvent(_ => rollbar.invokeAsync(localize('rereading.kits', 'Re-reading kits'), () => this._rereadKits()));
  }

  /**
   * The path to the workspace-local kits file, dependent on the path to the
   * active workspace folder.
   */
  private get _workspaceKitsPath(): string|null {
    return this._activeWorkspaceFolder
        // Path present:
        ? kitsPathForWorkspaceFolder(this._activeWorkspaceFolder)
        // No open folder:
        : null;
  }

  /**
   * The kits available from the user-local kits file
   */
  private _userKits: Kit[] = [];

  /**
   * The kits available from the workspace kits file
   */
  private _wsKits: Kit[] = [];

  /**
   * Watches for changes to the kits file
   */
  private _kitsWatcher: MultiWatcher = new MultiWatcher(USER_KITS_FILEPATH);

  /**
   * Watch for text edits. At the moment, this only watches for changes to the
   * kits files, since the filesystem watcher in the `_kitsWatcher` is sometimes
   * unreliable.
   */
  private readonly _editorWatcher = vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.uri.fsPath === USER_KITS_FILEPATH) {
      rollbar.takePromise(localize('rereading.kits.on.edit', 'Re-reading kits on text edit'), {}, this._rereadKits());
    } else if (this._workspaceKitsPath && doc.uri.fsPath === this._workspaceKitsPath) {
      rollbar.takePromise(localize('rereading.kits.on.edit', 'Re-reading kits on text edit'), {}, this._rereadKits());
    } else {
      // Ignore
    }
  });

  /**
   * Get both workspace-local kits and user-local kits
   */
  private get _allKits(): Kit[] { return this._userKits.concat(this._wsKits); }

  /**
   * Reload the list of available kits from the filesystem. This will also
   * update the kit loaded into the current backend if applicable.
   */
  private async _rereadKits(progress?: ProgressHandle) {
    // Migrate kits from old pre-1.1.3 location
    try {
      if (await fs.exists(OLD_USER_KITS_FILEPATH) && !await fs.exists(USER_KITS_FILEPATH)) {
        rollbar.info(localize('migrating.kits.file', 'Migrating kits file'), {from: OLD_USER_KITS_FILEPATH, to: USER_KITS_FILEPATH});
        await fs.mkdir_p(path.dirname(USER_KITS_FILEPATH));
        await fs.rename(OLD_USER_KITS_FILEPATH, USER_KITS_FILEPATH);
      }
    } catch (e) {
      rollbar.exception(localize('failed.to.migrate.kits.file', 'Failed to migrate prior user-local kits file.'),
                        e,
                        {from: OLD_USER_KITS_FILEPATH, to: USER_KITS_FILEPATH});
    }
    // Load user-kits
    reportProgress(progress, localize('loading.kits', 'Loading kits'));
    const user = await readKitsFile(USER_KITS_FILEPATH);
    // Conditionally load workspace kits
    let workspace: Kit[] = [];
    if (this._workspaceKitsPath) {
      workspace = await readKitsFile(this._workspaceKitsPath);
    }
    // Add the special __unspec__ kit for opting-out of kits
    user.push({name: '__unspec__'});
    // Set them as known. May reload the current kit.s
    await this._setKnownKits({user, workspace});
    // Pruning requires user interaction, so it happens fully async
    this._startPruneOutdatedKitsAsync();
  }

  /**
   * Set the kits that are available to the user. May change the active kit.
   * @param opts `user` for user local kits, `workspace` for workspace-local kits
   */
  private async _setKnownKits(opts: {user: Kit[], workspace: Kit[]}) {
    this._userKits = opts.user;
    this._wsKits = opts.workspace;
    const cmt = this._activeCMakeTools;
    if (cmt) {
      const current = cmt.activeKit;
      if (current) {
        const already_active_kit = this._allKits.find(kit => kit.name === current.name);
        // Set the current kit to the one we have named
        await this._setCurrentKit(already_active_kit || null);
      }
    }
  }

  /**
   * Set the current kit in the current CMake Tools instance
   * @param k The kit
   */
  async _setCurrentKit(k: Kit|null) {
    const inst = this._activeCMakeTools;
    const raw_name = k ? k.name : '';
    if (inst) {
      // Generate a message that we will show in the progress notification
      let message = '';
      switch (raw_name) {
      case '':
      case '__unspec__':
        // Empty string/unspec is un-setting the kit:
        message = localize('unsetting.kit', 'Unsetting kit');
        break;
      default:
        // Everything else is just loading a kit:
        message = localize('loading.kit', 'Loading kit {0}', raw_name);
        break;
      }
      rollbar.updatePayload({kit: k});
      // Load the kit into the backend
      await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: message,
          },
          () => inst.setKit(k),
      );
    }
    // Update the status bar
    this._statusBar.setActiveKitName(raw_name);
  }

  /**
   * Opens a text editor with the user-local `cmake-kits.json` file.
   */
  async editKits(): Promise<vscode.TextEditor|null> {
    log.debug(localize('opening.text.editor.for', 'Opening text editor for {0}', USER_KITS_FILEPATH));
    if (!await fs.exists(USER_KITS_FILEPATH)) {
      interface Item extends vscode.MessageItem {
        action: 'scan'|'cancel';
      }
      const chosen = await vscode.window.showInformationMessage<Item>(
          localize('no.kits.file.what.to.do', 'No kits file is present. What would you like to do?'),
          {modal: true},
          {
            title: localize('scan.for.kits.button', 'Scan for kits'),
            action: 'scan',
          },
          {
            title: localize('cancel.button', 'Cancel'),
            isCloseAffordance: true,
            action: 'cancel',
          },
      );
      if (!chosen || chosen.action === 'cancel') {
        return null;
      } else {
        await this.scanForKits();
        return this.editKits();
      }
    }
    const doc = await vscode.workspace.openTextDocument(USER_KITS_FILEPATH);
    return vscode.window.showTextDocument(doc);
  }

  /**
   * Rescan the system for kits and save them to the user-local kits file
   */
  async scanForKits() {
    log.debug(localize('rescanning.for.kits', 'Rescanning for kits'));
    // Convert the kits into a by-name mapping so that we can restore the ones
    // we know about after the fact.
    // We only save the user-local kits: We don't want to save workspace kits
    // in the user kits file.
    const old_kits_by_name = this._userKits.reduce(
        (acc, kit) => ({...acc, [kit.name]: kit}),
        {} as {[kit: string]: Kit},
    );
    // Do the scan:
    const discovered_kits = await scanForKits({minGWSearchDirs: this._getMinGWDirs()});
    // Update the new kits we know about.
    const new_kits_by_name = discovered_kits.reduce(
        (acc, kit) => ({...acc, [kit.name]: kit}),
        old_kits_by_name,
    );

    const new_kits = Object.keys(new_kits_by_name).map(k => new_kits_by_name[k]);
    await this._setKnownKits({user: new_kits, workspace: this._wsKits});
    await this._writeUserKitsFile(new_kits);
    this._startPruneOutdatedKitsAsync();
  }

  /**
   * Get the current MinGW search directories
   */
  private _getMinGWDirs(): string[] {
    const cmt = this._activeCMakeTools;
    if (!cmt) {
      // No CMake Tools, but can guess what settings we want.
      const config = ConfigurationReader.loadForPath(process.cwd());
      return config.mingwSearchDirs;
    } else {
      return cmt.workspaceContext.config.mingwSearchDirs;
    }
  }

  /**
   * Write the given kits the the user-local cmake-kits.json file.
   * @param kits The kits to write to the file.
   */
  private async _writeUserKitsFile(kits: Kit[]) {
    log.debug(localize('saving.kits.to', 'Saving kits to {0}', USER_KITS_FILEPATH));
    // Remove the special __unspec__ kit
    const stripped_kits = kits.filter(k => k.name !== '__unspec__');
    // Sort the kits by name so they always appear in order in the file.
    const sorted_kits = stripped_kits.sort((a, b) => {
      if (a.name == b.name) {
        return 0;
      } else if (a.name < b.name) {
        return -1;
      } else {
        return 1;
      }
    });
    // Do the save.
    try {
      log.debug(localize('saving.new.kits.to', 'Saving new kits to {0}', USER_KITS_FILEPATH));
      // Create the directory where the kits will go
      await fs.mkdir_p(path.dirname(USER_KITS_FILEPATH));
      // Write the file
      await fs.writeFile(USER_KITS_FILEPATH, JSON.stringify(sorted_kits, null, 2));
    } catch (e) {
      // Failed to write the file. What to do...
      interface FailOptions extends vscode.MessageItem {
        do: 'retry' | 'cancel';
      }
      const pr = vscode.window
                     .showErrorMessage<FailOptions>(
                         `Failed to write kits file to disk: ${USER_KITS_FILEPATH}: ${e.toString()}`,
                         {
                           title: localize('retry.button', 'Retry'),
                           do: 'retry',
                         },
                         {
                           title: localize('cancel.button', 'Cancel'),
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
      // Don't block on writing re-trying the write
      rollbar.takePromise('retry-kit-save-fail', {}, pr);
      return false;
    }
  }

  /**
   * User-interactive kit pruning:
   *
   * This function will find all user-local kits that identify files that are
   * no longer present (such as compiler binaries), and will show a popup
   * notification to the user requesting an action.
   *
   * This function will not prune kits that have the `keep` field marked `true`
   *
   * If the user chooses to remove the kit, we call `_removeKit()` and erase it
   * from the user-local file.
   *
   * If the user chooses to keep teh kit, we call `_keepKit()` and set the
   * `keep` field on the kit to `true`.
   *
   * Always returns immediately.
   */
  private _startPruneOutdatedKitsAsync() {
    // Iterate over _user_ kits. We don't care about workspace-local kits
    for (const kit of this._userKits) {
      if (kit.keep === true) {
        // Kit is explicitly marked to be kept
        continue;
      }
      if (!kit.compilers) {
        // We only prune kits with a `compilers` field.
        continue;
      }
      // Accrue a list of promises that resolve to whether a give file exists
      interface FileInfo {
        path: string;
        exists: boolean;
      }
      const missing_paths_prs: Promise<FileInfo>[] = [];
      for (const lang in kit.compilers) {
        const comp_path = kit.compilers[lang];
        // Get a promise that resolve to whether the given path/name exists
        const exists_pr = path.isAbsolute(comp_path)
            // Absolute path, just check if it exists
            ? fs.exists(comp_path)
            // Non-absolute. Check on $PATH
            : paths.which(comp_path).then(v => v !== null);
        // Add it to the list
        missing_paths_prs.push(exists_pr.then(exists => ({exists, path: comp_path})));
      }
      const pr = Promise.all(missing_paths_prs).then(async infos => {
        const missing = infos.find(i => !i.exists);
        if (!missing) {
          return;
        }
        // This kit contains a compiler that does not exist. What to do?
        interface UpdateKitsItem extends vscode.MessageItem {
          action: 'remove'|'keep';
        }
        const chosen = await vscode.window.showInformationMessage<UpdateKitsItem>(
            localize('kit.references.non-existent',
              'The kit "{0}" references a non-existent compiler binary [{1}]. What would you like to do?',
              kit.name, missing.path),
            {},
            {
              action: 'remove',
              title: localize('remove.it.button', 'Remove it'),
            },
            {
              action: 'keep',
              title: localize('keep.it.button', 'Keep it'),
            },
        );
        if (chosen === undefined) {
          return;
        }
        switch (chosen.action) {
        case 'keep':
          return this._keepKit(kit);
        case 'remove':
          return this._removeKit(kit);
        }
      });
      rollbar.takePromise(localize('pruning.kit', "Pruning kit"), {kit}, pr);
    }
  }

  /**
   * Mark a kit to be "kept". This set the `keep` value to `true` and writes
   * re-writes the user kits file.
   * @param kit The kit to mark
   */
  private async _keepKit(kit: Kit) {
    const new_kits = this._userKits.map(k => {
      if (k.name === kit.name) {
        return {...k, keep: true};
      } else {
        return k;
      }
    });
    await this._setKnownKits({user: new_kits, workspace: this._wsKits});
    return this._writeUserKitsFile(new_kits);
  }

  /**
   * Remove a kit from the user-local kits.
   * @param kit The kit to remove
   */
  private async _removeKit(kit: Kit) {
    const new_kits = this._userKits.filter(k => k.name !== kit.name);
    await this._setKnownKits({user: new_kits, workspace: this._wsKits});
    return this._writeUserKitsFile(new_kits);
  }

  private async _checkHaveKits(): Promise<'use-unspec'|'ok'|'cancel'> {
    if (this._allKits.length > 1) {
      // We have kits. Okay.
      return 'ok';
    }
    if (this._allKits[0].name !== '__unspec__') {
      // We should _always_ have an __unspec__ kit.
      rollbar.error(localize('invalid.only.kit', 'Invalid only kit. Expected to find `{0}`', "__unspec__"));
      return 'ok';
    }
    // We don't have any kits defined. Ask the user what to do. This is safe to block
    // because it is a modal dialog
    interface FirstScanItem extends vscode.MessageItem {
      action: 'scan'|'use-unspec'|'cancel';
    }
    const choices: FirstScanItem[] = [
      {
        title: localize('scan.for.kits.button', 'Scan for kits'),
        action: 'scan',
      },
      {
        title: localize('do.not.use.kit.button', 'Do not use a kit'),
        action: 'use-unspec',
      },
      {
        title: localize('close.button', 'Close'),
        isCloseAffordance: true,
        action: 'cancel',
      }
    ];
    const chosen = await vscode.window.showInformationMessage(
        localize('no.kits.available', 'No CMake kits are available. What would you like to do?'),
        {modal: true},
        ...choices,
    );
    if (!chosen) {
      // User closed the dialog
      return 'cancel';
    }
    switch (chosen.action) {
    case 'scan': {
      await this.scanForKits();
      return 'ok';
    }
    case 'use-unspec': {
      await this._setCurrentKit({name: '__unspec__'});
      return 'use-unspec';
    }
    case 'cancel': {
      return 'cancel';
    }
    }
  }

  /**
   * Show UI to allow the user to select an active kit
   */
  async selectKit(): Promise<boolean> {
    log.debug(localize('start.selection.of.kits', 'Start selection of kits. Found {0} kits.', this._allKits.length));

    // Check that we have kits, or if the user doesn't want to use a kit.
    const state = await this._checkHaveKits();
    switch (state) {
    case 'cancel':
      // The user doesn't want to perform any special action
      return false;
    case 'use-unspec':
      // The user chose to use the __unspec__ kit
      return true;
    case 'ok':
      // 'ok' means we have kits defined and should do regular kit selection
      break;
    }

    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('running.in.test.mode', 'Running CMakeTools in test mode. selectKit is disabled.'));
      return false;
    }

    interface KitItem extends vscode.QuickPickItem {
      kit: Kit;
    }
    log.debug(localize('opening.kit.selection', 'Opening kit selection QuickPick'));
    // Generate the quickpick items from our known kits
    const itemPromises = this._allKits.map(
        async (kit): Promise<KitItem> => ({
          label: kit.name !== '__unspec__' ? kit.name : `[${localize('unspecified.kit.name', 'Unspecified')}]`,
          description: await descriptionForKit(kit),
          kit,
        }),
    );
    const items = await Promise.all(itemPromises);
    const chosen_kit = await vscode.window.showQuickPick(items, {placeHolder: localize('select.a.kit.placeholder', 'Select a Kit')});
    if (chosen_kit === undefined) {
      log.debug(localize('user.cancelled.kit.selection', 'User cancelled Kit selection'));
      // No selection was made
      return false;
    } else {
      log.debug(localize('user.selected.kit', 'User selected kit {0}', JSON.stringify(chosen_kit)));
      await this._setCurrentKit(chosen_kit.kit);
      return true;
    }
  }

  /**
   * Set the current kit in the current CMake Tools instance by name of the kit
   */
  async setKitByName(kitName: string) {
    let newKit: Kit | undefined;
    switch (kitName) {
    case '':
    case '__unspec__':
      break;
    default:
      newKit = this._allKits.find(kit => kit.name === kitName);
      break;
    }
    await this._setCurrentKit(newKit || null);
  }

  /**
   * Wraps an operation that requires an open workspace and kit selection. If
   * there is no active CMakeTools (no open workspace) or if the user cancels
   * kit selection, we return the given default value.
   * @param default_ The default return value
   * @param fn The callback
   */
  async withCMakeTools<Ret>(default_: Ret, fn: (cmt: CMakeTools) => Ret | Thenable<Ret>): Promise<Ret> {
    // Check that we have an active CMakeTools instance.
    const cmt = this._activeCMakeTools;
    if (!cmt) {
      vscode.window.showErrorMessage(localize('requires.open.workspace', 'CMake Tools is not available without an open workspace'));
      return Promise.resolve(default_);
    }
    // Ensure that we have a kit available.
    if (!await this._ensureActiveKit()) {
      return Promise.resolve(default_);
    }
    // We have a kit, and we have a CMakeTools. Call the function
    return Promise.resolve(fn(cmt));
  }

  async ensureCppToolsProviderRegistered() {
    if (!this._configProviderRegister) {
      this._configProviderRegister = this._doRegisterCppTools();
    }
    return this._configProviderRegister;
  }

  async _doRegisterCppTools() {
    if (!this._cppToolsAPI) {
      return;
    }
    this._cppToolsAPI.registerCustomConfigurationProvider(this._configProvider);
  }

  // The below functions are all wrappers around the backend.

  cleanConfigure() { return this.withCMakeTools(-1, cmt => cmt.cleanConfigure()); }

  configure() { return this.withCMakeTools(-1, cmt => cmt.configure()); }

  build(name?: string) { return this.withCMakeTools(-1, cmt => cmt.build(name)); }

  setVariant() { return this.withCMakeTools(false, cmt => cmt.setVariant()); }

  install() { return this.withCMakeTools(-1, cmt => cmt.install()); }

  editCache() { return this.withCMakeTools(undefined, cmt => cmt.editCache()); }

  clean() { return this.withCMakeTools(-1, cmt => cmt.clean()); }

  cleanRebuild() { return this.withCMakeTools(-1, cmt => cmt.cleanRebuild()); }

  buildWithTarget() { return this.withCMakeTools(-1, cmt => cmt.buildWithTarget()); }

  /**
   * Compile a single source file.
   * @param file The file to compile. Either a file path or the URI to the file.
   * If not provided, compiles the file in the active text editor.
   */
  async compileFile(file?: string|vscode.Uri) {
    if (file instanceof vscode.Uri) {
      file = file.fsPath;
    }
    if (!file) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return null;
      }
      file = editor.document.uri.fsPath;
    }
    for (const cmt of this._cmakeToolsInstances.values()) {
      const term = await cmt.tryCompileFile(file);
      if (term) {
        return term;
      }
    }
    vscode.window.showErrorMessage(localize('compilation information.not.found', 'Unable to find compilation information for this file'));
  }

  setDefaultTarget(name?: string) { return this.withCMakeTools(undefined, cmt => cmt.setDefaultTarget(name)); }

  ctest() { return this.withCMakeTools(-1, cmt => cmt.ctest()); }

  stop() { return this.withCMakeTools(false, cmt => cmt.stop()); }

  quickStart() { return this.withCMakeTools(-1, cmt => cmt.quickStart()); }

  launchTargetPath() { return this.withCMakeTools(null, cmt => cmt.launchTargetPath()); }

  launchTargetDirectory() { return this.withCMakeTools(null, cmt => cmt.launchTargetDirectory()); }

  buildType() { return this.withCMakeTools(null, cmt => cmt.currentBuildType()); }

  buildDirectory() { return this.withCMakeTools(null, cmt => cmt.buildDirectory()); }

  tasksBuildCommand() { return this.withCMakeTools(null, cmt => cmt.tasksBuildCommand()); }

  debugTarget(name?: string) { return this.withCMakeTools(null, cmt => cmt.debugTarget(name)); }

  launchTarget(name?: string) { return this.withCMakeTools(null, cmt => cmt.launchTarget(name)); }

  selectLaunchTarget(name?: string) { return this.withCMakeTools(null, cmt => cmt.selectLaunchTarget(name)); }

  resetState() { return this.withCMakeTools(null, cmt => cmt.resetState()); }

  viewLog() { return this.withCMakeTools(null, cmt => cmt.viewLog()); }
}

/**
 * The global extension manager. There is only one of these, even if multiple
 * backends.
 */
let _EXT_MANAGER: ExtensionManager|null = null;

async function setup(context: vscode.ExtensionContext, progress: ProgressHandle) {
  reportProgress(progress, localize('initial.setup', 'Initial setup'));
  await util.setContextValue('cmakeToolsActive', true);
  // Load a new extension manager
  const ext = _EXT_MANAGER = new ExtensionManager(context);
  // Add all open workspace folders to the manager.
  for (const wsf of vscode.workspace.workspaceFolders || []) {
    reportProgress(progress, localize('loading.workspace.folder', 'Loading workspace folder {0}', wsf.name));
    await ext.addWorkspaceFolder(wsf, progress);
  }

  // A register function that helps us bind the commands to the extension
  function register<K extends keyof ExtensionManager>(name: K) {
    return vscode.commands.registerCommand(`cmake.${name}`, (...args: any[]) => {
      // Generate a unqiue ID that can be correlated in the log file.
      const id = util.randint(1000, 10000);
      // Create a promise that resolves with the command.
      const pr = (async () => {
        // Debug when the commands start/stop
        log.debug(`[${id}]`, `cmake.${name}`, localize('started', 'started'));
        // Bind the method
        const fn = (ext[name] as Function).bind(ext);
        // Call the method
        const ret = await fn(...args);
        try {
          // Log the result of the command.
          log.debug(localize('cmake.finished.returned', '{0} finished (returned {1})', `[${id}] cmake.${name}`, JSON.stringify(ret)));
        } catch (e) {
          // Log, but don't try to serialize the return value.
          log.debug(localize('cmake.finished.returned.unserializable', '{0} finished (returned an unserializable value)', `[${id}] cmake.${name}`));
        }
        // Return the result of the command.
        return ret;
      })();
      // Hand the promise to rollbar.
      rollbar.takePromise(name, {}, pr);
      // Return the promise so that callers will get the result of the command.
      return pr;
    });
  }

  // List of functions that will be bound commands
  const funs: (keyof ExtensionManager)[] = [
    'editKits',
    'scanForKits',
    'selectKit',
    'setKitByName',
    'cleanConfigure',
    'configure',
    'build',
    'setVariant',
    'install',
    'editCache',
    'clean',
    'cleanRebuild',
    'buildWithTarget',
    'setDefaultTarget',
    'ctest',
    'stop',
    'quickStart',
    'launchTargetPath',
    'launchTargetDirectory',
    'buildType',
    'buildDirectory',
    'debugTarget',
    'launchTarget',
    'selectLaunchTarget',
    'resetState',
    'viewLog',
    'compileFile',
    'tasksBuildCommand'
    // 'toggleCoverageDecorations', // XXX: Should coverage decorations be revived?
  ];

  // Register the functions before the extension is done loading so that fast
  // fingers won't cause "unregistered command" errors while CMake Tools starts
  // up. The command wrapper will await on the extension promise.
  reportProgress(progress, localize('loading.extension.commands', 'Loading extension commands'));
  for (const key of funs) {
    log.trace(localize('register.command', 'Register CMakeTools extension command {0}', `cmake.${key}`));
    context.subscriptions.push(register(key));
  }

  // Util for the special commands to forward to real commands
  function runCommand(key: keyof ExtensionManager, ...args: any[]) {
    return vscode.commands.executeCommand(`cmake.${key}`, ...args);
  }

  context.subscriptions.push(...[
      // Special commands that don't require logging or separate error handling
      vscode.commands.registerCommand('cmake.outline.configure', () => runCommand('configure')),
      vscode.commands.registerCommand('cmake.outline.build', () => runCommand('build')),
      vscode.commands.registerCommand('cmake.outline.stop', () => runCommand('stop')),
      vscode.commands.registerCommand('cmake.outline.clean', () => runCommand('clean')),
      vscode.commands.registerCommand('cmake.outline.cleanConfigure', () => runCommand('cleanConfigure')),
      vscode.commands.registerCommand('cmake.outline.cleanRebuild', () => runCommand('cleanRebuild')),
      // Commands for outline items:
      vscode.commands.registerCommand('cmake.outline.buildTarget',
                                      (what: TargetNode) => runCommand('build', what.name)),
      vscode.commands.registerCommand('cmake.outline.runUtilityTarget',
                                      (what: TargetNode) => runCommand('cleanRebuild', what.name)),
      vscode.commands.registerCommand('cmake.outline.debugTarget',
                                      (what: TargetNode) => runCommand('debugTarget', what.name)),
      vscode.commands.registerCommand('cmake.outline.launchTarget',
                                      (what: TargetNode) => runCommand('launchTarget', what.name)),
      vscode.commands.registerCommand('cmake.outline.setDefaultTarget',
                                      (what: TargetNode) => runCommand('setDefaultTarget', what.name)),
      vscode.commands.registerCommand('cmake.outline.setLaunchTarget',
                                      (what: TargetNode) => runCommand('selectLaunchTarget', what.name)),
      vscode.commands.registerCommand('cmake.outline.revealInCMakeLists',
                                      (what: TargetNode) => what.openInCMakeLists()),
      vscode.commands.registerCommand('cmake.outline.compileFile',
                                      (what: SourceFileNode) => runCommand('compileFile', what.filePath)),
  ]);
}

class SchemaProvider implements vscode.TextDocumentContentProvider {
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const fileName: string = uri.authority;
    const locale: string = util.getLocaleId();
    let localizedFilePath: string = path.join(util.thisExtensionPath(), "dist/schema/", locale, fileName);
    const stat = await fs.stat(localizedFilePath);
    if (!stat || !stat.isFile) {
      localizedFilePath = path.join(util.thisExtensionPath(), fileName);
    }
    return fs.readFile(localizedFilePath, "utf8");
  }
}

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext) {
  // Register a protocol handler to serve localized schemas
  vscode.workspace.registerTextDocumentContentProvider('cmake-tools-schema', new SchemaProvider());

  const packageJSON = util.thisExtensionPackage();
  rollbar.updatePayload({
    environment: 'production',
    packageJSON,
    client: {
      code_version: packageJSON.version,
    },
    platform: process.platform,
  });
  await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: localize('cmake.tools.initializing', 'CMake Tools initializing...'),
        cancellable: false,
      },
      progress => setup(context, progress),
  );

  // TODO: Return the extension API
  // context.subscriptions.push(vscode.commands.registerCommand('cmake._extensionInstance', () => cmt));
}

// this method is called when your extension is deactivated
export async function deactivate() {
  log.debug(localize('deactivate.cmaketools', 'Deactivate CMakeTools'));
  if (_EXT_MANAGER) {
    await _EXT_MANAGER.asyncDispose();
  }
}
