/**
 * Extension startup/teardown
 */ /** */

'use strict';

import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';
import * as nls from 'vscode-nls';

import {CMakeCache} from '@cmt/cache';
import {CMakeTools, ConfigureType, ConfigureTrigger} from '@cmt/cmake-tools';
import {ConfigurationReader, TouchBarConfig} from '@cmt/config';
import {CppConfigurationProvider} from '@cmt/cpptools';
import {CMakeToolsFolderController, CMakeToolsFolder} from '@cmt/folders';
import {
  Kit,
  USER_KITS_FILEPATH,
  findCLCompilerPath,
  effectiveKitEnvironment,
  scanForKitsIfNeeded,
} from '@cmt/kit';
import {KitsController} from '@cmt/kitsController';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import {FireNow, FireLate} from '@cmt/prop';
import rollbar from '@cmt/rollbar';
import {StateManager} from './state';
import {StatusBar} from '@cmt/status';
import {CMakeTaskProvider} from '@cmt/taskprovider';
import * as telemetry from '@cmt/telemetry';
import {ProjectOutlineProvider, TargetNode, SourceFileNode, WorkspaceFolderNode} from '@cmt/tree';
import * as util from '@cmt/util';
import {ProgressHandle, DummyDisposable, reportProgress} from '@cmt/util';
import {DEFAULT_VARIANTS} from '@cmt/variant';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('extension');

const MULTI_ROOT_MODE_KEY = 'cmake:multiRoot';
const HIDE_LAUNCH_COMMAND_KEY = 'cmake:hideLaunchCommand';
const HIDE_DEBUG_COMMAND_KEY = 'cmake:hideDebugCommand';
const HIDE_BUILD_COMMAND_KEY = 'cmake:hideBuildCommand';

