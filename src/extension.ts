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
  findCLCompilerPath,
  effectiveKitEnvironment,
} from '@cmt/kit';
import {fs} from '@cmt/pr';
import {ConfigurationReader} from '@cmt/config';
import paths from '@cmt/paths';
import {Strand} from '@cmt/strand';
import {StatusBar} from './status';
import {FireLate} from '@cmt/prop';
import {ProjectOutlineProvider, TargetNode, SourceFileNode} from '@cmt/tree';
import {ProgressHandle, DummyDisposable} from './util';
import {TargetProvider, TargetInformation, getTargets} from '@cmt/target';
import {CMakeToolsFolderController, CMakeToolsFolder} from '@cmt/folders';

const log = logging.createLogger('extension');

type CMakeToolsMapFn = (cmt: CMakeTools) => Thenable<any>;

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
  private constructor(public readonly extensionContext: vscode.ExtensionContext) {
    this._statusBar.targetName = 'all';
    this._folders.onDidAddFolder(
        info => {
          const new_cmt = info.cmakeTools;
          new_cmt.onCodeModelChanged(FireLate, () => this._updateCodeModel(new_cmt));
          new_cmt.onLaunchTargetNameChanged(FireLate, t => {
            // if (this._activeCMakeTools === new_cmt) {
            //   this._statusBar.setLaunchTargetName(t || '');
            // } XXX: Move launch target logic out of CMakeTools
            this._updateCodeModel(new_cmt);
            this._targetProvider.registerCMakeTools(new_cmt);
            this._projectOutlineProvider.addFolder(info.folder);
            rollbar.takePromise('Post-folder-open', {folder: info.folder}, this._postWorkspaceOpen(info));
          });
        },
    );
  }

  /**
   * Second-phase async init
   */
  private async _init() {
    await this._folders.loadAllCurrent();
  }

  /**
   * Create a new extension manager instance. There must only be one!
   * @param ctx The extension context
   */
  static async create(ctx: vscode.ExtensionContext) {
    const inst = new ExtensionManager(ctx);
    await inst._init();
    return inst;
  }

  /**
   * Adding/removing workspaces should be serialized. Keep that work in a strand.
   */
  private readonly _wsModStrand = new Strand();

  /**
   * The CMake Tools backend instances available in the extension. The reason
   * for multiple is so that each workspace folder may have its own unique instance
   */
  /**
   * The folder controller manages multiple instances. One per folder.
   */
  private readonly _folders = new CMakeToolsFolderController(this.extensionContext);

  /**
   * The status bar controller
   */
  private readonly _statusBar = new StatusBar();
  // Subscriptions for status bar items:
  private _buildTypeSub: vscode.Disposable = new DummyDisposable();
  private _ctestEnabledSub: vscode.Disposable = new DummyDisposable();
  private _testResultsSub: vscode.Disposable = new DummyDisposable();
  private _isBusySub: vscode.Disposable = new DummyDisposable();

  /**
   * The project outline tree data provider
   */
  private readonly _projectOutlineProvider = new ProjectOutlineProvider();
  private readonly _projectOutlineDisposer
      = vscode.window.registerTreeDataProvider('cmake.outline', this._projectOutlineProvider);

  /**
   * CppTools project configuration provider. Tells cpptools how to search for
   * includes, preprocessor defs, etc.
   */
  private readonly _configProvider = new CppConfigurationProvider();
  private _cppToolsAPI?: cpt.CppToolsApi;
  private _configProviderRegister?: Promise<void>;

  /**
   * Get the CMakeTools instance associated with the given workspace folder, or `null`
   * @param ws The workspace folder to search
   */
  private _cmakeToolsForWorkspaceFolder(ws: vscode.WorkspaceFolder): CMakeTools|undefined {
    const inst = this._folders.get(ws);
    if (!inst) {
      return;
    }
    return inst.cmakeTools;
  }

  /**
   * Ensure that there is an active kit for the current CMakeTools.
   *
   * @returns `false` if there is not active CMakeTools, or it has no active kit
   * and the user cancelled the kit selection dialog.
   */
  private async _ensureActiveKit(cmt: CMakeTools): Promise<boolean> {
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
  dispose() { rollbar.invokeAsync('Dispose of CMake Tools', () => this.asyncDispose()); }

  /**
   * Asynchronously dispose of all the child objects.
   */
  async asyncDispose() {
    this._disposeSubs();
    this._editorWatcher.dispose();
    this._projectOutlineDisposer.dispose();
    if (this._cppToolsAPI) {
      this._cppToolsAPI.dispose();
    }
    // Dispose of each CMake Tools we still have loaded
    for (const cmtf of this._folders) {
      await cmtf.cmakeTools.shutdown();
    }
    this._folders.dispose();
  }

  async _postWorkspaceOpen(info: CMakeToolsFolder) {
    const ws = info.folder;
    const cmt = info.cmakeTools;
    let should_configure = cmt.workspaceContext.config.configureOnOpen;
    if (should_configure === null) {
      if (process.env['CMT_TESTING']) {
        return;
      }
      interface Choice1 {
        title: string;
        doConfigure: boolean;
      }
      const chosen = await vscode.window.showInformationMessage<Choice1>(
          'Would you like to configure this project?',
          {},
          {title: 'Yes', doConfigure: true},
          {title: 'Not now', doConfigure: false},
      );
      if (!chosen) {
        // Do nothing. User cancelled
        return;
      }
      const perist_message
          = chosen.doConfigure ? 'Always configure projects upon opening?' : 'Never configure projects on opening?';
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
                    {title: 'Yes', persistMode: 'user'},
                    {title: 'For this Workspace', persistMode: 'workspace'},
                    )
                .then(async choice => {
                  if (!choice) {
                    // Use cancelled. Do nothing.
                    return;
                  }
                  let config: vscode.WorkspaceConfiguration;
                  if (choice.persistMode === 'workspace') {
                    config = vscode.workspace.getConfiguration(undefined, ws.uri);
                  } else {
                    console.assert(choice.persistMode === 'user');
                    config = vscode.workspace.getConfiguration();
                  }
                  await config.update('cmake.configureOnOpen', chosen.doConfigure);
                });
      rollbar.takePromise('Persist config-on-open setting', {}, persist_pr);
      should_configure = chosen.doConfigure;
    }
    if (should_configure) {
      // We've opened a new workspace folder, and the user wants us to
      // configure it now.
      log.debug('Configuring workspace on open ', ws.uri);
      // Ensure that there is a kit. This is required for new instances.
      if (!await this._ensureActiveKit(cmt)) {
        return;
      }
      await cmt.configure();
    }
  }

  // /**
  //  * Create a new instance of the backend to support the given workspace folder.
  //  * The given folder *must not* already be loaded.
  //  * @param ws The workspace folder to load for
  //  * @returns The newly created CMakeTools backend for the given folder
  //  */
  // async addWorkspaceFolder(ws: vscode.WorkspaceFolder, progress?: ProgressHandle): Promise<CMakeTools> {
  //   return this._wsModStrand.execute(async () => {
  //     // Check that we aren't double-loading for this workspace. That would be bad...
  //     const current_cmt = this._cmakeToolsForWorkspaceFolder(ws)!;
  //     if (current_cmt) {
  //       rollbar.error('Double-loaded CMake Tools instance for workspace folder', {wsUri: ws.uri.toString()});
  //       // Not even sure how to best handle this...
  //       return current_cmt;
  //     }
  //     // Load for the workspace.
  //     reportProgress(progress, 'Creating backend');
  //     const new_cmt = await this._loadCMakeToolsForWorkspaceFolder(ws);
  //     this._targetProvider.registerCMakeTools(new_cmt);
  //     // If we didn't have anything active, mark the freshly loaded instance as active
  //     this._projectOutlineProvider.addFolder(ws);
  //     rollbar.takePromise('Post-folder-open', {folder: ws}, this._postWorkspaceOpen(ws, new_cmt));
  //     // Return the newly created instance
  //     return new_cmt;
  //   });
  // }

  private _disposeSubs() {
    util.disposeAll([
      this._buildTypeSub,
      this._ctestEnabledSub,
      this._testResultsSub,
      this._isBusySub,
    ]);
  }

  private _updateCodeModel(cmt: CMakeTools) {
    this._projectOutlineProvider.updateCodeModel(
        cmt.workspaceContext.folder,
        cmt.codeModel,
        {
          defaultTarget: this._defaultBuildTarget,
          launchTargetName: cmt.launchTargetName,
        },
    );
    rollbar.invokeAsync('Update code model for cpptools', {}, async () => {
      if (!this._cppToolsAPI) {
        this._cppToolsAPI = await cpt.getCppToolsApi(cpt.Version.v1);
      }
      if (this._cppToolsAPI && cmt.codeModel && cmt.activeKit) {
        const codeModel = cmt.codeModel;
        const kit = cmt.activeKit;
        const cpptools = this._cppToolsAPI;
        let cache: CMakeCache;
        try {
          cache = await CMakeCache.fromPath(await cmt.cachePath);
        } catch (e) {
          rollbar.exception('Failed to open CMake cache file on code model update', e);
          return;
        }
        const env = await effectiveKitEnvironment(kit);
        const clCompilerPath = await findCLCompilerPath(env);
        this._configProvider.updateConfigurationData({cache, codeModel, clCompilerPath});
        await this.ensureCppToolsProviderRegistered();
        cpptools.didChangeCustomConfiguration(this._configProvider);
      }
    });
  }

  // private _setupSubscriptions() {
  //   this._disposeSubs();
  //   const cmt = this._activeCMakeTools;
  //   this._statusBar.setVisible(true);
  //   if (!cmt) {
  //     this._buildTypeSub = new DummyDisposable();
  //     this._ctestEnabledSub = new DummyDisposable();
  //     this._testResultsSub = new DummyDisposable();
  //     this._isBusySub = new DummyDisposable();
  //     this._statusBar.setActiveKitName('');
  //   } else {
  //     this._buildTypeSub = cmt.onBuildTypeChanged(FireNow, bt => this._statusBar.setBuildTypeLabel(bt));
  //     this._ctestEnabledSub = cmt.onCTestEnabledChanged(FireNow, e => this._statusBar.ctestEnabled = e);
  //     this._testResultsSub = cmt.onTestResultsChanged(FireNow, r => this._statusBar.testResults = r);
  //     this._isBusySub = cmt.onIsBusyChanged(FireNow, b => this._statusBar.setIsBusy(b));
  //     this._statusBar.setActiveKitName(cmt.activeKit ? cmt.activeKit.name : '');
  //   }
  // }

  /**
   * The path to the workspace-local kits file, dependent on the path to the
   * active workspace folder.
   */
  private _workspaceKitsPath(folder: vscode.WorkspaceFolder): string { return kitsPathForWorkspaceFolder(folder); }

  private _kitsForFolder(folder: vscode.WorkspaceFolder) {
    const info = this._folders.get(folder);
    if (info) {
      return this._userKits.concat(info.folderKits);
    } else {
      return this._userKits;
    }
  }

  /**
   * The kits available from the user-local kits file
   */
  private _userKits: Kit[] = [];

  /**
   * Watch for text edits. At the moment, this only watches for changes to the
   * kits files, since the filesystem watcher in the `_kitsWatcher` is sometimes
   * unreliable.
   */
  private readonly _editorWatcher = vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.uri.fsPath === USER_KITS_FILEPATH) {
      rollbar.takePromise('Re-reading kits on text edit', {}, this._rereadKits());
    } else {
      for (const folder_info of this._folders) {
        const kits_path = this._workspaceKitsPath(folder_info.folder);
        if (kits_path === doc.uri.fsPath) {
          rollbar.takePromise('Re-reading kits on text edit', {}, this._rereadKits());
        }
      }
      // Ignore
    }
  });

  /**
   * Reload the list of available kits from the filesystem. This will also
   * update the kit loaded into the current backend if applicable.
   */
  private async _rereadKits(progress?: ProgressHandle) {
    // Load user-kits
    reportProgress(progress, 'Loading kits');
    const user = await readKitsFile(USER_KITS_FILEPATH);
    // Add the special __unspec__ kit for opting-out of kits
    user.push({name: '__unspec__'});
    // Load kits for each folder
    for (const folder_info of this._folders) {
      folder_info.folderKits = await readKitsFile(this._workspaceKitsPath(folder_info.folder));
      const current = folder_info.cmakeTools.activeKit;
      const avail = user.concat(folder_info.folderKits);
      if (current) {
        const already_active_kit = avail.find(kit => kit.name === current.name);
        // Set the current kit to the one we have named
        await this._setCurrentKit(already_active_kit || null);
      }
    }
    this._userKits = user;
    // Pruning requires user interaction, so it happens fully async
    this._startPruneOutdatedKitsAsync();
  }

  /**
   * Set the current kit in the current CMake Tools instance
   * @param k The kit
   */
  async _setCurrentKit(k: Kit|null) {
    // const inst = this._activeCMakeTools;
    // const raw_name = k ? k.name : '';
    // if (inst) {
    //   // Generate a message that we will show in the progress notification
    //   let message = '';
    //   switch (raw_name) {
    //   case '':
    //   case '__unspec__':
    //     // Empty string/unspec is un-setting the kit:
    //     message = 'Unsetting kit';
    //     break;
    //   default:
    //     // Everything else is just loading a kit:
    //     message = `Loading kit ${raw_name}`;
    //     break;
    //   }
    //   // Load the kit into the backend
    //   await vscode.window.withProgress(
    //       {
    //         location: vscode.ProgressLocation.Notification,
    //         title: message,
    //       },
    //       () => inst.setKit(k),
    //   );
    // }
    // // Update the status bar
    // this._statusBar.setActiveKitName(raw_name);
    // XXX
  }

  /**
   * Opens a text editor with the user-local `cmake-kits.json` file.
   */
  async editKits(): Promise<vscode.TextEditor|null> {
    log.debug('Opening TextEditor for', USER_KITS_FILEPATH);
    if (!await fs.exists(USER_KITS_FILEPATH)) {
      interface Item extends vscode.MessageItem {
        action: 'scan'|'cancel';
      }
      const chosen = await vscode.window.showInformationMessage<Item>(
          'No kits file is present. What would you like to do?',
          {modal: true},
          {
            title: 'Scan for kits',
            action: 'scan',
          },
          {
            title: 'Cancel',
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
    log.debug('Rescanning for kits');
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
    this._userKits = new_kits;
    await this._writeUserKitsFile(new_kits);
    this._startPruneOutdatedKitsAsync();
  }

  /**
   * Get the current MinGW search directories
   */
  private _getMinGWDirs(): string[] {
    const config = ConfigurationReader.loadForPath(process.cwd());
    return config.mingwSearchDirs;
  }

  /**
   * Write the given kits the the user-local cmake-kits.json file.
   * @param kits The kits to write to the file.
   */
  private async _writeUserKitsFile(kits: Kit[]) {
    log.debug('Saving kits to', USER_KITS_FILEPATH);
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
      log.debug('Saving new kits to', USER_KITS_FILEPATH);
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
            `The kit "${kit.name}" references a non-existent compiler binary [${missing.path}]. ` +
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
          return this._keepKit(kit);
        case 'remove':
          return this._removeKit(kit);
        }
      });
      rollbar.takePromise(`Pruning kit`, {kit}, pr);
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
    this._userKits = new_kits;
    return this._writeUserKitsFile(new_kits);
  }

  /**
   * Remove a kit from the user-local kits.
   * @param kit The kit to remove
   */
  private async _removeKit(kit: Kit) {
    const new_kits = this._userKits.filter(k => k.name !== kit.name);
    this._userKits = new_kits;
    return this._writeUserKitsFile(new_kits);
  }

  private async _checkHaveKits(folder: vscode.WorkspaceFolder): Promise<'use-unspec'|'ok'|'cancel'> {
    const avail = this._kitsForFolder(folder);
    if (avail.length > 1) {
      // We have kits. Okay.
      return 'ok';
    }
    if (avail[0].name !== '__unspec__') {
      // We should _always_ have an __unspec__ kit.
      rollbar.error('Invalid only kit. Expected to find `__unspec__`');
      return 'ok';
    }
    // We don't have any kits defined. Ask the user what to do. This is safe to block
    // because it is a modal dialog
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
  async selectKit(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (!vscode.workspace.workspaceFolders) {
      return false;
    }
    if (vscode.workspace.workspaceFolders.length === 1) {
      folder = vscode.workspace.workspaceFolders[0];
    }
    if (!folder) {
      folder = await vscode.window.showWorkspaceFolderPick();
      if (!folder) {
        return false;
      }
    }

    // Check that we have kits, or if the user doesn't want to use a kit.
    const state = await this._checkHaveKits(folder);
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

    const avail = this._kitsForFolder(folder);
    log.debug('Start selection of kits. Found', avail.length, 'kits.');

    interface KitItem extends vscode.QuickPickItem {
      kit: Kit;
    }
    log.debug('Opening kit selection QuickPick');
    // Generate the quickpick items from our known kits
    const items = avail.map(
        (kit): KitItem => ({
          label: kit.name !== '__unspec__' ? kit.name : '[Unspecified]',
          description: descriptionForKit(kit),
          kit,
        }),
    );
    const chosen_kit = await vscode.window.showQuickPick(items, {placeHolder: 'Select a Kit'});
    if (chosen_kit === undefined) {
      log.debug('User cancelled Kit selection');
      // No selection was made
      return false;
    } else {
      log.debug('User selected kit ', JSON.stringify(chosen_kit));
      await this._setCurrentKit(chosen_kit.kit);
      return true;
    }
  }

  /**
   * Wraps an operation that requires an open workspace and kit selection. If
   * there is no active CMakeTools (no open workspace) or if the user cancels
   * kit selection, we return the given default value.
   * @param default_ The default return value
   * @param fn The callback
   */
  async withCMakeTools__<Ret>(default_: Ret, fn: (cmt: CMakeTools) => Ret | Thenable<Ret>): Promise<void> {
    // Check that we have an active CMakeTools instance.
    // const cmt = this._activeCMakeTools;
    // if (!cmt) {
    //   vscode.window.showErrorMessage('CMake Tools is not available without an open workspace');
    //   return Promise.resolve(default_);
    // }
    // // Ensure that we have a kit available.
    // if (!await this._ensureActiveKit(cmt)) {
    //   return Promise.resolve(default_);
    // }
    // // We have a kit, and we have a CMakeTools. Call the function
    // return Promise.resolve(fn(cmt));
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

  async getTargetInformationFull(name: string, folder: vscode.WorkspaceFolder): Promise<TargetInformation|null> {
    const cmt = this._cmakeToolsForWorkspaceFolder(folder);
    if (!cmt) {
      rollbar.error('Cannot get CMake Tools backend for non-existent folder');
      return null;
    }
    if (!await this._ensureActiveKit(cmt)) {
      return null;
    }
    const avail = getTargets(cmt);
    const found = avail.find(info => info.target.name === name);
    if (!found) {
      rollbar.error('Setting default target to non-existent for folder');
      return null;
    }
    return found;
  }

  getTargetInformationFast(name: string, folder: vscode.WorkspaceFolder): TargetInformation|null {
    const cmt = this._cmakeToolsForWorkspaceFolder(folder);
    if (!cmt) {
      rollbar.error('Cannot get CMake Tools backend for non-existent folder');
      return null;
    }
    const avail = getTargets(cmt);
    const found = avail.find(info => info.target.name === name);
    if (!found) {
      rollbar.error('Setting default target to non-existent for folder');
      return null;
    }
    return found;
  }

  // The below functions are all wrappers around the backend.
  async mapCMakeTools(fn: CMakeToolsMapFn): Promise<void>;
  async mapCMakeTools(cmt: CMakeTools|undefined, fn: CMakeToolsMapFn): Promise<void>;
  async mapCMakeTools(cmt: CMakeTools|undefined|CMakeToolsMapFn, fn?: CMakeToolsMapFn): Promise<void> {
    if (cmt === undefined) {
      for (const folder of this._folders) {
        await fn!(folder.cmakeTools);
      }
    } else if (cmt instanceof CMakeTools) {
      await fn!(cmt);
    } else {
      fn = cmt;
      for (const folder of this._folders) {
        await fn(folder.cmakeTools);
      }
    }
  }

  cleanConfigure(cmt?: CMakeTools) { return this.mapCMakeTools(cmt, cmt_ => cmt_.cleanConfigure()); }

  configure(cmt?: CMakeTools) { return this.mapCMakeTools(cmt, c => c.configure()); }

  async build(name?: string, folder?: vscode.WorkspaceFolder) {
    if (name && folder) {
      const cmt = this._cmakeToolsForWorkspaceFolder(folder);
      if (!cmt) {
        rollbar.error('Tried to build target in a non-existing folder?');
        return -1;
      }
      if (!await this._ensureActiveKit(cmt)) {
        return -1;
      }
      return cmt.build(name);
    } else if (name) {
      // We have a name, at least.
      await this.mapCMakeTools(c => c.build(name));
    } else {
      if (this._defaultBuildTarget) {
        return this._defaultBuildTarget.cmakeTools.build(this._defaultBuildTarget.target.name);
      } else {
        // Build the default target on each instance
        await this.mapCMakeTools(c => c.build());
      }
    }
  }

  private readonly _targetProvider = new TargetProvider();
  private _defaultBuildTarget?: TargetInformation;

  async uiSelectTarget(): Promise<TargetInformation|null> {
    const avail = this._targetProvider.provideTargets();
    interface TargetChoice extends vscode.QuickPickItem {
      target: TargetInformation;
    }
    const choices = avail.map((t): TargetChoice => {
      switch (t.target.type) {
      case 'named':
        return {
          target: t,
          label: t.target.name,
          description: t.cmakeTools.folderName,
        };
      case 'rich':
        return {
          target: t,
          label: t.target.name,
          description: `${t.cmakeTools.folderName} :: ${t.target.targetType}`,
          detail: t.target.filepath,
        };
      }
    });
    const chosen = await vscode.window.showQuickPick(choices);
    return chosen ? chosen.target : null;
  }

  private _setDefaultTarget(info: TargetInformation) {
    this._defaultBuildTarget = info;
    this._statusBar.targetName = info.target.name;
    this._updateCodeModel(info.cmakeTools);
  }

  async changeDefaultTarget() {
    const chosen = await this.uiSelectTarget();
    if (!chosen) {
      return;
    }
    this._setDefaultTarget(chosen);
  }

  setDefaultTarget(name: string, folder: vscode.WorkspaceFolder) {
    const target = this.getTargetInformationFast(name, folder);
    if (!target) {
      return;
    }
    this._setDefaultTarget(target);
  }

  // TODO:
  // setVariant() { return this.withCMakeTools(false, cmt => cmt.setVariant()); }

  install() { return this.mapCMakeTools(c => c.install()); }

  // editCache() { return this.withCMakeTools(undefined, cmt => cmt.editCache()); }

  clean() { return this.build('clean'); }

  async cleanRebuild() {
    const retc = await this.build('clean');
    if (retc) {
      return retc;
    }
    return this.build();
  }

  async buildWithTarget() {
    const chosen = await this.uiSelectTarget();
    if (!chosen) {
      return;
    }
    chosen.cmakeTools.build(chosen.target.name);
  }

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
    for (const folder of this._folders) {
      const term = await folder.cmakeTools.tryCompileFile(file);
      if (term) {
        return term;
      }
    }
    vscode.window.showErrorMessage('Unable to find compilation information for this file');
  }

  ctest() { return this.mapCMakeTools(c => c.ctest()); }

  stop() { return this.mapCMakeTools(c => c.stop()); }

  // TODO!!
  // quickStart() { return this.withCMakeTools(-1, cmt => cmt.quickStart()); }

  // TODO!!
  // launchTargetPath() { return this.withCMakeTools(null, cmt => cmt.launchTargetPath()); }

  // TODO!!
  // async debugTarget(name?: string, folder?: vscode.WorkspaceFolder) {
  //   if (name && folder) {
  //     const info = await this.getTargetInformationFull(name, folder);
  //     if (!info) {
  //       return null;
  //     }
  //     return info.cmakeTools.debugTarget(info.target.name);
  //   } else {
  //     return this.withCMakeTools(null, cmt => cmt.debugTarget(name));
  //   }
  // }

  // TODO!!
  // async launchTarget(name?: string, folder?: vscode.WorkspaceFolder) {
  //   if (name && folder) {
  //     const info = await this.getTargetInformationFull(name, folder);
  //     if (!info) {
  //       return null;
  //     }
  //     return info.cmakeTools.launchTarget(info.target.name);
  //   } else {
  //     return this.withCMakeTools(null, cmt => cmt.launchTarget(name));
  //   }
  // }

  // TODO!!
  // selectLaunchTarget(name?: string) { return this.withCMakeTools(null, cmt => cmt.selectLaunchTarget(name)); }

  // TODO!!
  // resetState() { return this.withCMakeTools(null, cmt => cmt.resetState()); }

  // TODO!!
  // viewLog() { return this.withCMakeTools(null, cmt => cmt.viewLog()); }
}

