/* eslint-disable no-unused-expressions */
/**
 * Extension startup/teardown
 */

'use strict';

import * as chokidar from 'chokidar';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';
import * as nls from 'vscode-nls';

import {CMakeCache} from '@cmt/cache';
import {CMakeTools, ConfigureType, ConfigureTrigger} from '@cmt/cmake-tools';
import {ConfigurationReader, TouchBarConfig} from '@cmt/config';
import {CppConfigurationProvider, DiagnosticsCpptools} from '@cmt/cpptools';
import {CMakeToolsFolderController, CMakeToolsFolder, DiagnosticsConfiguration, DiagnosticsSettings} from '@cmt/folders';
import {
  Kit,
  USER_KITS_FILEPATH,
  findCLCompilerPath,
  scanForKitsIfNeeded
} from '@cmt/kit';
import { IExperimentationService } from 'vscode-tas-client';
import {KitsController} from '@cmt/kitsController';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import {FireNow, FireLate} from '@cmt/prop';
import rollbar from '@cmt/rollbar';
import {StateManager} from './state';
import {StatusBar} from '@cmt/status';
import {CMakeTaskProvider} from '@cmt/cmakeTaskProvider';
import * as telemetry from '@cmt/telemetry';
import {ProjectOutlineProvider, TargetNode, SourceFileNode, WorkspaceFolderNode} from '@cmt/tree';
import * as util from '@cmt/util';
import {ProgressHandle, DummyDisposable, reportProgress} from '@cmt/util';
import {DEFAULT_VARIANTS} from '@cmt/variant';
import {expandString, KitContextVars} from '@cmt/expand';
import paths from '@cmt/paths';
import {CMakeDriver, CMakePreconditionProblems} from './drivers/driver';
import {platform} from 'os';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const cmakeTaskProvider: CMakeTaskProvider = new CMakeTaskProvider();
let taskProvider: vscode.Disposable;

const log = logging.createLogger('extension');

const MULTI_ROOT_MODE_KEY = 'cmake:multiRoot';
const HIDE_LAUNCH_COMMAND_KEY = 'cmake:hideLaunchCommand';
const HIDE_DEBUG_COMMAND_KEY = 'cmake:hideDebugCommand';
const HIDE_BUILD_COMMAND_KEY = 'cmake:hideBuildCommand';

/**
 * The global extension manager. There is only one of these, even if multiple
 * backends.
 */
let _EXT_MANAGER: ExtensionManager|null = null;

type CMakeToolsMapFn = (cmt: CMakeTools) => Thenable<any>;
type CMakeToolsQueryMapFn = (cmt: CMakeTools) => Thenable<string | string[] | null>;

