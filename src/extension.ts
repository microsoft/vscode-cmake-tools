/**
 * Extension startup/teardown
 */ /** */

'use strict';

import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';
import * as nls from 'vscode-nls';

import * as api from '@cmt/api';
import {CMakeCache} from '@cmt/cache';
import CMakeTools from '@cmt/cmake-tools';
import {ConfigurationReader} from '@cmt/config';
import {CppConfigurationProvider} from '@cmt/cpptools';
import {CMakeToolsFolderController, CMakeToolsFolder} from '@cmt/folders';
import {
  Kit,
  descriptionForKit,
  USER_KITS_FILEPATH,
  findCLCompilerPath,
  effectiveKitEnvironment,
} from '@cmt/kit';
import {KitsController} from '@cmt/kitsController';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import {FireNow, FireLate} from '@cmt/prop';
import rollbar from '@cmt/rollbar';
import {StatusBar} from './status';
import {ProjectOutlineProvider, TargetNode, SourceFileNode} from '@cmt/tree';
import * as util from '@cmt/util';
import {ProgressHandle, DummyDisposable, reportProgress} from '@cmt/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('extension');

type CMakeToolsMapFn = (cmt: CMakeTools) => Thenable<any>;

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
  constructor(public readonly extensionContext: vscode.ExtensionContext) {
    this._statusBar.targetName = 'all';
    this._folders.onAfterAddFolder(info => {
      const new_cmt = info.cmakeTools;
      this._projectOutlineProvider.addFolder(info.folder);
      new_cmt.onCodeModelChanged(FireLate, () => this._updateCodeModel(info));
      new_cmt.onLaunchTargetNameChanged(FireLate, () => {
        this._updateCodeModel(info);
        rollbar.takePromise('Post-folder-open', {folder: info.folder}, this._postWorkspaceOpen(info));
      });
    });
    this._folders.onAfterRemoveFolder (info => {
      this._projectOutlineProvider.removeFolder(info);
    });
  }

  private _onDidChangeActiveTextEditorSub: vscode.Disposable = new DummyDisposable();

  /**
   * Second-phase async init
   */
  private async _init() {
    if (vscode.workspace.workspaceFolders) {
      await this._folders.loadAllCurrent();
      this._projectOutlineProvider.addAllCurrentFolders();
      this._onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(this._onDidChangeActiveTextEditor, this);
      this._onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
      for (const cmtFolder of this._folders) {
        rollbar.takePromise('Post-folder-open', {folder: cmtFolder.folder}, this._postWorkspaceOpen(cmtFolder));
      }
    }
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
   * The folder controller manages multiple instances. One per folder.
   */
  private readonly _folders = new CMakeToolsFolderController(this.extensionContext);

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
   * Auto select active folder on focus change
   */
  private _autoSelectActiveFolder = true;

  private _checkFolderArgs(folder?: vscode.WorkspaceFolder): CMakeToolsFolder | undefined {
    let cmtFolder: CMakeToolsFolder | undefined;
    if (folder) {
      cmtFolder = this._folders.get(folder);
    } else if (this._folders.activeFolder) {
      cmtFolder = this._folders.activeFolder;
    }
    return cmtFolder;
  }

  private async _pickFolder() {
    const selection = await vscode.window.showWorkspaceFolderPick();
    if (selection) {
      const cmtFolder = this._folders.get(selection);
      console.assert(cmtFolder, 'Folder not found in folder controller.');
      return cmtFolder;
    }
  }

  /**
   * Ensure that there is an active kit for the current CMakeTools.
   *
   * @returns `false` if there is not active CMakeTools, or it has no active kit
   * and the user cancelled the kit selection dialog.
   */
  private async _ensureActiveKit(cmt: CMakeTools|null = null): Promise<boolean> {
    if (!cmt) {
      cmt = this._folders.activeFolder!.cmakeTools;
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
    if (!did_choose_kit && !cmt.activeKit) {
      // The user did not choose a kit and kit isn't set in other way such as setKitByName
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
    if (this._pickKitCancellationTokenSource) {
      this._pickKitCancellationTokenSource.dispose();
    }
    this._onDidChangeActiveTextEditorSub.dispose();
    this._kitsWatcher.close();
    this._projectOutlineDisposer.dispose();
    if (this._cppToolsAPI) {
      this._cppToolsAPI.dispose();
    }
    // Dispose of each CMake Tools we still have loaded
    for (const cmtf of this._folders) {
      await cmtf.cmakeTools.asyncDispose();
    }
    this._folders.dispose();
  }

  async _postWorkspaceOpen(info: CMakeToolsFolder) {
    const ws = info.folder;
    const cmt = info.cmakeTools;
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

  private async _onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (vscode.workspace.workspaceFolders) {
      let ws: vscode.WorkspaceFolder | undefined;
      if (editor) {
        ws = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      }
      await this._setActiveFolder(ws || vscode.workspace.workspaceFolders[0]);
    }
  }

  /**
   * Show UI to allow the user to select an active kit
   */
  async selectActiveFolder() {
    if (vscode.workspace.workspaceFolders) {
      const lastActiveFolderPath = this._folders.activeFolder!.folder.uri.fsPath;
      const selection = await vscode.window.showWorkspaceFolderPick();
      if (selection) {
        // Ingore if user cancelled
        await this._setActiveFolder(selection);
        // _folders.activeFolder must be there at this time
        if (lastActiveFolderPath !== this._folders.activeFolder!.folder.uri.fsPath && !this._autoSelectActiveFolder) {
          rollbar.takePromise('Post-folder-open', {folder: selection}, this._postWorkspaceOpen(this._folders.activeFolder!));
        }
      }
    }
  }

  /**
   * Set the active workspace folder. This reloads a lot of different bits and
   * pieces to control which backend has control and receives user input.
   * @param ws The workspace to activate
   */
  private async _setActiveFolder(ws: vscode.WorkspaceFolder, progress?: ProgressHandle) {
    // Set the new workspace
    this._folders.setActiveFolder(ws);
    this._statusBar.setActiveFolderName(ws.name);
    const currentKit = this._folders.activeFolder!.cmakeTools.activeKit;
    if (currentKit) {
      this._statusBar.setActiveKitName(currentKit.name);
    }
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

  private _updateCodeModel(folder: CMakeToolsFolder) {
    const cmt = folder.cmakeTools;
    this._projectOutlineProvider.updateCodeModel(
      cmt.workspaceContext.folder,
      cmt.codeModel,
      {
        defaultTarget: cmt.defaultBuildTarget || undefined,
        launchTargetName: cmt.launchTargetName,
      }
    );
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
    const folder = this._folders.activeFolder!;
    const cmt = folder.cmakeTools;
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
        this._updateCodeModel(folder);
      });
      this._buildTypeSub = cmt.onBuildTypeChanged(FireNow, bt => this._statusBar.setBuildTypeLabel(bt));
      this._launchTargetSub = cmt.onLaunchTargetNameChanged(FireNow, t => {
        this._statusBar.setLaunchTargetName(t || '');
        this._updateCodeModel(folder);
      });
      this._ctestEnabledSub = cmt.onCTestEnabledChanged(FireNow, e => this._statusBar.ctestEnabled = e);
      this._testResultsSub = cmt.onTestResultsChanged(FireNow, r => this._statusBar.testResults = r);
      this._isBusySub = cmt.onIsBusyChanged(FireNow, b => this._statusBar.setIsBusy(b));
      this._statusBar.setActiveKitName(cmt.activeKit ? cmt.activeKit.name : '');
      this._codeModelSub = cmt.onCodeModelChanged(FireNow, () => this._updateCodeModel(folder));
    }
  }

  private _kitsForFolder(folder: vscode.WorkspaceFolder) {
    const info = this._folders.get(folder);
    if (info) {
      return info.kitsController.availableKits;
    } else {
      return KitsController.userKits;
    }
  }

  /**
   * Watches for changes to the kits file
   */
  private readonly _kitsWatcher =
      util.chokidarOnAnyChange(chokidar.watch(USER_KITS_FILEPATH, {ignoreInitial: true}),
                               _ => rollbar.takePromise(localize('rereading.kits', 'Re-reading kits'), {}, KitsController.readUserKits()));

  /**
   * Set the current kit for the specified workspace folder
   * @param k The kit
   */
  async _setFolderKit(wsf: vscode.WorkspaceFolder, k: Kit|null) {
    const cmtFolder = this._folders.get(wsf);
    // Ignore if folder doesn't exist
    if (cmtFolder) {
      this._statusBar.setActiveKitName(await cmtFolder.kitsController.setFolderActiveKit(k));
    }
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

  async scanForKits() {
    KitsController.minGWSearchDirs = this._getMinGWDirs();
    const duplicateRemoved = await KitsController.scanForKits();
    if (duplicateRemoved) {
      // Check each folder. If there is an active kit set and if it is of the old definition,
      // unset the kit
      for (const cmtFolder of this._folders) {
        const activeKit = cmtFolder.cmakeTools.activeKit;
        if (activeKit) {
          const definition = activeKit.visualStudio;
          if (definition && (definition.startsWith("VisualStudio.15") || definition.startsWith("VisualStudio.16"))) {
            await cmtFolder.kitsController.setFolderActiveKit(null);
          }
        }
      }
    }
  }

  /**
   * Get the current MinGW search directories
   */
  private _getMinGWDirs(): string[] {
    let result: string[] = [];
    for (const cmtFolder of this._folders) {
      result = result.concat(cmtFolder.cmakeTools.workspaceContext.config.mingwSearchDirs);
    }
    if (result.length === 0) {
      const config = ConfigurationReader.loadForPath(process.cwd());
      return config.mingwSearchDirs;
    }
    return result;
  }

  private async _checkHaveKits(folder: vscode.WorkspaceFolder): Promise<'use-unspec'|'ok'|'cancel'> {
    const avail = this._kitsForFolder(folder);
    if (avail.length > 1) {
      // We have kits. Okay.
      return 'ok';
    }
    if (avail[0].name !== '__unspec__') {
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
      await this._setFolderKit(folder, {name: '__unspec__'});
      return 'use-unspec';
    }
    case 'cancel': {
      return 'cancel';
    }
    }
  }

  private _pickKitCancellationTokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
  /**
   * Show UI to allow the user to select an active kit
   */
  async selectKit(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('running.in.test.mode', 'Running CMakeTools in test mode. selectKit is disabled.'));
      return false;
    }

    if (!folder && this._folders.activeFolder) {
      folder = this._folders.activeFolder.folder;
    }
    if (!folder) {
      return false;
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
    log.debug(localize('opening.kit.selection', 'Opening kit selection QuickPick'));
    // Generate the quickpick items from our known kits
    const itemPromises = avail.map(
        async (kit): Promise<KitItem> => ({
          label: kit.name !== '__unspec__' ? kit.name : `[${localize('unspecified.kit.name', 'Unspecified')}]`,
          description: await descriptionForKit(kit),
          kit,
        }),
    );
    const items = await Promise.all(itemPromises);
    const chosen_kit = await vscode.window.showQuickPick(items,
                                                         {placeHolder: localize('select.a.kit.placeholder', 'Select a Kit')},
                                                         this._pickKitCancellationTokenSource.token);
    this._pickKitCancellationTokenSource.dispose();
    this._pickKitCancellationTokenSource = new vscode.CancellationTokenSource();
    if (chosen_kit === undefined) {
      log.debug(localize('user.cancelled.kit.selection', 'User cancelled Kit selection'));
      // No selection was made
      return false;
    } else {
      log.debug(localize('user.selected.kit', 'User selected kit {0}', JSON.stringify(chosen_kit)));
      await this._setFolderKit(folder, chosen_kit.kit);
      return true;
    }
  }

  /**
   * Set the current kit in the current CMake Tools instance by name of the kit
   */
  async setKitByName(kitName: string) {
    // TODO
    // let newKit: Kit | undefined;
    // if (!kitName) {
    //     kitName = '__unspec__';
    // }
    // newKit = this._allKits.find(kit => kit.name === kitName);
    // await this._setCurrentKit(newKit || null);
    // // if we are showing a quickpick menu...
    // this._pickKitCancellationTokenSource.cancel();
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
  async mapCMakeTools(fn: CMakeToolsMapFn): Promise<any>;
  async mapCMakeTools(cmt: CMakeTools|undefined, fn: CMakeToolsMapFn): Promise<any>;
  async mapCMakeTools(cmt: CMakeTools|undefined|CMakeToolsMapFn, fn?: CMakeToolsMapFn): Promise<any> {
    if (cmt === undefined) {
      return await fn!(this._folders.activeFolder!.cmakeTools);
    } else if (cmt instanceof CMakeTools) {
      return await fn!(cmt);
    } else {
      fn = cmt;
      for (const folder of this._folders) {
        const retc = await fn(folder.cmakeTools);
        if (retc) {
          return retc;
        }
      }
      // Succeeded
      return 0;
    }
  }

  // Have to have another function for folders due to the limit of js type system...
  async mapCMakeToolsForFolders(folders: (CMakeToolsFolder | undefined)[], fn: CMakeToolsMapFn): Promise<any> {
    if (folders) {
      for (const folder of folders) {
        if (folder) {
          const retc: number = await this.mapCMakeTools(folder.cmakeTools, fn);
          if (retc) {
            return retc
          }
        }
      }
      // Succeeded
      return 0;
    } else {
      return await this.mapCMakeTools(fn);
    }
  }

  cleanConfigure(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) { return this.mapCMakeToolsForFolders(folders, c => c.cleanConfigure()); }

  cleanConfigureAll() { return this.mapCMakeTools(c => c.cleanConfigure()); }

  configure(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) { return this.mapCMakeToolsForFolders(folders, c => c.configure()); }

  configureAll() { return this.mapCMakeTools(c => c.configure()); }

  async build(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder], name?: string) {
    return await this.mapCMakeToolsForFolders(folders, c => c.build(name));
  }

  async buildAll(name?: string) {
    return await this.mapCMakeTools(c => c.build(name));
  }

  async setDefaultTarget(name?: string, folder?: vscode.WorkspaceFolder) {
    const cmtFolder = this._checkFolderArgs(folder);
    if (cmtFolder) {
      cmtFolder.cmakeTools.setDefaultTarget(name);
    }
  }

  async setVariant(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) {
    return await this.mapCMakeToolsForFolders(folders, c => c.setVariant());
  }

  async setVariantAll() {
    return await this.mapCMakeTools(c => c.setVariant());
  }

  install(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) { return this.mapCMakeToolsForFolders(folders, c => c.install()); }

  installAll() { return this.mapCMakeTools(c => c.install()); }

  editCache(folder: vscode.WorkspaceFolder) {
    return this.mapCMakeToolsForFolders([this._folders.get(folder)], cmt => cmt.editCache());
  }

  clean(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) { return this.build(folders, 'clean'); }

  cleanAll() { return this.buildAll('clean'); }

  async cleanRebuild(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) {
    const retc = await this.build(folders, 'clean');
    if (retc) {
      return retc;
    }
    return this.build(folders);
  }

  async cleanRebuildAll() {
    const retc = await this.buildAll('clean');
    if (retc) {
      return retc;
    }
    return this.buildAll();
  }

  async buildWithTarget() {
    let cmtFolder: CMakeToolsFolder | undefined = this._folders.activeFolder;
    if (!cmtFolder) {
      cmtFolder = await this._pickFolder();
    }
    if (!cmtFolder) {
      return; // Error or nothing is opened
    }
    cmtFolder.cmakeTools.buildWithTarget();
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
    vscode.window.showErrorMessage(localize('compilation information.not.found', 'Unable to find compilation information for this file'));
  }

  ctest(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) { return this.mapCMakeToolsForFolders(folders, c => c.ctest()); }

  ctestAll() { return this.mapCMakeTools(c => c.ctest()); }

  stop(folders: (CMakeToolsFolder | undefined)[] = [this._folders.activeFolder]) { return this.mapCMakeToolsForFolders(folders, c => c.stop()); }

  stopAll() { return this.mapCMakeTools(c => c.stop()); }

  quickStart(folder?: vscode.WorkspaceFolder) {
    const cmtFolder = this._checkFolderArgs(folder);
    return this.mapCMakeTools(cmt => cmt.quickStart(cmtFolder));
  }

  launchTargetPath(folder: vscode.WorkspaceFolder) {
    const cmtFolder = this._folders.get(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.launchTargetPath();
    }
    return null;
  }

  launchTargetDirectory(folder: vscode.WorkspaceFolder) {
    const cmtFolder = this._folders.get(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.launchTargetDirectory();
    }
    return null;
  }

  buildType(folder: vscode.WorkspaceFolder) {
    const cmtFolder = this._folders.get(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.currentBuildType();
    }
    return null;
  }

  buildDirectory(folder: vscode.WorkspaceFolder) {
    const cmtFolder = this._folders.get(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.buildDirectory();
    }
    return null;
  }

  tasksBuildCommand(folder: vscode.WorkspaceFolder) {
    const cmtFolder = this._folders.get(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.tasksBuildCommand();
    }
    return null;
  }

  async debugTarget(name?: string, folder?: vscode.WorkspaceFolder): Promise<vscode.DebugSession | null> {
    const cmtFolder = this._checkFolderArgs(folder);
    if (cmtFolder) {
      return this.mapCMakeTools(cmtFolder.cmakeTools, cmt => cmt.debugTarget(name));
    }
    return this.mapCMakeTools(cmt => cmt.debugTarget(name));
  }

  async debugTargetAll(name?: string): Promise<(vscode.DebugSession | null)[]> {
    const debugSessions: Promise<vscode.DebugSession | null>[] = [];
    for (const cmtFolder of this._folders) {
      if (cmtFolder) {
        debugSessions.push(this.mapCMakeTools(cmtFolder.cmakeTools, cmt => cmt.debugTarget(name)));
      }
      debugSessions.push(Promise.resolve(null));
    }
    return Promise.all(debugSessions);
  }

  async launchTarget(name?: string, folder?: vscode.WorkspaceFolder): Promise<vscode.Terminal | null> {
    const cmtFolder = this._checkFolderArgs(folder);
    if (cmtFolder) {
      return this.mapCMakeTools(cmtFolder.cmakeTools, cmt => cmt.launchTarget(name));
    }
    return this.mapCMakeTools(cmt => cmt.launchTarget(name));
  }

  async launchTargetAll(name?: string): Promise<(vscode.Terminal | null)[]> {
    const terminals: Promise<vscode.Terminal | null>[] = [];
    for (const cmtFolder of this._folders) {
      if (cmtFolder) {
        terminals.push(this.mapCMakeTools(cmtFolder.cmakeTools, cmt => cmt.launchTarget(name)));
      }
      terminals.push(Promise.resolve(null));
    }
    return Promise.all(terminals);
  }

  selectLaunchTarget(name?: string, folder?: vscode.WorkspaceFolder) {
    const cmtFolder = this._checkFolderArgs(folder);
    if (cmtFolder) {
      cmtFolder.cmakeTools.selectLaunchTarget(name);
    }
  }

  resetState(folder?: vscode.WorkspaceFolder) {
    const cmtFolder = this._checkFolderArgs(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.resetState();
    }
    // Ignore nothing opened case.
  }

  viewLog(folder?: vscode.WorkspaceFolder) {
    const cmtFolder = this._checkFolderArgs(folder);
    if (cmtFolder) {
      return cmtFolder.cmakeTools.viewLog();
    }
    // Ignore nothing opened case.
  }
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
  const ext = _EXT_MANAGER = await ExtensionManager.create(context);

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

  // TODO
  // List of functions that will be bound commands
  const funs: (keyof ExtensionManager)[] = [
    'selectActiveFolder',
    'editKits',
    'scanForKits',
    'selectKit',
    'setKitByName',
    'build',
    'buildAll',
    'buildWithTarget',
    'setVariant',
    'setVariantAll',
    'install',
    'installAll',
    'editCache',
    'clean',
    'cleanAll',
    'cleanConfigure',
    'cleanConfigureAll',
    'cleanRebuild',
    'cleanRebuildAll',
    'configure',
    'configureAll',
    'ctest',
    'ctestAll',
    'stop',
    'stopAll',
    'quickStart',
    'launchTargetPath',
    'launchTargetDirectory',
    'buildType',
    'buildDirectory',
    'debugTarget',
    'debugTargetAll',
    'launchTarget',
    'launchTargetAll',
    'selectLaunchTarget',
    'setDefaultTarget',
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
                                      (what: TargetNode) => runCommand('build', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.runUtilityTarget',
                                      (what: TargetNode) => runCommand('cleanRebuild', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.debugTarget',
                                      (what: TargetNode) => runCommand('debugTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.launchTarget',
                                      (what: TargetNode) => runCommand('launchTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.setDefaultTarget',
                                      (what: TargetNode) => runCommand('setDefaultTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.setLaunchTarget',
                                      (what: TargetNode) => runCommand('selectLaunchTarget', what.name, what.folder)),
      vscode.commands.registerCommand('cmake.outline.revealInCMakeLists',
                                      (what: TargetNode) => what.openInCMakeLists()),
      vscode.commands.registerCommand('cmake.outline.compileFile',
                                      (what: SourceFileNode) => runCommand('compileFile', what.filePath)),
  ]);
}

class SchemaProvider implements vscode.TextDocumentContentProvider {
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    console.assert(uri.path[0] === '/', "A preceeding slash is expected on schema uri path");
    const fileName: string = uri.path.substr(1);
    const locale: string = util.getLocaleId();
    let localizedFilePath: string = path.join(util.thisExtensionPath(), "dist/schema/", locale, fileName);
    const fileExists: boolean = await util.checkFileExists(localizedFilePath);
    if (!fileExists) {
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
    // CMakeTools versions newer or equal to #1.2 should not coexist with older versions
    // because the publisher changed (from vector-of-bool into ms-vscode),
    // causing many undesired behaviors (duplicate operations, registrations for UI elements, etc...)
    const oldCMakeToolsExtension = vscode.extensions.getExtension('vector-of-bool.cmake-tools');
    if (oldCMakeToolsExtension) {
        await vscode.window.showWarningMessage(localize('uninstall.old.cmaketools', 'Please uninstall any older versions of the CMake Tools extension. It is now published by Microsoft starting with version 1.2.0.'));
    }

  // Register a protocol handler to serve localized schemas
  vscode.workspace.registerTextDocumentContentProvider('cmake-tools-schema', new SchemaProvider());
  vscode.commands.executeCommand("setContext", "inCMakeProject", true);

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