/**
 * The global extension manager. There is only one of these, even if multiple
 * backends.
 */
let _EXT_MANAGER: ExtensionManager|null = null;

async function setup(context: vscode.ExtensionContext, progress: ProgressHandle) {
  reportProgress(progress, 'Initial setup');
  await util.setContextValue('cmakeToolsActive', true);
  // Load a new extension manager
  const ext = _EXT_MANAGER = await ExtensionManager.create(context);

  // A register function that helps us bind the commands to the extension
  function register<K extends keyof ExtensionManager>(name: K) {
    return vscode.commands.registerCommand(`cmake.${name}`, (...args: any[]) => {
      // Generate a unqiue ID that can be correlated in the log file.
      const id = util.randint(1000, 10000);
      // Create a promise that resolves with the command.
      const pr = (async () => {
        // Debug when the commands start/stop
        log.debug(`[${id}]`, `cmake.${name}`, 'started');
        // Bind the method
        const fn = (ext[name] as Function).bind(ext);
        // Call the method
        const ret = await fn(...args);
        try {
          // Log the result of the command.
          log.debug(`[${id}] cmake.${name} finished (returned ${JSON.stringify(ret)})`);
        } catch (e) {
          // Log, but don't try to serialize the return value.
          log.debug(`[${id}] cmake.${name} finished (returned an unserializable value)`);
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
    'cleanConfigure',
    'configure',
    'build',
    'setVariant',
    'install',
    // 'editCache',
    'clean',
    'cleanRebuild',
    'buildWithTarget',
    'changeDefaultTarget',
    'ctest',
    'stop',
    'quickStart',
    'launchTargetPath',
    'debugTarget',
    'launchTarget',
    'selectLaunchTarget',
    'resetState',
    'viewLog',
    'compileFile',
    // 'toggleCoverageDecorations', // XXX: Should coverage decorations be revived?
  ];

  // Register the functions before the extension is done loading so that fast
  // fingers won't cause "unregistered command" errors while CMake Tools starts
  // up. The command wrapper will await on the extension promise.
  reportProgress(progress, 'Loading extension commands');
  for (const key of funs) {
    log.trace(`Register CMakeTools extension command cmake.${key}`);
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
                                      (what: TargetNode) => runCommand('build', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.runUtilityTarget',
                                      (what: TargetNode) => runCommand('build', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.debugTarget',
                                      (what: TargetNode) => runCommand('debugTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.launchTarget',
                                      (what: TargetNode) => runCommand('launchTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.setDefaultTarget',
                                      (what: TargetNode) => ext.setDefaultTarget(what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.setLaunchTarget',
                                      (what: TargetNode) => runCommand('selectLaunchTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.revealInCMakeLists',
                                      (what: TargetNode) => what.openInCMakeLists()),
      vscode.commands.registerCommand('cmake.outline.compileFile',
                                      (what: SourceFileNode) => runCommand('compileFile', what.filePath)),
  ]);
}

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext) {
  await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CMake Tools initializing...',
        cancellable: false,
      },
      progress => setup(context, progress),
  );

  // TODO: Return the extension API
  // context.subscriptions.push(vscode.commands.registerCommand('cmake._extensionInstance', () => cmt));
}

// this method is called when your extension is deactivated
export async function deactivate() {
  log.debug('Deactivate CMakeTools');
  if (_EXT_MANAGER) {
    await _EXT_MANAGER.asyncDispose();
  }
}