type CMakeToolsMapFn = (cmt: CMakeTools) => Thenable<any>;
type CMakeToolsQueryMapFn = (cmt: CMakeTools) => Thenable<string | string[] | null>;

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
    telemetry.activate();
    this._statusBar.setBuildTargetName('all');
    this._folders.onAfterAddFolder(async cmtFolder => {
      console.assert(this._folders.size === vscode.workspace.workspaceFolders?.length);
      if (this._folders.size === 1) {
        // First folder added
        await this._setActiveFolder(vscode.workspace.workspaceFolders![0]);
      } else if (this._folders.isMultiRoot) {
        // Call initActiveFolder instead of just setupSubscriptions, since the active editor/file may not
        // be in currently opened workspaces, and may be in the newly opened workspace.
        await this._initActiveFolder();
        await util.setContextValue(MULTI_ROOT_MODE_KEY, true);
        // sub go text edit change event in multiroot mode
        if (this._workspaceConfig.autoSelectActiveFolder)
        {
          this._onDidChangeActiveTextEditorSub.dispose();
          this._onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this._onDidChangeActiveTextEditor(e), this);
        }
      }
      const new_cmt = cmtFolder.cmakeTools;
      this._projectOutlineProvider.addFolder(cmtFolder.folder);
      if (this._codeModelUpdateSubs.get(new_cmt.folder.uri.fsPath)) {
        // We already have this folder, do nothing
      } else {
        const subs: vscode.Disposable[] = [];
        subs.push(new_cmt.onCodeModelChanged(FireLate, () => this._updateCodeModel(cmtFolder)));
        subs.push(new_cmt.onTargetNameChanged(FireLate, () => this._updateCodeModel(cmtFolder)));
        subs.push(new_cmt.onLaunchTargetNameChanged(FireLate, () => this._updateCodeModel(cmtFolder)));
        this._codeModelUpdateSubs.set(new_cmt.folder.uri.fsPath, subs);
      }
      rollbar.takePromise('Post-folder-open', {folder: cmtFolder.folder}, this._postWorkspaceOpen(cmtFolder));
    });
    this._folders.onAfterRemoveFolder (async folder => {
      console.assert((vscode.workspace.workspaceFolders === undefined && this._folders.size === 0) ||
                     (vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length === this._folders.size));
      this._codeModelUpdateSubs.delete(folder.uri.fsPath);
      if (!vscode.workspace.workspaceFolders?.length) {
        await this._setActiveFolder(undefined);
      } else {
        if (this._folders.activeFolder?.folder.uri.fsPath === folder.uri.fsPath) {
          await this._setActiveFolder(vscode.workspace.workspaceFolders[0]);
        } else {
          this._setupSubscriptions();
        }
        await util.setContextValue(MULTI_ROOT_MODE_KEY, this._folders.isMultiRoot);

        // Removing a workspace should trigger a re-evaluation of the partial/full activation mode
        // of the extension, because the visibility depends on having at least one folder
        // with valid CMakeLists.txt. If that one happens to be this, we need an opportunity
        // to hide the commands and status bar.
        this._enableFullFeatureSetOnWorkspace = false;
        this.enableWorkspaceFoldersFullFeatureSet();
      }

      this._onDidChangeActiveTextEditorSub.dispose();
      if (this._folders.isMultiRoot && this._workspaceConfig.autoSelectActiveFolder) {
        this._onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this._onDidChangeActiveTextEditor(e), this);
      } else {
        this._onDidChangeActiveTextEditorSub = new DummyDisposable();
      }
      this._projectOutlineProvider.removeFolder(folder);
    });
    this._workspaceConfig.onChange('autoSelectActiveFolder', v => {
      if (this._folders.isMultiRoot)
      {
        telemetry.logEvent('configChanged.autoSelectActiveFolder', { autoSelectActiveFolder: `${v}` });
        this._onDidChangeActiveTextEditorSub.dispose();
        if (v) {
          this._onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this._onDidChangeActiveTextEditor(e), this);
        } else {
          this._onDidChangeActiveTextEditorSub = new DummyDisposable();
        }
      }
      this._statusBar.setAutoSelectActiveFolder(v);
    });
  }

  private _onDidChangeActiveTextEditorSub: vscode.Disposable = new DummyDisposable();

  private readonly _workspaceConfig: ConfigurationReader = ConfigurationReader.create();

  private updateTouchBarVisibility(config: TouchBarConfig) {
    util.setContextValue("cmake:enableTouchBar", config.visibility === "default");
  }
  /**
   * Second-phase async init
   */
  private async _init() {
    this.updateTouchBarVisibility(this._workspaceConfig.touchbar);
    this._workspaceConfig.onChange('touchbar', config => this.updateTouchBarVisibility(config));

    let isMultiRoot = false;
    if (vscode.workspace.workspaceFolders) {
      await this._folders.loadAllCurrent();
      isMultiRoot = this._folders.isMultiRoot;
      await util.setContextValue(MULTI_ROOT_MODE_KEY, isMultiRoot);
      this._projectOutlineProvider.addAllCurrentFolders();
      if (this._workspaceConfig.autoSelectActiveFolder && isMultiRoot) {
        this._statusBar.setAutoSelectActiveFolder(true);
        this._onDidChangeActiveTextEditorSub.dispose();
        this._onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this._onDidChangeActiveTextEditor(e), this);
      }
      await this._initActiveFolder();
      for (const cmtFolder of this._folders) {
        this._codeModelUpdateSubs.set(cmtFolder.folder.uri.fsPath, [
          cmtFolder.cmakeTools.onCodeModelChanged(FireLate, () => this._updateCodeModel(cmtFolder)),
          cmtFolder.cmakeTools.onTargetNameChanged(FireLate, () => this._updateCodeModel(cmtFolder)),
          cmtFolder.cmakeTools.onLaunchTargetNameChanged(FireLate, () => this._updateCodeModel(cmtFolder))
        ]);
        rollbar.takePromise('Post-folder-open', {folder: cmtFolder.folder}, this._postWorkspaceOpen(cmtFolder));
      }
    }
    const telemetryProperties: telemetry.Properties = {
      isMultiRoot: `${isMultiRoot}`
    };
    if (isMultiRoot) {
      telemetryProperties['autoSelectActiveFolder'] = `${this._workspaceConfig.autoSelectActiveFolder}`;
    }
    telemetry.logEvent('open', telemetryProperties);
  }

  public getFolderContext(folder: vscode.WorkspaceFolder): StateManager {
    return new StateManager(this.extensionContext, folder);
  }

  // Partial activation means that the CMake Tools commands are hidden
  // from the commands pallette and the status bar is not visible.
  // The context variable "cmake:enableFullFeatureSet" (which controls
  // all the cmake commands and UI elements) is set to true,
  // if there is at least one folder with full features set enabled.
  // We need to add this private _enableFullFeaturesSetOnWorkspace here
  // because currently there is no way of reading a context variable
  // like cmake:enableFullFeatureSet, to apply the OR operation on it.
  private _enableFullFeatureSetOnWorkspace = false;
  public enableFullFeatureSet(fullFeatureSet: boolean, folder: vscode.WorkspaceFolder) {
    this.getFolderContext(folder).ignoreCMakeListsMissing = !fullFeatureSet;
    this._enableFullFeatureSetOnWorkspace = this._enableFullFeatureSetOnWorkspace || fullFeatureSet;
    util.setContextValue("cmake:enableFullFeatureSet", this._enableFullFeatureSetOnWorkspace);
    this._statusBar.setVisible(this._enableFullFeatureSetOnWorkspace);
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
  private readonly _statusBar = new StatusBar(this._workspaceConfig);
  // Subscriptions for status bar items:
  private _statusMessageSub: vscode.Disposable = new DummyDisposable();
  private _targetNameSub: vscode.Disposable = new DummyDisposable();
  private _buildTypeSub: vscode.Disposable = new DummyDisposable();
  private _launchTargetSub: vscode.Disposable = new DummyDisposable();
  private _ctestEnabledSub: vscode.Disposable = new DummyDisposable();
  private _testResultsSub: vscode.Disposable = new DummyDisposable();
  private _isBusySub: vscode.Disposable = new DummyDisposable();

  // Watch the code model so that we may update teh tree view
  // <fspath, sub>
  private readonly _codeModelUpdateSubs = new Map<string, vscode.Disposable[]>();

  /**
   * The project outline tree data provider
   */
  private readonly _projectOutlineProvider = new ProjectOutlineProvider();
  private readonly _projectOutlineTreeView = vscode.window.createTreeView('cmake.outline', {
    treeDataProvider: this._projectOutlineProvider,
    showCollapseAll: true
  });

  /**
   * CppTools project configuration provider. Tells cpptools how to search for
   * includes, preprocessor defs, etc.
   */
  private readonly _configProvider = new CppConfigurationProvider();
  private _cppToolsAPI?: cpt.CppToolsApi;
  private _configProviderRegister?: Promise<void>;

  private _checkFolderArgs(folder?: vscode.WorkspaceFolder): CMakeToolsFolder | undefined {
    let cmtFolder: CMakeToolsFolder | undefined;
    if (folder) {
      cmtFolder = this._folders.get(folder);
    } else if (this._folders.activeFolder) {
      cmtFolder = this._folders.activeFolder;
    }
    return cmtFolder;
  }

  private _checkStringFolderArgs(folder?: vscode.WorkspaceFolder | string): vscode.WorkspaceFolder | undefined {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1) {
      // We don't want to break existing setup for single root projects.
      return vscode.workspace.workspaceFolders[0];
    }
    if (util.isString(folder)) {
      // Expected schema is file...
      return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folder as string));
    }
    const workspaceFolder = folder as vscode.WorkspaceFolder;
    if (util.isNullOrUndefined(folder) || util.isNullOrUndefined(workspaceFolder.uri)) {
      return this._folders.activeFolder?.folder;
    }
    return workspaceFolder;
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
  private async _ensureActiveKit(cmt?: CMakeTools): Promise<boolean> {
    if (!cmt) {
      cmt = this._folders.activeFolder?.cmakeTools;
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
    const did_choose_kit = await this.selectKit(cmt.folder);
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
    this._codeModelUpdateSubs.forEach(
      subs => subs.forEach(
        sub => sub.dispose()
      )
    );
    this._onDidChangeActiveTextEditorSub.dispose();
    // tslint:disable-next-line: no-floating-promises
    this._kitsWatcher.close();
    this._projectOutlineTreeView.dispose();
    if (this._cppToolsAPI) {
      this._cppToolsAPI.dispose();
    }
    // Dispose of each CMake Tools we still have loaded
    for (const cmtf of this._folders) {
      await cmtf.cmakeTools.asyncDispose();
    }
    this._folders.dispose();
    await telemetry.deactivate();
  }

  async _postWorkspaceOpen(info: CMakeToolsFolder) {
    const ws = info.folder;
    const cmt = info.cmakeTools;

    // Silent re-scan when detecting a breaking change in the kits definition.
    // Do this only for the first folder, to avoid multiple rescans taking place in a multi-root workspace.
    const silentScanForKitsNeeded: boolean = vscode.workspace.workspaceFolders !== undefined &&
                                             vscode.workspace.workspaceFolders[0] === cmt.folder &&
                                             await scanForKitsIfNeeded(cmt);

    let should_configure = cmt.workspaceContext.config.configureOnOpen;
    if (should_configure === null && process.env['CMT_TESTING'] !== '1') {
      interface Choice1 {
        title: string;
        doConfigure: boolean;
      }
      const chosen = await vscode.window.showInformationMessage<Choice1>(
          localize('configure.this.project', 'Would you like to configure project \'{0}\'?', ws.name),
          {},
          {title: localize('yes.button', 'Yes'), doConfigure: true},
          {title: localize('not.now.button', 'Not now'), doConfigure: false},
      );
      if (!chosen) {
        // Do nothing. User cancelled
        return;
      }
      const perist_message = chosen.doConfigure ?
            localize('always.configure.on.open', 'Always configure projects upon opening?') :
            localize('never.configure.on.open', 'Configure projects on opening?');
      const button_messages = chosen.doConfigure ?
            [ localize('yes.button', 'Yes'), localize('no.button', 'No') ] :
            [ localize('never.button', 'Never'), localize('never.for.this.workspace.button', 'Not this workspace') ];
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
                    {title: button_messages[0], persistMode: 'user'},
                    {title: button_messages[1], persistMode: 'workspace'},
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
      await cmt.configureInternal(ConfigureTrigger.configureOnOpen, [], ConfigureType.Normal);
    } else if (silentScanForKitsNeeded) {
      // This popup will show up the first time after deciding not to configure, if a version change has been detected
      // in the kits definition. This may happen during a CMake Tools extension upgrade.
      // The warning is emitted only once because scanForKitsIfNeeded returns true only once after such change,
      // being tied to a global state variable.
      const configureButtonMessage = localize('configure.now.button', 'Configure Now');
      const result = await vscode.window.showWarningMessage(localize('configure.recommended', 'It is recommended to reconfigure after upgrading to a new kits definition.'), configureButtonMessage);
      if (result === configureButtonMessage) {
        // Ensure that there is a kit. This is required for new instances.
        if (!await this._ensureActiveKit(cmt)) {
          return;
        }
        await cmt.configureInternal(ConfigureTrigger.buttonNewKitsDefinition, [], ConfigureType.Normal);
      }
    }
    this._updateCodeModel(info);
  }

  private async _onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (vscode.workspace.workspaceFolders) {
      let ws: vscode.WorkspaceFolder | undefined;
      if (editor) {
        ws = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      }
      if (ws && (!this._folders.activeFolder || ws.uri.fsPath !== this._folders.activeFolder.folder.uri.fsPath)) {
        // active folder changed.
        await this._setActiveFolder(ws);
      } else if (!ws && !this._folders.activeFolder && vscode.workspace.workspaceFolders.length >= 1) {
        await this._setActiveFolder(vscode.workspace.workspaceFolders[0]);
      } else if (!ws) {
        // When adding a folder but the focus is on somewhere else
        // Do nothing but make sure we are showing the active folder correctly
        this._statusBar.update();
      }
    }
  }

  /**
   * Show UI to allow the user to select an active kit
   */
  async selectActiveFolder() {
    if (vscode.workspace.workspaceFolders?.length) {
      const lastActiveFolderPath = this._folders.activeFolder?.folder.uri.fsPath;
      const selection = await vscode.window.showWorkspaceFolderPick();
      if (selection) {
        // Ingore if user cancelled
        await this._setActiveFolder(selection);
        telemetry.logEvent("selectactivefolder");
        // _folders.activeFolder must be there at this time
        const currentActiveFolderPath = this._folders.activeFolder!.folder.uri.fsPath;
        this.extensionContext.workspaceState.update('activeFolder', currentActiveFolderPath);
        if (lastActiveFolderPath !== currentActiveFolderPath) {
          rollbar.takePromise('Post-folder-open', {folder: selection}, this._postWorkspaceOpen(this._folders.activeFolder!));
        }
      }
    }
  }

  private _initActiveFolder() {
    if (vscode.window.activeTextEditor && this._workspaceConfig.autoSelectActiveFolder) {
       return this._onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
    }
    const activeFolder = this.extensionContext.workspaceState.get<string>('activeFolder');
    let folder: vscode.WorkspaceFolder | undefined;
    if (activeFolder) {
      folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(activeFolder));
    }
    if (!folder) {
      folder = vscode.workspace.workspaceFolders![0];
    }
    return this._setActiveFolder(folder);
  }

  /**
   * Set the active workspace folder. This reloads a lot of different bits and
   * pieces to control which backend has control and receives user input.
   * @param ws The workspace to activate
   */
  private async _setActiveFolder(ws: vscode.WorkspaceFolder | undefined) {
    // Set the new workspace
    this._folders.setActiveFolder(ws);
    this._statusBar.setActiveFolderName(ws?.name || '');
    this._statusBar.setActiveKitName(this._folders.activeFolder?.cmakeTools.activeKit?.name || '');
    this._projectOutlineProvider.setActiveFolder(ws);
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
    ]) {
      sub.dispose();
    }
  }

  private cpptoolsNumFoldersReady: number = 0;
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
        this._cppToolsAPI = await cpt.getCppToolsApi(cpt.Version.v4);
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
        this._configProvider.cpptoolsVersion = cpptools.getVersion();
        this._configProvider.updateConfigurationData({cache, codeModel, clCompilerPath, activeTarget: cmt.defaultBuildTarget, folder: cmt.folder.uri.fsPath});
        await this.ensureCppToolsProviderRegistered();
        if (cpptools.notifyReady && this.cpptoolsNumFoldersReady < this._folders.size) {
          ++this.cpptoolsNumFoldersReady;
          if (this.cpptoolsNumFoldersReady === this._folders.size) {
            cpptools.notifyReady(this._configProvider);
          }
        } else {
          cpptools.didChangeCustomConfiguration(this._configProvider);
        }
      }
    });
  }

  private _setupSubscriptions() {
    this._disposeSubs();
    const folder = this._folders.activeFolder;
    const cmt = folder?.cmakeTools;
    if (!cmt) {
      this._statusBar.setVisible(false);
      this._statusMessageSub = new DummyDisposable();
      this._targetNameSub = new DummyDisposable();
      this._buildTypeSub = new DummyDisposable();
      this._launchTargetSub = new DummyDisposable();
      this._ctestEnabledSub = new DummyDisposable();
      this._testResultsSub = new DummyDisposable();
      this._isBusySub = new DummyDisposable();
      this._statusBar.setActiveKitName('');
    } else {
      this._statusBar.setVisible(true);
      this._statusMessageSub = cmt.onStatusMessageChanged(FireNow, s => this._statusBar.setStatusMessage(s));
      this._targetNameSub = cmt.onTargetNameChanged(FireNow, t => {
        this._statusBar.setBuildTargetName(t);
      });
      this._buildTypeSub = cmt.onActiveVariantChanged(FireNow, bt => this._statusBar.setVariantLabel(bt));
      this._launchTargetSub = cmt.onLaunchTargetNameChanged(FireNow, t => {
        this._statusBar.setLaunchTargetName(t || '');
      });
      this._ctestEnabledSub = cmt.onCTestEnabledChanged(FireNow, e => this._statusBar.setCTestEnabled(e));
      this._testResultsSub = cmt.onTestResultsChanged(FireNow, r => this._statusBar.setTestResults(r));
      this._isBusySub = cmt.onIsBusyChanged(FireNow, b => this._statusBar.setIsBusy(b));
      this._statusBar.setActiveKitName(cmt.activeKit ? cmt.activeKit.name : '');
    }
  }

  /**
   * Watches for changes to the kits file
   */
  private readonly _kitsWatcher =
   util.chokidarOnAnyChange(chokidar.watch(USER_KITS_FILEPATH,
                                           {ignoreInitial: true}),
                                           _ => rollbar.takePromise(localize('rereading.kits', 'Re-reading kits'), {}, KitsController.readUserKits(this._folders.activeFolder?.cmakeTools)));


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
    const cmakeTools = this._folders.activeFolder?.cmakeTools;
    if (undefined === cmakeTools) {
      return;
    }

    const duplicateRemoved = await KitsController.scanForKits(cmakeTools);
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
    const result = new Set<string>();
    for (const dir of this._workspaceConfig.mingwSearchDirs) {
      result.add(dir);
    }
    return Array.from(result);
  }

  /**
   * Show UI to allow the user to select an active kit
   */
  async selectKit(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('running.in.test.mode', 'Running CMakeTools in test mode. selectKit is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    const kitName = await cmtFolder.kitsController.selectKit();

    let kitSelectionType;
    if (this._folders.activeFolder && this._folders.activeFolder.cmakeTools.activeKit) {
      this._statusBar.setActiveKitName(this._folders.activeFolder.cmakeTools.activeKit.name);

      if (this._folders.activeFolder.cmakeTools.activeKit.name === "__unspec__") {
        kitSelectionType = "unspecified";
      } else {
        if (this._folders.activeFolder.cmakeTools.activeKit.visualStudio ||
          this._folders.activeFolder.cmakeTools.activeKit.visualStudioArchitecture) {
            kitSelectionType = "vsInstall";
        } else {
          kitSelectionType = "compilerSet";
        }
      }
    }

    if (kitSelectionType) {
      const telemetryProperties: telemetry.Properties = {
        type: kitSelectionType
      };

      telemetry.logEvent('kitSelection', telemetryProperties);
    }

    if (kitName) {
      return true;
    }
    return false;
  }

  /**
   * Set the current kit used in the specified folder by name of the kit
   * For backward compatibility, apply kitName to all folders if folder is undefined
   */
  async setKitByName(kitName: string, folder?: vscode.WorkspaceFolder) {
    if (folder) {
      await this._folders.get(folder)?.kitsController.setKitByName(kitName);
    } else {
      for (const cmtFolder of this._folders) {
        await cmtFolder.kitsController.setKitByName(kitName);
      }
    }
    if (this._folders.activeFolder && this._folders.activeFolder.cmakeTools.activeKit) {
      this._statusBar.setActiveKitName(this._folders.activeFolder.cmakeTools.activeKit.name);
    }
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

  private _cleanOutputChannel() {
    if (this._workspaceConfig.clearOutputBeforeBuild) {
      log.clearOutputChannel();
    }
  }

  // The below functions are all wrappers around the backend.
  async mapCMakeTools(fn: CMakeToolsMapFn, cmt = this._folders.activeFolder? this._folders.activeFolder.cmakeTools : undefined): Promise<any> {
    if (!cmt) {
      rollbar.error(localize('no.active.folder', 'No active folder.'));
      return -2;
    }

    if (await this._ensureActiveKit(cmt)) {
      return fn(cmt);
    }
    return -1;
  }

  async mapCMakeToolsAll(fn: CMakeToolsMapFn, cleanOutputChannel?: boolean): Promise<any> {
    if (cleanOutputChannel) {
      this._cleanOutputChannel();
    }

    for (const folder of this._folders) {
      if (await this._ensureActiveKit(folder.cmakeTools)) {
        const retc = await fn(folder.cmakeTools);
        if (retc) {
          return retc;
        }
      } else {
        return -1;
      }
    }
    // Succeeded
    return 0;
  }

  mapCMakeToolsFolder(fn: CMakeToolsMapFn, folder?: vscode.WorkspaceFolder, cleanOutputChannel?: boolean): Promise<any> {
    if (cleanOutputChannel) {
      this._cleanOutputChannel();
    }

    return this.mapCMakeTools(fn, this._folders.get(folder)?.cmakeTools);
  }

  mapQueryCMakeTools(fn: CMakeToolsQueryMapFn, folder?: vscode.WorkspaceFolder | string) {
    const workspaceFolder = this._checkStringFolderArgs(folder);
    if (workspaceFolder) {
      const cmtFolder = this._folders.get(workspaceFolder);
      if (cmtFolder) {
        return fn(cmtFolder.cmakeTools);
      }
    } else {
      rollbar.error(localize('invalid.folder', 'Invalid folder.'));
    }
    return Promise.resolve(null);
  }

  cleanConfigure(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("deleteCacheAndReconfigure");
    return this.mapCMakeToolsFolder(cmt => cmt.cleanConfigure(ConfigureTrigger.commandCleanConfigure), folder, true);
  }

  cleanConfigureAll() {
    telemetry.logEvent("deleteCacheAndReconfigure");
    return this.mapCMakeToolsAll(cmt => cmt.cleanConfigure(ConfigureTrigger.commandCleanConfigureAll), true);
  }

  configure(folder?: vscode.WorkspaceFolder) { return this.mapCMakeToolsFolder(cmt => cmt.configureInternal(ConfigureTrigger.commandConfigure, [], ConfigureType.Normal), folder, true); }

  configureAll() { return this.mapCMakeToolsAll(cmt => cmt.configureInternal(ConfigureTrigger.commandCleanConfigureAll, [], ConfigureType.Normal), true); }

  openConfiguration() { return this.mapCMakeToolsFolder(cmt => cmt.openConfiguration()); }

  build(folder?: vscode.WorkspaceFolder, name?: string) { return this.mapCMakeToolsFolder(cmt => cmt.build(name), folder, true); }

  buildAll(name: string[]) { return this.mapCMakeToolsAll(cmt => cmt.build(util.isArrayOfString(name) ? name[name.length - 1] : name), true); }

  setDefaultTarget(folder?: vscode.WorkspaceFolder, name?: string) { return this.mapCMakeToolsFolder(cmt => cmt.setDefaultTarget(name), folder); }

  setVariant(folder?: vscode.WorkspaceFolder, name?: string) { return this.mapCMakeToolsFolder(cmt => cmt.setVariant(name), folder); }

  async setVariantAll() {
    // Only supports default variants for now
    const variantItems: vscode.QuickPickItem[] = [];
    const choices = DEFAULT_VARIANTS.buildType!.choices;
    for (const key in choices) {
      variantItems.push({
        label: choices[key]!.short,
        description: choices[key]!.long
      });
    }
    const choice = await vscode.window.showQuickPick(variantItems);
    if (choice) {
      return this.mapCMakeToolsAll(cmt => cmt.setVariant(choice.label));
    }
    return false;
  }

  install(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("install");
    return this.mapCMakeToolsFolder(cmt => cmt.install(), folder, true);
  }

  installAll() {
    telemetry.logEvent("install");
    return this.mapCMakeToolsAll(cmt => cmt.install(), true);
  }

  editCache(folder: vscode.WorkspaceFolder) {
    telemetry.logEvent("editCMakeCache");
    return this.mapCMakeToolsFolder(cmt => cmt.editCache(), folder);
  }

  clean(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("clean");
    return this.build(folder, 'clean');
  }

  cleanAll() {
    telemetry.logEvent("clean");
    return this.buildAll(['clean']);
  }

  cleanRebuild(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("clean");
    return this.mapCMakeToolsFolder(cmt => cmt.cleanRebuild(), folder, true);
  }

  cleanRebuildAll() {
    telemetry.logEvent("clean");
    return this.mapCMakeToolsAll(cmt => cmt.cleanRebuild(), true);
  }

  async buildWithTarget() {
    this._cleanOutputChannel();
    let cmtFolder: CMakeToolsFolder | undefined = this._folders.activeFolder;
    if (!cmtFolder) {
      cmtFolder = await this._pickFolder();
    }
    if (!cmtFolder) {
      return; // Error or nothing is opened
    }
    return cmtFolder.cmakeTools.buildWithTarget();
  }

  /**
   * Compile a single source file.
   * @param file The file to compile. Either a file path or the URI to the file.
   * If not provided, compiles the file in the active text editor.
   */
  async compileFile(file?: string|vscode.Uri) {
    this._cleanOutputChannel();
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

  async selectWorkspace(folder?: vscode.WorkspaceFolder) {
    if (!folder) return;
    await this._setActiveFolder(folder);
  }

  ctest(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("runTests");
    return this.mapCMakeToolsFolder(cmt => cmt.ctest(), folder);
  }

  ctestAll() {
    telemetry.logEvent("runTests");
    return this.mapCMakeToolsAll(cmt => cmt.ctest());
  }

  stop(folder?: vscode.WorkspaceFolder) { return this.mapCMakeToolsFolder(cmt => cmt.stop(), folder); }

  stopAll() { return this.mapCMakeToolsAll(cmt => cmt.stop()); }

  quickStart(folder?: vscode.WorkspaceFolder) {
    const cmtFolder = this._checkFolderArgs(folder);
    telemetry.logEvent("quickStart");
    return this.mapCMakeTools(cmt => cmt.quickStart(cmtFolder));
  }

  launchTargetPath(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "launchTargetPath"});
    return this.mapQueryCMakeTools(cmt => cmt.launchTargetPath(), folder);
  }

  launchTargetDirectory(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "launchTargetDirectory"});
    return this.mapQueryCMakeTools(cmt => cmt.launchTargetDirectory(), folder);
  }

  launchTargetFilename(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "launchTargetFilename"});
    return this.mapQueryCMakeTools(cmt => cmt.launchTargetFilename(), folder);
  }

  getLaunchTargetPath(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "getLaunchTargetPath"});
    return this.mapQueryCMakeTools(cmt => cmt.getLaunchTargetPath(), folder);
  }

  getLaunchTargetDirectory(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "getLaunchTargetDirectory"});
    return this.mapQueryCMakeTools(cmt => cmt.getLaunchTargetDirectory(), folder);
  }

  getLaunchTargetFilename(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "getLaunchTargetFilename"});
    return this.mapQueryCMakeTools(cmt => cmt.getLaunchTargetFilename(), folder);
  }

  buildTargetName(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "buildTargetName"});
    return this.mapQueryCMakeTools(cmt => cmt.buildTargetName(), folder);
  }

  buildType(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "buildType"});
    return this.mapQueryCMakeTools(cmt => cmt.currentBuildType(), folder);
  }

  buildDirectory(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "buildDirectory"});
    return this.mapQueryCMakeTools(cmt => cmt.buildDirectory(), folder);
  }

  buildKit(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "buildKit"});
    return this.mapQueryCMakeTools(cmt => cmt.buildKit(), folder);
  }

  executableTargets(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "executableTargets"});
    return this.mapQueryCMakeTools(async cmt => (await cmt.executableTargets).map(target => target.name), folder);
  }

  async tasksBuildCommand(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "tasksBuildCommand"});
    return this.mapQueryCMakeTools(cmt => cmt.tasksBuildCommand(), folder);
  }

  async debugTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.DebugSession | null> { return this.mapCMakeToolsFolder(cmt => cmt.debugTarget(name), folder); }

  async debugTargetAll(): Promise<(vscode.DebugSession | null)[]> {
    const debugSessions: (vscode.DebugSession | null)[] = [];
    for (const cmtFolder of this._folders) {
      if (cmtFolder) {
        debugSessions.push(await this.mapCMakeTools(cmt => cmt.debugTarget(), cmtFolder.cmakeTools));
      }
    }
    return debugSessions;
  }

  async launchTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.Terminal | null> { return this.mapCMakeToolsFolder(cmt => cmt.launchTarget(name), folder); }

  async launchTargetAll(): Promise<(vscode.Terminal | null)[]> {
    const terminals: (vscode.Terminal | null)[] = [];
    for (const cmtFolder of this._folders) {
      if (cmtFolder) {
        terminals.push(await this.mapCMakeTools(cmt => cmt.launchTarget(), cmtFolder.cmakeTools));
      }
    }
    return terminals;
  }

  selectLaunchTarget(folder?: vscode.WorkspaceFolder, name?: string) { return this.mapCMakeToolsFolder(cmt => cmt.selectLaunchTarget(name), folder); }

  resetState(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("resetExtension");
    return this.mapCMakeToolsFolder(cmt => cmt.resetState(), folder);
  }

  async viewLog() {
    telemetry.logEvent("openLogFile");
    await logging.showLogFile();
  }

  async hideLaunchCommand(shouldHide: boolean = true) {
    // Don't hide command selectLaunchTarget here since the target can still be useful, one example is ${command:cmake.launchTargetPath} in launch.json
    this._statusBar.hideLaunchButton(shouldHide);
    await util.setContextValue(HIDE_LAUNCH_COMMAND_KEY, shouldHide);
  }

  async hideDebugCommand(shouldHide: boolean = true) {
    // Don't hide command selectLaunchTarget here since the target can still be useful, one example is ${command:cmake.launchTargetPath} in launch.json
    this._statusBar.hideDebugButton(shouldHide);
    await util.setContextValue(HIDE_DEBUG_COMMAND_KEY, shouldHide);
  }

  async hideBuildCommand(shouldHide: boolean = true) {
    this._statusBar.hideBuildButton(shouldHide);
    await util.setContextValue(HIDE_BUILD_COMMAND_KEY, shouldHide);
  }

  // Helper that loops through all the workspace folders to enable full or partial feature set
  // depending on their 'ignoreCMakeListsMissing' state variable.
  enableWorkspaceFoldersFullFeatureSet() {
    for (const cmtFolder of this._folders) {
      this.enableFullFeatureSet(!this.getFolderContext(cmtFolder.folder)?.ignoreCMakeListsMissing, cmtFolder.folder);
    }
  }
}