interface Diagnostics {
  os: string;
  vscodeVersion: string;
  cmtVersion: string;
  configurations: DiagnosticsConfiguration[];
  settings: DiagnosticsSettings[];
  cpptoolsIntegration: DiagnosticsCpptools;
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
  constructor(public readonly extensionContext: vscode.ExtensionContext) {
    telemetry.activate(extensionContext);
    this.showCMakeLists = new Promise<boolean>(resolve => {
      const experimentationService: Promise<IExperimentationService | undefined> | undefined = telemetry.getExperimentationService();
      if (experimentationService) {
        void experimentationService
              .then(expSrv => expSrv!.getTreatmentVariableAsync<boolean>("vscode", "partialActivation_showCMakeLists"))
              .then(showCMakeLists => {
                if (showCMakeLists !== undefined) {
                  resolve(showCMakeLists);
                } else {
                  resolve(false);
                }
              });
      } else {
        resolve(false);
      }
    });

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
        if (this._workspaceConfig.autoSelectActiveFolder) {
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
        subs.push(new_cmt.onActiveBuildPresetChanged(FireLate, () => this._updateCodeModel(cmtFolder)));
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

        // Update the full/partial view of the workspace by verifying if after the folder removal
        // it still has at least one CMake project.
        await enableFullFeatureSet(await this.workspaceHasCMakeProject());
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
      if (this._folders.isMultiRoot) {
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
  private _onUseCMakePresetsChangedSub: vscode.Disposable = new DummyDisposable();

  private readonly _workspaceConfig: ConfigurationReader = ConfigurationReader.create();

  private updateTouchBarVisibility(config: TouchBarConfig) {
    const touchBarVisible = config.visibility === "default";
    void util.setContextValue("cmake:enableTouchBar", touchBarVisible);
    void util.setContextValue("cmake:enableTouchBar.build", touchBarVisible && !(config.advanced?.build === "hidden"));
    void util.setContextValue("cmake:enableTouchBar.configure", touchBarVisible && !(config.advanced?.configure === "hidden"));
    void util.setContextValue("cmake:enableTouchBar.debug", touchBarVisible && !(config.advanced?.debug === "hidden"));
    void util.setContextValue("cmake:enableTouchBar.launch", touchBarVisible && !(config.advanced?.launch === "hidden"));
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
        this._onUseCMakePresetsChangedSub = cmtFolder.onUseCMakePresetsChanged(useCMakePresets => this._statusBar.useCMakePresets(useCMakePresets));
        this._codeModelUpdateSubs.set(cmtFolder.folder.uri.fsPath, [
          cmtFolder.cmakeTools.onCodeModelChanged(FireLate, () => this._updateCodeModel(cmtFolder)),
          cmtFolder.cmakeTools.onTargetNameChanged(FireLate, () => this._updateCodeModel(cmtFolder)),
          cmtFolder.cmakeTools.onLaunchTargetNameChanged(FireLate, () => this._updateCodeModel(cmtFolder)),
          cmtFolder.cmakeTools.onActiveBuildPresetChanged(FireLate, () => this._updateCodeModel(cmtFolder))
        ]);
        rollbar.takePromise('Post-folder-open', {folder: cmtFolder.folder}, this._postWorkspaceOpen(cmtFolder));
      }
    }

    const isFullyActivated: boolean = await this.workspaceHasCMakeProject();
    if (isFullyActivated) {
      await enableFullFeatureSet(true);
    }

    const telemetryProperties: telemetry.Properties = {
      isMultiRoot: `${isMultiRoot}`,
      isFullyActivated: `${isFullyActivated}`
    };
    if (isMultiRoot) {
      telemetryProperties['autoSelectActiveFolder'] = `${this._workspaceConfig.autoSelectActiveFolder}`;
    }
    telemetry.logEvent('open', telemetryProperties);
  }

  public getFolderContext(folder: vscode.WorkspaceFolder): StateManager {
    return new StateManager(this.extensionContext, folder);
  }

  public showStatusBar(fullFeatureSet: boolean) {
    this._statusBar.setVisible(fullFeatureSet);
  }

  public getCMTFolder(folder: vscode.WorkspaceFolder): CMakeToolsFolder | undefined {
    return this._folders.get(folder);
  }

  public isActiveFolder(cmt: CMakeToolsFolder): boolean {
    return this._folders.activeFolder === cmt;
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

  private showCMakeLists: Promise<boolean>;
  public expShowCMakeLists(): Promise<boolean> {
    return this.showCMakeLists;
  }

  /**
   * The folder controller manages multiple instances. One per folder.
   */
  private readonly _folders = new CMakeToolsFolderController(this.extensionContext);

  /**
   * The map caching for each folder whether it is a CMake project or not.
   */
   private readonly _foldersAreCMake: Map<string, boolean> = new Map<string, boolean>();

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
  private _activeConfigurePresetSub: vscode.Disposable = new DummyDisposable();
  private _activeBuildPresetSub: vscode.Disposable = new DummyDisposable();
  private _activeTestPresetSub: vscode.Disposable = new DummyDisposable();

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
  private _configProviderRegistered?: boolean = false;

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
   * Ensure that there is an active kit or configure preset for the current CMakeTools.
   *
   * @returns `false` if there is not active CMakeTools, or it has no active kit
   * and the user cancelled the kit selection dialog.
   */
  private async _ensureActiveConfigurePresetOrKit(cmt?: CMakeTools): Promise<boolean> {
    if (!cmt) {
      cmt = this._folders.activeFolder?.cmakeTools;
    }
    if (!cmt) {
      // No CMakeTools. Probably no workspace open.
      return false;
    }

    if (cmt.useCMakePresets) {
      if (cmt.configurePreset) {
        return true;
      }
      const did_choose_preset = await this.selectConfigurePreset(cmt.folder);
      if (!did_choose_preset && !cmt.configurePreset) {
        return false;
      }
      return !!cmt.configurePreset;
    } else {
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
  }

  /**
   * Ensure that there is an active build preset for the current CMakeTools.
   * We pass this in function calls so make it an lambda instead of a function.
   *
   * @returns `false` if there is not active CMakeTools, or it has no active preset
   * and the user cancelled the preset selection dialog.
   */
  private readonly _ensureActiveBuildPreset = async (cmt?: CMakeTools): Promise<boolean> => {
    if (!cmt) {
      cmt = this._folders.activeFolder?.cmakeTools;
    }
    if (!cmt) {
      // No CMakeTools. Probably no workspace open.
      return false;
    }
    if (cmt.useCMakePresets) {
      if (cmt.buildPreset) {
        return true;
      }
      const did_choose_preset = await this.selectBuildPreset(cmt.folder);
      if (!did_choose_preset && !cmt.buildPreset) {
        return false;
      }
      return !!cmt.buildPreset;
    }
    return true;
  };

  private readonly _ensureActiveTestPreset = async (cmt?: CMakeTools): Promise<boolean> => {
    if (!cmt) {
      cmt = this._folders.activeFolder?.cmakeTools;
    }
    if (!cmt) {
      // No CMakeTools. Probably no workspace open.
      return false;
    }
    if (cmt.useCMakePresets) {
      if (cmt.testPreset) {
        return true;
      }
      const did_choose_preset = await this.selectTestPreset(cmt.folder);
      if (!did_choose_preset && !cmt.testPreset) {
        return false;
      }
      return !!cmt.testPreset;
    }
    return true;
  };

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
    this._onUseCMakePresetsChangedSub.dispose();
    void this._kitsWatcher.close();
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

  async configureExtensionInternal(trigger: ConfigureTrigger, cmt: CMakeTools): Promise<void> {
    if (!await this._ensureActiveConfigurePresetOrKit(cmt)) {
      return;
    }

    await cmt.configureInternal(trigger, [], ConfigureType.Normal);
  }

  // This method evaluates whether the given folder represents a CMake project
  // (does have a valid CMakeLists.txt at the location pointed to by the "cmake.sourceDirectory" setting)
  // and also stores the answer in a map for later use.
  async folderIsCMakeProject(cmt: CMakeTools): Promise<boolean> {
    if (this._foldersAreCMake.get(cmt.folderName)) {
      return true;
    }

    const optsVars: KitContextVars = {
      userHome: paths.userHome,
      workspaceFolder: cmt.workspaceContext.folder.uri.fsPath,
      workspaceFolderBasename: cmt.workspaceContext.folder.name,
      workspaceRoot: cmt.workspaceContext.folder.uri.fsPath,
      workspaceRootFolderName: cmt.workspaceContext.folder.name,

      // sourceDirectory cannot be defined based on any of the below variables.
      buildKit: "",
      buildType: "",
      generator: "",
      buildKitVendor: "",
      buildKitTriple: "",
      buildKitVersion: "",
      buildKitHostOs: "",
      buildKitTargetOs: "",
      buildKitTargetArch: "",
      buildKitVersionMajor: "",
      buildKitVersionMinor: "",
      workspaceHash: ""
    };

    const sourceDirectory: string = cmt.workspaceContext.config.sourceDirectory;
    let expandedSourceDirectory: string = util.lightNormalizePath(await expandString(sourceDirectory, { vars: optsVars }));
    if (path.basename(expandedSourceDirectory).toLocaleLowerCase() !== "cmakelists.txt") {
      expandedSourceDirectory = path.join(expandedSourceDirectory, "CMakeLists.txt");
    }

    const isCMake = await fs.exists(expandedSourceDirectory);
    this._foldersAreCMake.set(cmt.folderName, isCMake);

    return isCMake;
  }

  async _postWorkspaceOpen(info: CMakeToolsFolder) {
    const ws = info.folder;
    const cmt = info.cmakeTools;

    // Scan for kits even under presets mode, so we can create presets from compilers.
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
          {title: localize('not.now.button', 'Not now'), doConfigure: false}
      );
      if (!chosen) {
        // User cancelled.
        should_configure = null;
      } else {
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
                      {title: button_messages[1], persistMode: 'workspace'}
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
    }

    if (!await this.folderIsCMakeProject(cmt)) {
      await cmt.cmakePreConditionProblemHandler(CMakePreconditionProblems.MissingCMakeListsFile, false, this._workspaceConfig);
    } else {
      if (should_configure === true) {
        // We've opened a new workspace folder, and the user wants us to
        // configure it now.
        log.debug(localize('configuring.workspace.on.open', 'Configuring workspace on open {0}', ws.uri.toString()));
        await this.configureExtensionInternal(ConfigureTrigger.configureOnOpen, cmt);
      } else {
        const configureButtonMessage = localize('configure.now.button', 'Configure Now');
        let result: string | undefined;
        if (silentScanForKitsNeeded) {
          // This popup will show up the first time after deciding not to configure, if a version change has been detected
          // in the kits definition. This may happen during a CMake Tools extension upgrade.
          // The warning is emitted only once because scanForKitsIfNeeded returns true only once after such change,
          // being tied to a global state variable.
          result = await vscode.window.showWarningMessage(localize('configure.recommended', 'It is recommended to reconfigure after upgrading to a new kits definition.'), configureButtonMessage);
        }
        if (result === configureButtonMessage) {
          await this.configureExtensionInternal(ConfigureTrigger.buttonNewKitsDefinition, cmt);
        } else {
          log.debug(localize('using.cache.to.configure.workspace.on.open', 'Using cache to configure workspace on open {0}', ws.uri.toString()));
          await this.configureExtensionInternal(ConfigureTrigger.configureWithCache, cmt);
        }
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
        await this.extensionContext.workspaceState.update('activeFolder', currentActiveFolderPath);
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
    const activeFolder = this._folders.activeFolder;
    const useCMakePresets = activeFolder?.useCMakePresets || false;
    this._statusBar.useCMakePresets(useCMakePresets);
    if (!useCMakePresets) {
      this._statusBar.setActiveKitName(activeFolder?.cmakeTools.activeKit?.name || '');
    }
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
                       this._activeConfigurePresetSub,
                       this._activeBuildPresetSub,
                       this._activeTestPresetSub
    ]) {
      sub.dispose();
    }
  }

  private cpptoolsNumFoldersReady: number = 0;
  private _updateCodeModel(folder: CMakeToolsFolder) {
    const cmt: CMakeTools = folder.cmakeTools;
    this._projectOutlineProvider.updateCodeModel(
      cmt.workspaceContext.folder,
      cmt.codeModelContent,
      {
        defaultTarget: cmt.defaultBuildTarget || undefined,
        launchTargetName: cmt.launchTargetName
      }
    );
    rollbar.invokeAsync(localize('update.code.model.for.cpptools', 'Update code model for cpptools'), {}, async () => {
      if (vscode.workspace.getConfiguration('C_Cpp', folder.folder).get<string>('intelliSenseEngine')?.toLocaleLowerCase() === 'disabled') {
        log.debug(localize('update.intellisense.disabled', 'Not updating the configuration provider because C_Cpp.intelliSenseEngine is set to \'Disabled\''));
        return;
      }
      if (!this._cppToolsAPI) {
        this._cppToolsAPI = await cpt.getCppToolsApi(cpt.Version.v5);
      }

      if (this._cppToolsAPI && (cmt.activeKit || cmt.configurePreset)) {
        const cpptools = this._cppToolsAPI;
        let cache: CMakeCache;
        try {
          cache = await CMakeCache.fromPath(await cmt.cachePath);
        } catch (e) {
          rollbar.exception(localize('filed.to.open.cache.file.on.code.model.update', 'Failed to open CMake cache file on code model update'), e);
          return;
        }
        const drv: CMakeDriver | null = await cmt.getCMakeDriverInstance();
        const configureEnv = await drv?.getConfigureEnvironment();
        const env = configureEnv ?? process.env;
        const isMultiConfig = !!cache.get('CMAKE_CONFIGURATION_TYPES');
        if (drv) {
          drv.isMultiConfig = isMultiConfig;
        }
        const actualBuildType = (() => {
          if (cmt.useCMakePresets) {
            if (isMultiConfig) {
              return cmt.buildPreset?.configuration || null;
            } else {
              const buildType = cache.get('CMAKE_BUILD_TYPE');
              return buildType ? buildType.as<string>() : null; // Single config generators set the build type during config, not build.
            }
          } else {
            return cmt.activeVariant;
          }
        })();

        const clCompilerPath = await findCLCompilerPath(env);
        this._configProvider.cpptoolsVersion = cpptools.getVersion();
        let codeModelContent;
        if (cmt.codeModelContent) {
          codeModelContent = cmt.codeModelContent;
          this._configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmt.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmt.folder.uri.fsPath });
        } else if (drv && drv.codeModelContent) {
          codeModelContent = drv.codeModelContent;
          this._configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmt.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmt.folder.uri.fsPath });
          this._projectOutlineProvider.updateCodeModel(
            cmt.workspaceContext.folder,
            codeModelContent,
            {
              defaultTarget: cmt.defaultBuildTarget || undefined,
              launchTargetName: cmt.launchTargetName
            }
          );
        }
        this.ensureCppToolsProviderRegistered();
        if (cpptools.notifyReady && this.cpptoolsNumFoldersReady < this._folders.size) {
          ++this.cpptoolsNumFoldersReady;
          if (this.cpptoolsNumFoldersReady === this._folders.size) {
            cpptools.notifyReady(this._configProvider);
            this._configProvider.markAsReady();
          }
        } else {
          cpptools.didChangeCustomConfiguration(this._configProvider);
          this._configProvider.markAsReady();
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
      this._activeConfigurePresetSub = new DummyDisposable();
      this._activeBuildPresetSub = new DummyDisposable();
      this._activeTestPresetSub = new DummyDisposable();
      this._statusBar.setActiveKitName('');
      this._statusBar.setConfigurePresetName('');
      this._statusBar.setBuildPresetName('');
      this._statusBar.setTestPresetName('');
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
      this._activeConfigurePresetSub = cmt.onActiveConfigurePresetChanged(FireNow, p => {
        this._statusBar.setConfigurePresetName(p?.displayName || p?.name || '');
      });
      this._activeBuildPresetSub = cmt.onActiveBuildPresetChanged(FireNow, p => {
        this._statusBar.setBuildPresetName(p?.displayName || p?.name || '');
      });
      this._activeTestPresetSub = cmt.onActiveTestPresetChanged(FireNow, p => {
        this._statusBar.setTestPresetName(p?.displayName || p?.name || '');
      });
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
            action: 'scan'
          },
          {
            title: localize('cancel.button', 'Cancel'),
            isCloseAffordance: true,
            action: 'cancel'
          }
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

  async scanForCompilers() {
    await this.scanForKits();
    await this._folders.activeFolder?.presetsController.reapplyPresets();
  }

  async scanForKits() {
    KitsController.minGWSearchDirs = await this._getMinGWDirs();
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
  private async _getMinGWDirs(): Promise<string[]> {
    const optsVars: KitContextVars = {
      userHome: paths.userHome,

      // This is called during scanning for kits, which is an operation that happens
      // outside the scope of a project folder, so it doesn't need the below variables.
      buildKit: "",
      buildType: "",
      generator: "",
      workspaceFolder: "",
      workspaceFolderBasename: "",
      workspaceHash: "",
      workspaceRoot: "",
      workspaceRootFolderName: "",
      buildKitVendor: "",
      buildKitTriple: "",
      buildKitVersion: "",
      buildKitHostOs: "",
      buildKitTargetOs: "",
      buildKitTargetArch: "",
      buildKitVersionMajor: "",
      buildKitVersionMinor: "",
      projectName: ""
    };
    const result = new Set<string>();
    for (const dir of this._workspaceConfig.mingwSearchDirs) {
      const expandedDir: string = util.lightNormalizePath(await expandString(dir, {vars: optsVars}));
      result.add(expandedDir);
    }
    return Array.from(result);
  }

  /**
   * Show UI to allow the user to select an active kit
   */
  async selectKit(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('selecting.kit.in.test.mode', 'Running CMakeTools in test mode. selectKit is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    const kitSelected = await cmtFolder.kitsController.selectKit();

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

    if (kitSelected) {
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

  /**
   * Set the current preset used in the specified folder by name of the preset
   * For backward compatibility, apply preset to all folders if folder is undefined
   */
  async setConfigurePreset(presetName: string, folder?: vscode.WorkspaceFolder) {
    if (folder) {
      await this._folders.get(folder)?.presetsController.setConfigurePreset(presetName);
    } else {
      for (const cmtFolder of this._folders) {
        await cmtFolder.presetsController.setConfigurePreset(presetName);
      }
    }
  }

  async setBuildPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
    if (folder) {
      await this._folders.get(folder)?.presetsController.setBuildPreset(presetName);
    } else {
      for (const cmtFolder of this._folders) {
        await cmtFolder.presetsController.setBuildPreset(presetName);
      }
    }
  }

  async setTestPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
    if (folder) {
      await this._folders.get(folder)?.presetsController.setTestPreset(presetName);
    } else {
      for (const cmtFolder of this._folders) {
        await cmtFolder.presetsController.setTestPreset(presetName);
      }
    }
  }

  useCMakePresets(folder: vscode.WorkspaceFolder) {
    return this._folders.get(folder)?.useCMakePresets;
  }

  ensureCppToolsProviderRegistered() {
    if (!this._configProviderRegistered) {
      this._doRegisterCppTools();
      this._configProviderRegistered = true;
    }
  }

  _doRegisterCppTools() {
    if (this._cppToolsAPI) {
      this._cppToolsAPI.registerCustomConfigurationProvider(this._configProvider);
    }
  }

  private _cleanOutputChannel() {
    if (this._workspaceConfig.clearOutputBeforeBuild) {
      log.clearOutputChannel();
    }
  }

  // The below functions are all wrappers around the backend.
  async mapCMakeTools(fn: CMakeToolsMapFn,
                      cmt = this._folders.activeFolder ? this._folders.activeFolder.cmakeTools : undefined,
                      precheck?: (cmt: CMakeTools) => Promise<boolean>): Promise<any> {
    if (!cmt) {
      rollbar.error(localize('no.active.folder', 'No active folder.'));
      return -2;
    }
    if (!await this._ensureActiveConfigurePresetOrKit(cmt)) {
      return -1;
    }
    if (precheck && !await precheck(cmt)) {
      return -100;
    }

    return fn(cmt);
  }

  async mapCMakeToolsAll(fn: CMakeToolsMapFn,
                         precheck?: (cmt: CMakeTools) => Promise<boolean>,
                         cleanOutputChannel?: boolean): Promise<any> {
    if (cleanOutputChannel) {
      this._cleanOutputChannel();
    }

    for (const folder of this._folders) {
      if (!await this._ensureActiveConfigurePresetOrKit(folder.cmakeTools)) {
        return -1;
      }
      if (precheck && !await precheck(folder.cmakeTools)) {
        return -100;
      }

      const retc = await fn(folder.cmakeTools);
      if (retc) {
        return retc;
      }
    }
    // Succeeded
    return 0;
  }

  mapCMakeToolsFolder(fn: CMakeToolsMapFn,
                      folder?: vscode.WorkspaceFolder,
                      precheck?: (cmt: CMakeTools) => Promise<boolean>,
                      cleanOutputChannel?: boolean): Promise<any> {
    if (cleanOutputChannel) {
      this._cleanOutputChannel();
    }

    return this.mapCMakeTools(fn, this._folders.get(folder)?.cmakeTools, precheck);
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
    return this.mapCMakeToolsFolder(cmt => cmt.cleanConfigure(ConfigureTrigger.commandCleanConfigure), folder, undefined, true);
  }

  cleanConfigureAll() {
    telemetry.logEvent("deleteCacheAndReconfigure");
    return this.mapCMakeToolsAll(cmt => cmt.cleanConfigure(ConfigureTrigger.commandCleanConfigureAll), undefined, true);
  }

  configure(folder?: vscode.WorkspaceFolder, showCommandOnly?: boolean) {
    return this.mapCMakeToolsFolder(cmt => cmt.configureInternal(ConfigureTrigger.commandConfigure,
                                                                 [],
                                                                 showCommandOnly ? ConfigureType.ShowCommandOnly : ConfigureType.Normal),
                                    folder, undefined, true);
  }

  showConfigureCommand(folder?: vscode.WorkspaceFolder) { return this.configure(folder, true); }

  configureAll() { return this.mapCMakeToolsAll(cmt => cmt.configureInternal(ConfigureTrigger.commandCleanConfigureAll, [], ConfigureType.Normal), undefined, true); }

  editCacheUI() {
    telemetry.logEvent("editCMakeCache", {command: "editCMakeCacheUI"});
    return this.mapCMakeToolsFolder(cmt => cmt.editCacheUI());
  }

  build(folder?: vscode.WorkspaceFolder, name?: string, showCommandOnly?: boolean) { return this.mapCMakeToolsFolder(cmt => cmt.build(name ? [name] : undefined, showCommandOnly), folder, this._ensureActiveBuildPreset, true); }
  showBuildCommand(folder?: vscode.WorkspaceFolder, name?: string) { return this.build(folder, name, true); }

  buildAll(name?: string | string[]) { return this.mapCMakeToolsAll(cmt => cmt.build(util.isString(name) ? [name] : undefined), this._ensureActiveBuildPreset, true); }

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
    return this.mapCMakeToolsFolder(cmt => cmt.install(), folder, undefined, true);
  }

  installAll() {
    telemetry.logEvent("install");
    return this.mapCMakeToolsAll(cmt => cmt.install(), undefined, true);
  }

  editCache(folder: vscode.WorkspaceFolder) {
    telemetry.logEvent("editCMakeCache", {command: "editCMakeCache"});
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
    return this.mapCMakeToolsFolder(cmt => cmt.cleanRebuild(), folder, this._ensureActiveBuildPreset, true);
  }

  cleanRebuildAll() {
    telemetry.logEvent("clean");
    return this.mapCMakeToolsAll(cmt => cmt.cleanRebuild(), this._ensureActiveBuildPreset, true);
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
    void vscode.window.showErrorMessage(localize('compilation information.not.found', 'Unable to find compilation information for this file'));
  }

  async selectWorkspace(folder?: vscode.WorkspaceFolder) {
    if (!folder) {
      return;
    }
    await this._setActiveFolder(folder);
  }

  ctest(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("runTests");
    return this.mapCMakeToolsFolder(cmt => cmt.ctest(), folder, this._ensureActiveTestPreset);
  }

  ctestAll() {
    telemetry.logEvent("runTests");
    return this.mapCMakeToolsAll(cmt => cmt.ctest(), this._ensureActiveTestPreset);
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

  tasksBuildCommand(folder?: vscode.WorkspaceFolder | string) {
    telemetry.logEvent("substitution", {command: "tasksBuildCommand"});
    return this.mapQueryCMakeTools(cmt => cmt.tasksBuildCommand(), folder);
  }

  debugTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.DebugSession | null> { return this.mapCMakeToolsFolder(cmt => cmt.debugTarget(name), folder); }

  async debugTargetAll(): Promise<(vscode.DebugSession | null)[]> {
    const debugSessions: (vscode.DebugSession | null)[] = [];
    for (const cmtFolder of this._folders) {
      if (cmtFolder) {
        debugSessions.push(await this.mapCMakeTools(cmt => cmt.debugTarget(), cmtFolder.cmakeTools));
      }
    }
    return debugSessions;
  }

  launchTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.Terminal | null> { return this.mapCMakeToolsFolder(cmt => cmt.launchTarget(name), folder); }

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

  async resetState(folder?: vscode.WorkspaceFolder) {
    telemetry.logEvent("resetExtension");
    if (folder) {
      await this.mapCMakeToolsFolder(cmt => cmt.resetState(), folder);
    } else {
      await this.mapCMakeToolsAll(cmt => cmt.resetState());
    }

    void vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  async viewLog() {
    telemetry.logEvent("openLogFile");
    await logging.showLogFile();
  }

  async logDiagnostics() {
    telemetry.logEvent("logDiagnostics");
    const configurations: DiagnosticsConfiguration[] = [];
    const settings: DiagnosticsSettings[] = [];
    for (const folder of this._folders.getAll()) {
        configurations.push(await folder.getDiagnostics());
        settings.push(await folder.getSettingsDiagnostics());
    }

    const result: Diagnostics = {
      os: platform(),
      vscodeVersion: vscode.version,
      cmtVersion: util.thisExtensionPackage().version,
      configurations,
      cpptoolsIntegration: this._configProvider.getDiagnostics(),
      settings
    };
    const output = logging.channelManager.get("CMake Diagnostics");
    output.clear();
    output.appendLine(JSON.stringify(result, null, 2));
    output.show();
  }

  activeFolderName(): string  {
    return this._folders.activeFolder?.folder.name || '';
  }
  activeFolderPath(): string  {
    return this._folders.activeFolder?.folder.uri.fsPath || '';
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

  // Answers whether the workspace contains at least one project folder that is CMake based,
  // without recalculating the valid states of CMakeLists.txt.
  async workspaceHasCMakeProject(): Promise<boolean> {
    for (const cmtFolder of this._folders) {
      if (await this.folderIsCMakeProject(cmtFolder.cmakeTools)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Opens CMakePresets.json at the root of the project. Creates one if it does not exist.
   */
  async openCMakePresets(): Promise<void> {
    await this._folders.activeFolder?.presetsController.openCMakePresets();
  }

  /**
   * Show UI to allow the user to add an active configure preset
   */
  async addConfigurePreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('add.config.preset.in.test.mode', 'Running CMakeTools in test mode. addConfigurePreset is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    return cmtFolder.presetsController.addConfigurePreset();
  }

  /**
   * Show UI to allow the user to add an active build preset
   */
  async addBuildPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('add.build.preset.in.test.mode', 'Running CMakeTools in test mode. addBuildPreset is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    return cmtFolder.presetsController.addBuildPreset();
  }

  /**
   * Show UI to allow the user to add an active test preset
   */
  async addTestPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('add.test.preset.in.test.mode', 'Running CMakeTools in test mode. addTestPreset is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    return cmtFolder.presetsController.addTestPreset();
  }

  // Referred in presetsController.ts
  /**
   * Show UI to allow the user to select an active configure preset
   */
  async selectConfigurePreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('selecting.config.preset.in.test.mode', 'Running CMakeTools in test mode. selectConfigurePreset is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    const presetSelected = await cmtFolder.presetsController.selectConfigurePreset();

    const configurePreset = this._folders.activeFolder?.cmakeTools.configurePreset;
    this._statusBar.setConfigurePresetName(configurePreset?.displayName || configurePreset?.name || '');

    // Reset build and test presets since they might not be used with the selected configure preset
    const buildPreset = this._folders.activeFolder?.cmakeTools.buildPreset;
    this._statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');
    const testPreset = this._folders.activeFolder?.cmakeTools.testPreset;
    this._statusBar.setTestPresetName(testPreset?.displayName || testPreset?.name || '');

    return presetSelected;
  }

  /**
   * Show UI to allow the user to select an active build preset
   */
  async selectBuildPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('selecting.build.preset.in.test.mode', 'Running CMakeTools in test mode. selectBuildPreset is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    const presetSelected = await cmtFolder.presetsController.selectBuildPreset();

    const buildPreset = this._folders.activeFolder?.cmakeTools.buildPreset;
    this._statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');

    return presetSelected;
  }

  /**
   * Show UI to allow the user to select an active test preset
   */
  async selectTestPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
    if (process.env['CMT_TESTING'] === '1') {
      log.trace(localize('selecting.test.preset.in.test.mode', 'Running CMakeTools in test mode. selectTestPreset is disabled.'));
      return false;
    }

    const cmtFolder = this._checkFolderArgs(folder);
    if (!cmtFolder) {
      return false;
    }

    const presetSelected = await cmtFolder.presetsController.selectTestPreset();

    const testPreset = this._folders.activeFolder?.cmakeTools.testPreset;
    this._statusBar.setTestPresetName(testPreset?.displayName || testPreset?.name || '');

    return presetSelected;
  }
}

async function setup(context: vscode.ExtensionContext, progress?: ProgressHandle) {
  reportProgress(localize('initial.setup', 'Initial setup'), progress);

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

  // List of functions that will be bound commands
  const funs: (keyof ExtensionManager)[] = [
    'activeFolderName',
    'activeFolderPath',
    "useCMakePresets",
    "openCMakePresets",
    'addConfigurePreset',
    'addBuildPreset',
    'addTestPreset',
    'selectConfigurePreset',
    'selectBuildPreset',
    'selectTestPreset',
    'selectActiveFolder',
    'editKits',
    'scanForKits',
    'scanForCompilers',
    'selectKit',
    'setKitByName',
    'setConfigurePreset',
    'setBuildPreset',
    'setTestPreset',
    'build',
    'showBuildCommand',
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
    'showConfigureCommand',
    'configureAll',
    'editCacheUI',
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
    'logDiagnostics',
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
  reportProgress(localize('loading.extension.commands', 'Loading extension commands'), progress);
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
      vscode.commands.registerCommand('cmake.outline.editCacheUI', () => runCommand('editCacheUI')),
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
                                      (what: WorkspaceFolderNode) => runCommand('selectWorkspace', what.wsFolder))
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

  // Start with a partial feature set view. The first valid CMake project will cause a switch to full feature set.
  await enableFullFeatureSet(false);

  // Register a protocol handler to serve localized schemas
  vscode.workspace.registerTextDocumentContentProvider('cmake-tools-schema', new SchemaProvider());
  await util.setContextValue("inCMakeProject", true);

  taskProvider = vscode.tasks.registerTaskProvider(CMakeTaskProvider.CMakeScriptType, cmakeTaskProvider);

  return setup(context);

  // TODO: Return the extension API
  // context.subscriptions.push(vscode.commands.registerCommand('cmake._extensionInstance', () => cmt));

}

// Enable all or part of the CMake Tools palette commands
// and show or hide the buttons in the status bar, according to the boolean.
// The scope of this is the whole workspace.
export async function enableFullFeatureSet(fullFeatureSet: boolean) {
  await util.setContextValue("cmake:enableFullFeatureSet", fullFeatureSet);
  _EXT_MANAGER?.showStatusBar(fullFeatureSet);
}

export function isActiveFolder(folder: vscode.WorkspaceFolder): boolean | undefined {
  const cmtFolder = _EXT_MANAGER?.getCMTFolder(folder);
  return cmtFolder && _EXT_MANAGER?.isActiveFolder(cmtFolder);
}

// This method updates the full/partial view state of the given folder
// (by analyzing the valid state of its CMakeLists.txt)
// and also calculates the impact on the whole workspace.
// It is called whenever a project folder goes through a relevant event:
// sourceDirectory change, CMakeLists.txt creation/move/deletion.
export async function updateFullFeatureSetForFolder(folder: vscode.WorkspaceFolder) {
  if (_EXT_MANAGER) {
    const cmt = _EXT_MANAGER.getCMTFolder(folder)?.cmakeTools;
    if (cmt) {
      // Save the CMakeLists valid state in the map for later reference
      // and evaluate its effects on the global full feature set view.
      const folderFullFeatureSet: boolean = await _EXT_MANAGER.folderIsCMakeProject(cmt);

      // Reset ignoreCMakeListsMissing now that we have a valid CMakeLists.txt
      // so that the next time we don't have one the user is notified.
      if (folderFullFeatureSet) {
        await cmt.workspaceContext.state.setIgnoreCMakeListsMissing(false);
      }

      // If the given folder is a CMake project, enable full feature set for the whole workspace,
      // otherwise search for at least one more CMake project folder.
      let workspaceFullFeatureSet = folderFullFeatureSet;
      if (!workspaceFullFeatureSet && _EXT_MANAGER) {
        workspaceFullFeatureSet = await _EXT_MANAGER.workspaceHasCMakeProject();
      }

      await enableFullFeatureSet(workspaceFullFeatureSet);
      return;
    }
  }

  // This shouldn't normally happen (not finding a CMT or not having a valid extension manager)
  // but just in case, enable full feature set.
  log.info(`Cannot find CMT for folder ${folder.name} or we don't have an extension manager created yet. ` +
           `Setting feature set view to "full".`);
  await enableFullFeatureSet(true);
}

// update CMakeDriver in taskProvider
export function updateCMakeDriverInTaskProvider(cmakeDriver: CMakeDriver) {
  cmakeTaskProvider.updateCMakeDriver(cmakeDriver);
}

// update default target in taskProvider
export function updateDefaultTargetsInTaskProvider(defaultTargets?: string[]) {
  cmakeTaskProvider.updateDefaultTargets(defaultTargets);
}

// Whether this CMake Tools extension instance will show the "Create/Locate/Ignore" toast popup
// for a non CMake project (as opposed to listing all existing CMakeLists.txt in the workspace
// in a quickPick.)
export function expShowCMakeLists(): Promise<boolean> {
  return _EXT_MANAGER?.expShowCMakeLists() || Promise.resolve(false);
}

// this method is called when your extension is deactivated.
export async function deactivate() {
  log.debug(localize('deactivate.cmaketools', 'Deactivate CMakeTools'));
  if (_EXT_MANAGER) {
    await _EXT_MANAGER.asyncDispose();
  }
  if (taskProvider) {
    taskProvider.dispose();
  }
}