/**
 * The global extension manager. There is only one of these, even if multiple
 * backends.
 */
let _EXT_MANAGER: ExtensionManager|null = null;
let cmakeTaskProvider: vscode.Disposable | undefined;

export async function registerTaskProvider(command: string | null) {
  if (command) {
    rollbar.invokeAsync(localize('registerTaskProvider', 'Register the task provider.'), async () => {
      if (cmakeTaskProvider) {
        cmakeTaskProvider.dispose();
      }

      cmakeTaskProvider = vscode.tasks.registerTaskProvider(CMakeTaskProvider.CMakeType, new CMakeTaskProvider({ build: command }));
    });
  }
}

async function setup(context: vscode.ExtensionContext, progress: ProgressHandle) {
  reportProgress(progress, localize('initial.setup', 'Initial setup'));

  // Load a new extension manager
  const ext = _EXT_MANAGER = await ExtensionManager.create(context);

  // Enable full or partial feature set for each workspace folder, depending on their state variable.
  ext.enableWorkspaceFoldersFullFeatureSet();

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
    'openConfiguration',
    'ctest',
    'ctestAll',
    'stop',
    'stopAll',
    'quickStart',
    'launchTargetPath',
    'launchTargetDirectory',
    'launchTargetFilename',
    'getLaunchTargetPath',
    'getLaunchTargetDirectory',
    'getLaunchTargetFilename',
    'buildTargetName',
    'buildKit',
    'buildType',
    'buildDirectory',
    'executableTargets',
    'debugTarget',
    'debugTargetAll',
    'launchTarget',
    'launchTargetAll',
    'selectLaunchTarget',
    'setDefaultTarget',
    'resetState',
    'viewLog',
    'compileFile',
    'selectWorkspace',
    'tasksBuildCommand',
    'hideLaunchCommand',
    'hideDebugCommand',
    'hideBuildCommand'
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
      vscode.commands.registerCommand('cmake.outline.configureAll', () => runCommand('configureAll')),
      vscode.commands.registerCommand('cmake.outline.buildAll', () => runCommand('buildAll')),
      vscode.commands.registerCommand('cmake.outline.stopAll', () => runCommand('stopAll')),
      vscode.commands.registerCommand('cmake.outline.cleanAll', () => runCommand('cleanAll')),
      vscode.commands.registerCommand('cmake.outline.cleanConfigureAll', () => runCommand('cleanConfigureAll')),
      vscode.commands.registerCommand('cmake.outline.openConfiguration', () => runCommand('openConfiguration')),
      vscode.commands.registerCommand('cmake.outline.cleanRebuildAll', () => runCommand('cleanRebuildAll')),
      // Commands for outline items:
      vscode.commands.registerCommand('cmake.outline.buildTarget',
                                      (what: TargetNode) => runCommand('build', what.folder, what.name)),
      vscode.commands.registerCommand('cmake.outline.runUtilityTarget',
                                      (what: TargetNode) => runCommand('build', what.folder, what.name)),
      vscode.commands.registerCommand('cmake.outline.debugTarget',
                                      (what: TargetNode) => runCommand('debugTarget', what.folder, what.name)),
      vscode.commands.registerCommand('cmake.outline.launchTarget',
                                      (what: TargetNode) => runCommand('launchTarget', what.folder, what.name)),
      vscode.commands.registerCommand('cmake.outline.setDefaultTarget',
                                      (what: TargetNode) => runCommand('setDefaultTarget', what.folder, what.name)),
      vscode.commands.registerCommand('cmake.outline.setLaunchTarget',
                                      (what: TargetNode) => runCommand('selectLaunchTarget', what.folder, what.name)),
      vscode.commands.registerCommand('cmake.outline.revealInCMakeLists',
                                      (what: TargetNode) => what.openInCMakeLists()),
      vscode.commands.registerCommand('cmake.outline.compileFile',
                                      (what: SourceFileNode) => runCommand('compileFile', what.filePath)),
      vscode.commands.registerCommand('cmake.outline.selectWorkspace',
                                      (what: WorkspaceFolderNode) => runCommand('selectWorkspace', what.wsFolder)),
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

export async function enableFullFeatureSet(fullFeatureSet: boolean, folder: vscode.WorkspaceFolder) {
    _EXT_MANAGER?.enableFullFeatureSet(fullFeatureSet, folder);
}

// this method is called when your extension is deactivated
export async function deactivate() {
  log.debug(localize('deactivate.cmaketools', 'Deactivate CMakeTools'));
  if (_EXT_MANAGER) {
    await _EXT_MANAGER.asyncDispose();
  }
  if (cmakeTaskProvider) {
    cmakeTaskProvider.dispose();
  }
}
