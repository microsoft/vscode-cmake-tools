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

import { CMakeCache } from '@cmt/cache';
import { CMakeTools, ConfigureType, ConfigureTrigger } from '@cmt/cmake-tools';
import { ConfigurationReader, TouchBarConfig } from '@cmt/config';
import { CppConfigurationProvider, DiagnosticsCpptools } from '@cmt/cpptools';
import { CMakeToolsFolderController, CMakeToolsFolder, DiagnosticsConfiguration, DiagnosticsSettings } from '@cmt/folders';
import {
    Kit,
    USER_KITS_FILEPATH,
    findCLCompilerPath,
    scanForKitsIfNeeded
} from '@cmt/kit';
import { IExperimentationService } from 'vscode-tas-client';
import { KitsController } from '@cmt/kitsController';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import { FireNow, FireLate } from '@cmt/prop';
import rollbar from '@cmt/rollbar';
import { StateManager } from './state';
import { StatusBar } from '@cmt/status';
import { CMakeTaskProvider } from '@cmt/cmakeTaskProvider';
import * as telemetry from '@cmt/telemetry';
import { ProjectOutlineProvider, TargetNode, SourceFileNode, WorkspaceFolderNode } from '@cmt/tree';
import * as util from '@cmt/util';
import { ProgressHandle, DummyDisposable, reportProgress } from '@cmt/util';
import { DEFAULT_VARIANTS } from '@cmt/variant';
import { expandString, KitContextVars } from '@cmt/expand';
import paths from '@cmt/paths';
import { CMakeDriver, CMakePreconditionProblems } from './drivers/driver';
import { platform } from 'os';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const cmakeTaskProvider: CMakeTaskProvider = new CMakeTaskProvider();
let taskProvider: vscode.Disposable;

const log = logging.createLogger('extension');

const multiRootModeKey = 'cmake:multiRoot';
const hideLaunchCommandKey = 'cmake:hideLaunchCommand';
const hideDebugCommandKey = 'cmake:hideDebugCommand';
const hideBuildCommandKey = 'cmake:hideBuildCommand';

/**
 * The global extension manager. There is only one of these, even if multiple
 * backends.
 */
let extensionManager: ExtensionManager | null = null;

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

        this.folders.onAfterAddFolder(async cmtFolder => {
            console.assert(this.folders.size === vscode.workspace.workspaceFolders?.length);
            if (this.folders.size === 1) {
                // First folder added
                await this.setActiveFolder(vscode.workspace.workspaceFolders![0]);
            } else if (this.folders.isMultiRoot) {
                // Call initActiveFolder instead of just setupSubscriptions, since the active editor/file may not
                // be in currently opened workspaces, and may be in the newly opened workspace.
                await this.initActiveFolder();
                await util.setContextValue(multiRootModeKey, true);
                // sub go text edit change event in multiroot mode
                if (this.workspaceConfig.autoSelectActiveFolder) {
                    this.onDidChangeActiveTextEditorSub.dispose();
                    this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
                }
            }
            const newCmt = cmtFolder.cmakeTools;
            this.projectOutlineProvider.addFolder(cmtFolder.folder);
            if (this.codeModelUpdateSubs.get(newCmt.folder.uri.fsPath)) {
                // We already have this folder, do nothing
            } else {
                const subs: vscode.Disposable[] = [];
                subs.push(newCmt.onCodeModelChanged(FireLate, () => this.updateCodeModel(cmtFolder)));
                subs.push(newCmt.onTargetNameChanged(FireLate, () => this.updateCodeModel(cmtFolder)));
                subs.push(newCmt.onLaunchTargetNameChanged(FireLate, () => this.updateCodeModel(cmtFolder)));
                subs.push(newCmt.onActiveBuildPresetChanged(FireLate, () => this.updateCodeModel(cmtFolder)));
                this.codeModelUpdateSubs.set(newCmt.folder.uri.fsPath, subs);
            }
            rollbar.takePromise('Post-folder-open', { folder: cmtFolder.folder }, this.postWorkspaceOpen(cmtFolder));
        });
        this.folders.onAfterRemoveFolder(async folder => {
            console.assert((vscode.workspace.workspaceFolders === undefined && this.folders.size === 0) ||
                (vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length === this.folders.size));
            this.codeModelUpdateSubs.delete(folder.uri.fsPath);
            if (!vscode.workspace.workspaceFolders?.length) {
                await this.setActiveFolder(undefined);
            } else {
                if (this.folders.activeFolder?.folder.uri.fsPath === folder.uri.fsPath) {
                    await this.setActiveFolder(vscode.workspace.workspaceFolders[0]);
                } else {
                    this.setupSubscriptions();
                }
                await util.setContextValue(multiRootModeKey, this.folders.isMultiRoot);

                // Update the full/partial view of the workspace by verifying if after the folder removal
                // it still has at least one CMake project.
                await enableFullFeatureSet(await this.workspaceHasCMakeProject());
            }

            this.onDidChangeActiveTextEditorSub.dispose();
            if (this.folders.isMultiRoot && this.workspaceConfig.autoSelectActiveFolder) {
                this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
            } else {
                this.onDidChangeActiveTextEditorSub = new DummyDisposable();
            }
            this.projectOutlineProvider.removeFolder(folder);
        });
        this.workspaceConfig.onChange('autoSelectActiveFolder', v => {
            if (this.folders.isMultiRoot) {
                telemetry.logEvent('configChanged.autoSelectActiveFolder', { autoSelectActiveFolder: `${v}` });
                this.onDidChangeActiveTextEditorSub.dispose();
                if (v) {
                    this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
                } else {
                    this.onDidChangeActiveTextEditorSub = new DummyDisposable();
                }
            }
            this.statusBar.setAutoSelectActiveFolder(v);
        });
    }

    private onDidChangeActiveTextEditorSub: vscode.Disposable = new DummyDisposable();
    private onUseCMakePresetsChangedSub: vscode.Disposable = new DummyDisposable();

    private readonly workspaceConfig: ConfigurationReader = ConfigurationReader.create();

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
    private async init() {
        this.updateTouchBarVisibility(this.workspaceConfig.touchbar);
        this.workspaceConfig.onChange('touchbar', config => this.updateTouchBarVisibility(config));

        let isMultiRoot = false;
        if (vscode.workspace.workspaceFolders) {
            await this.folders.loadAllCurrent();
            isMultiRoot = this.folders.isMultiRoot;
            await util.setContextValue(multiRootModeKey, isMultiRoot);
            this.projectOutlineProvider.addAllCurrentFolders();
            if (this.workspaceConfig.autoSelectActiveFolder && isMultiRoot) {
                this.statusBar.setAutoSelectActiveFolder(true);
                this.onDidChangeActiveTextEditorSub.dispose();
                this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
            }
            await this.initActiveFolder();
            for (const cmtFolder of this.folders) {
                this.onUseCMakePresetsChangedSub = cmtFolder.onUseCMakePresetsChanged(useCMakePresets => this.statusBar.useCMakePresets(useCMakePresets));
                this.codeModelUpdateSubs.set(cmtFolder.folder.uri.fsPath, [
                    cmtFolder.cmakeTools.onCodeModelChanged(FireLate, () => this.updateCodeModel(cmtFolder)),
                    cmtFolder.cmakeTools.onTargetNameChanged(FireLate, () => this.updateCodeModel(cmtFolder)),
                    cmtFolder.cmakeTools.onLaunchTargetNameChanged(FireLate, () => this.updateCodeModel(cmtFolder)),
                    cmtFolder.cmakeTools.onActiveBuildPresetChanged(FireLate, () => this.updateCodeModel(cmtFolder))
                ]);
                rollbar.takePromise('Post-folder-open', { folder: cmtFolder.folder }, this.postWorkspaceOpen(cmtFolder));
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
            telemetryProperties['autoSelectActiveFolder'] = `${this.workspaceConfig.autoSelectActiveFolder}`;
        }
        telemetry.sendOpenTelemetry(telemetryProperties);
    }

    public getFolderContext(folder: vscode.WorkspaceFolder): StateManager {
        return new StateManager(this.extensionContext, folder);
    }

    public showStatusBar(fullFeatureSet: boolean) {
        this.statusBar.setVisible(fullFeatureSet);
    }

    public getCMTFolder(folder: vscode.WorkspaceFolder): CMakeToolsFolder | undefined {
        return this.folders.get(folder);
    }

    public isActiveFolder(cmt: CMakeToolsFolder): boolean {
        return this.folders.activeFolder === cmt;
    }

    /**
     * Create a new extension manager instance. There must only be one!
     * @param ctx The extension context
     */
    static async create(ctx: vscode.ExtensionContext) {
        const inst = new ExtensionManager(ctx);
        await inst.init();
        return inst;
    }

    private showCMakeLists: Promise<boolean>;
    public expShowCMakeLists(): Promise<boolean> {
        return this.showCMakeLists;
    }

    /**
     * The folder controller manages multiple instances. One per folder.
     */
    private readonly folders = new CMakeToolsFolderController(this.extensionContext);

    /**
     * The map caching for each folder whether it is a CMake project or not.
     */
    private readonly isCMakeFolder: Map<string, boolean> = new Map<string, boolean>();

    /**
     * The status bar controller
     */
    private readonly statusBar = new StatusBar(this.workspaceConfig);
    // Subscriptions for status bar items:
    private statusMessageSub: vscode.Disposable = new DummyDisposable();
    private targetNameSub: vscode.Disposable = new DummyDisposable();
    private buildTypeSub: vscode.Disposable = new DummyDisposable();
    private launchTargetSub: vscode.Disposable = new DummyDisposable();
    private ctestEnabledSub: vscode.Disposable = new DummyDisposable();
    private testResultsSub: vscode.Disposable = new DummyDisposable();
    private isBusySub: vscode.Disposable = new DummyDisposable();
    private activeConfigurePresetSub: vscode.Disposable = new DummyDisposable();
    private activeBuildPresetSub: vscode.Disposable = new DummyDisposable();
    private activeTestPresetSub: vscode.Disposable = new DummyDisposable();

    // Watch the code model so that we may update teh tree view
    // <fspath, sub>
    private readonly codeModelUpdateSubs = new Map<string, vscode.Disposable[]>();

    /**
     * The project outline tree data provider
     */
    private readonly projectOutlineProvider = new ProjectOutlineProvider();
    private readonly projectOutlineTreeView = vscode.window.createTreeView('cmake.outline', {
        treeDataProvider: this.projectOutlineProvider,
        showCollapseAll: true
    });

    /**
     * CppTools project configuration provider. Tells cpptools how to search for
     * includes, preprocessor defs, etc.
     */
    private readonly configProvider = new CppConfigurationProvider();
    private cppToolsAPI?: cpt.CppToolsApi;
    private configProviderRegistered?: boolean = false;

    private checkFolderArgs(folder?: vscode.WorkspaceFolder): CMakeToolsFolder | undefined {
        let cmtFolder: CMakeToolsFolder | undefined;
        if (folder) {
            cmtFolder = this.folders.get(folder);
        } else if (this.folders.activeFolder) {
            cmtFolder = this.folders.activeFolder;
        }
        return cmtFolder;
    }

    private checkStringFolderArgs(folder?: vscode.WorkspaceFolder | string): vscode.WorkspaceFolder | undefined {
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
            return this.folders.activeFolder?.folder;
        }
        return workspaceFolder;
    }

    private async pickFolder() {
        const selection = await vscode.window.showWorkspaceFolderPick();
        if (selection) {
            const cmtFolder = this.folders.get(selection);
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
    private async ensureActiveConfigurePresetOrKit(cmt?: CMakeTools): Promise<boolean> {
        if (!cmt) {
            cmt = this.folders.activeFolder?.cmakeTools;
        }
        if (!cmt) {
            // No CMakeTools. Probably no workspace open.
            return false;
        }

        if (cmt.useCMakePresets) {
            if (cmt.configurePreset) {
                return true;
            }
            const didChoosePreset = await this.selectConfigurePreset(cmt.folder);
            if (!didChoosePreset && !cmt.configurePreset) {
                return false;
            }
            return !!cmt.configurePreset;
        } else {
            if (cmt.activeKit) {
                // We have an active kit. We're good.
                return true;
            }
            // No kit? Ask the user what they want.
            const didChooseKit = await this.selectKit(cmt.folder);
            if (!didChooseKit && !cmt.activeKit) {
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
    private readonly ensureActiveBuildPreset = async (cmt?: CMakeTools): Promise<boolean> => {
        if (!cmt) {
            cmt = this.folders.activeFolder?.cmakeTools;
        }
        if (!cmt) {
            // No CMakeTools. Probably no workspace open.
            return false;
        }
        if (cmt.useCMakePresets) {
            if (cmt.buildPreset) {
                return true;
            }
            const didChoosePreset = await this.selectBuildPreset(cmt.folder);
            if (!didChoosePreset && !cmt.buildPreset) {
                return false;
            }
            return !!cmt.buildPreset;
        }
        return true;
    };

    private readonly ensureActiveTestPreset = async (cmt?: CMakeTools): Promise<boolean> => {
        if (!cmt) {
            cmt = this.folders.activeFolder?.cmakeTools;
        }
        if (!cmt) {
            // No CMakeTools. Probably no workspace open.
            return false;
        }
        if (cmt.useCMakePresets) {
            if (cmt.testPreset) {
                return true;
            }
            const didChoosePreset = await this.selectTestPreset(cmt.folder);
            if (!didChoosePreset && !cmt.testPreset) {
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
    dispose() {
        rollbar.invokeAsync(localize('dispose.cmake.tools', 'Dispose of CMake Tools'), () => this.asyncDispose());
    }

    /**
     * Asynchronously dispose of all the child objects.
     */
    async asyncDispose() {
        this.disposeSubs();
        this.codeModelUpdateSubs.forEach(
            subs => subs.forEach(
                sub => sub.dispose()
            )
        );
        this.onDidChangeActiveTextEditorSub.dispose();
        this.onUseCMakePresetsChangedSub.dispose();
        void this.kitsWatcher.close();
        this.projectOutlineTreeView.dispose();
        if (this.cppToolsAPI) {
            this.cppToolsAPI.dispose();
        }
        // Dispose of each CMake Tools we still have loaded
        for (const cmtf of this.folders) {
            await cmtf.cmakeTools.asyncDispose();
        }
        this.folders.dispose();
        await telemetry.deactivate();
    }

    async configureExtensionInternal(trigger: ConfigureTrigger, cmt: CMakeTools): Promise<void> {
        if (!await this.ensureActiveConfigurePresetOrKit(cmt)) {
            return;
        }

        await cmt.configureInternal(trigger, [], ConfigureType.Normal);
    }

    // This method evaluates whether the given folder represents a CMake project
    // (does have a valid CMakeLists.txt at the location pointed to by the "cmake.sourceDirectory" setting)
    // and also stores the answer in a map for later use.
    async folderIsCMakeProject(cmt: CMakeTools): Promise<boolean> {
        if (this.isCMakeFolder.get(cmt.folderName)) {
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
        this.isCMakeFolder.set(cmt.folderName, isCMake);

        return isCMake;
    }

    async postWorkspaceOpen(info: CMakeToolsFolder) {
        const ws = info.folder;
        const cmt = info.cmakeTools;

        // Scan for kits even under presets mode, so we can create presets from compilers.
        // Silent re-scan when detecting a breaking change in the kits definition.
        // Do this only for the first folder, to avoid multiple rescans taking place in a multi-root workspace.
        const silentScanForKitsNeeded: boolean = vscode.workspace.workspaceFolders !== undefined &&
            vscode.workspace.workspaceFolders[0] === cmt.folder &&
            await scanForKitsIfNeeded(cmt);

        let shouldConfigure = cmt.workspaceContext.config.configureOnOpen;
        if (shouldConfigure === null && !util.isTestMode()) {
            interface Choice1 {
                title: string;
                doConfigure: boolean;
            }
            const chosen = await vscode.window.showInformationMessage<Choice1>(
                localize('configure.this.project', 'Would you like to configure project {0}?', `"${ws.name}"`),
                {},
                { title: localize('yes.button', 'Yes'), doConfigure: true },
                { title: localize('not.now.button', 'Not now'), doConfigure: false }
            );
            if (!chosen) {
                // User cancelled.
                shouldConfigure = null;
            } else {
                const persistMessage = chosen.doConfigure ?
                    localize('always.configure.on.open', 'Always configure projects upon opening?') :
                    localize('never.configure.on.open', 'Configure projects on opening?');
                const buttonMessages = chosen.doConfigure ?
                    [localize('yes.button', 'Yes'), localize('no.button', 'No')] :
                    [localize('never.button', 'Never'), localize('never.for.this.workspace.button', 'Not this workspace')];
                interface Choice2 {
                    title: string;
                    persistMode: 'user' | 'workspace';
                }
                // Try to persist the user's selection to a `settings.json`
                const prompt = vscode.window.showInformationMessage<Choice2>(
                    persistMessage,
                    {},
                    { title: buttonMessages[0], persistMode: 'user' },
                    { title: buttonMessages[1], persistMode: 'workspace' })
                    .then(async choice => {
                        if (!choice) {
                            // Use cancelled. Do nothing.
                            return;
                        }
                        const config = vscode.workspace.getConfiguration(undefined, ws.uri);
                        let configTarget = vscode.ConfigurationTarget.Global;
                        if (choice.persistMode === 'workspace') {
                            configTarget = vscode.ConfigurationTarget.WorkspaceFolder;
                        }
                        await config.update('cmake.configureOnOpen', chosen.doConfigure, configTarget);
                    });
                rollbar.takePromise(localize('persist.config.on.open.setting', 'Persist config-on-open setting'), {}, prompt);
                shouldConfigure = chosen.doConfigure;
            }
        }

        if (!await this.folderIsCMakeProject(cmt)) {
            await cmt.cmakePreConditionProblemHandler(CMakePreconditionProblems.MissingCMakeListsFile, false, this.workspaceConfig);
        } else {
            if (shouldConfigure === true) {
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

        this.updateCodeModel(info);
    }

    private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
        if (vscode.workspace.workspaceFolders) {
            let ws: vscode.WorkspaceFolder | undefined;
            if (editor) {
                ws = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            }
            if (ws && (!this.folders.activeFolder || ws.uri.fsPath !== this.folders.activeFolder.folder.uri.fsPath)) {
                // active folder changed.
                await this.setActiveFolder(ws);
            } else if (!ws && !this.folders.activeFolder && vscode.workspace.workspaceFolders.length >= 1) {
                await this.setActiveFolder(vscode.workspace.workspaceFolders[0]);
            } else if (!ws) {
                // When adding a folder but the focus is on somewhere else
                // Do nothing but make sure we are showing the active folder correctly
                this.statusBar.update();
            }
        }
    }

    /**
     * Show UI to allow the user to select an active kit
     */
    async selectActiveFolder() {
        if (vscode.workspace.workspaceFolders?.length) {
            const lastActiveFolderPath = this.folders.activeFolder?.folder.uri.fsPath;
            const selection = await vscode.window.showWorkspaceFolderPick();
            if (selection) {
                // Ingore if user cancelled
                await this.setActiveFolder(selection);
                telemetry.logEvent("selectactivefolder");
                // this.folders.activeFolder must be there at this time
                const currentActiveFolderPath = this.folders.activeFolder!.folder.uri.fsPath;
                await this.extensionContext.workspaceState.update('activeFolder', currentActiveFolderPath);
                if (lastActiveFolderPath !== currentActiveFolderPath) {
                    rollbar.takePromise('Post-folder-open', { folder: selection }, this.postWorkspaceOpen(this.folders.activeFolder!));
                }
            }
        }
    }

    private initActiveFolder() {
        if (vscode.window.activeTextEditor && this.workspaceConfig.autoSelectActiveFolder) {
            return this.onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
        }
        const activeFolder = this.extensionContext.workspaceState.get<string>('activeFolder');
        let folder: vscode.WorkspaceFolder | undefined;
        if (activeFolder) {
            folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(activeFolder));
        }
        if (!folder) {
            folder = vscode.workspace.workspaceFolders![0];
        }
        return this.setActiveFolder(folder);
    }

    /**
     * Set the active workspace folder. This reloads a lot of different bits and
     * pieces to control which backend has control and receives user input.
     * @param ws The workspace to activate
     */
    private async setActiveFolder(ws: vscode.WorkspaceFolder | undefined) {
        // Set the new workspace
        this.folders.setActiveFolder(ws);
        this.statusBar.setActiveFolderName(ws?.name || '');
        const activeFolder = this.folders.activeFolder;
        const useCMakePresets = activeFolder?.useCMakePresets || false;
        this.statusBar.useCMakePresets(useCMakePresets);
        if (!useCMakePresets) {
            this.statusBar.setActiveKitName(activeFolder?.cmakeTools.activeKit?.name || '');
        }
        this.projectOutlineProvider.setActiveFolder(ws);
        this.setupSubscriptions();
    }

    private disposeSubs() {
        for (const sub of [this.statusMessageSub, this.targetNameSub, this.buildTypeSub, this.launchTargetSub, this.ctestEnabledSub, this.testResultsSub, this.isBusySub, this.activeConfigurePresetSub, this.activeBuildPresetSub, this.activeTestPresetSub]) {
            sub.dispose();
        }
    }

    private cpptoolsNumFoldersReady: number = 0;
    private updateCodeModel(folder: CMakeToolsFolder) {
        const cmt: CMakeTools = folder.cmakeTools;
        this.projectOutlineProvider.updateCodeModel(
            cmt.workspaceContext.folder,
            cmt.codeModelContent,
            {
                defaultTarget: cmt.defaultBuildTarget || undefined,
                launchTargetName: cmt.launchTargetName
            }
        );
        rollbar.invokeAsync(localize('update.code.model.for.cpptools', 'Update code model for cpptools'), {}, async () => {
            if (vscode.workspace.getConfiguration('C_Cpp', folder.folder).get<string>('intelliSenseEngine')?.toLocaleLowerCase() === 'disabled') {
                log.debug(localize('update.intellisense.disabled', 'Not updating the configuration provider because {0} is set to {1}', '"C_Cpp.intelliSenseEngine"', '"Disabled"'));
                return;
            }
            if (!this.cppToolsAPI) {
                this.cppToolsAPI = await cpt.getCppToolsApi(cpt.Version.v5).catch(_err => undefined);
            }

            if (this.cppToolsAPI && (cmt.activeKit || cmt.configurePreset)) {
                const cpptools = this.cppToolsAPI;
                let cache: CMakeCache;
                try {
                    cache = await CMakeCache.fromPath(await cmt.cachePath);
                } catch (e: any) {
                    rollbar.exception(localize('filed.to.open.cache.file.on.code.model.update', 'Failed to open CMake cache file on code model update'), e);
                    return;
                }
                const drv: CMakeDriver | null = await cmt.getCMakeDriverInstance();
                const configureEnv = await drv?.getConfigureEnvironment();

                const isMultiConfig = !!cache.get('CMAKE_CONFIGURATION_TYPES');
                if (drv) {
                    drv.isMultiConfig = isMultiConfig;
                }
                const actualBuildType = await (async () => {
                    if (cmt.useCMakePresets) {
                        if (isMultiConfig) {
                            return cmt.buildPreset?.configuration || null;
                        } else {
                            const buildType = cache.get('CMAKE_BUILD_TYPE');
                            return buildType ? buildType.as<string>() : null; // Single config generators set the build type during config, not build.
                        }
                    } else {
                        return cmt.currentBuildType();
                    }
                })();

                const clCompilerPath = await findCLCompilerPath(configureEnv);
                this.configProvider.cpptoolsVersion = cpptools.getVersion();
                let codeModelContent;
                if (cmt.codeModelContent) {
                    codeModelContent = cmt.codeModelContent;
                    this.configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmt.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmt.folder.uri.fsPath });
                } else if (drv && drv.codeModelContent) {
                    codeModelContent = drv.codeModelContent;
                    this.configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmt.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmt.folder.uri.fsPath });
                    this.projectOutlineProvider.updateCodeModel(
                        cmt.workspaceContext.folder,
                        codeModelContent,
                        {
                            defaultTarget: cmt.defaultBuildTarget || undefined,
                            launchTargetName: cmt.launchTargetName
                        }
                    );
                }
                this.ensureCppToolsProviderRegistered();
                if (cpptools.notifyReady && this.cpptoolsNumFoldersReady < this.folders.size) {
                    ++this.cpptoolsNumFoldersReady;
                    if (this.cpptoolsNumFoldersReady === this.folders.size) {
                        cpptools.notifyReady(this.configProvider);
                        this.configProvider.markAsReady();
                    }
                } else {
                    cpptools.didChangeCustomBrowseConfiguration(this.configProvider);
                    cpptools.didChangeCustomConfiguration(this.configProvider);
                    this.configProvider.markAsReady();
                }
            }
        });
    }

    private setupSubscriptions() {
        this.disposeSubs();
        const folder = this.folders.activeFolder;
        const cmt = folder?.cmakeTools;
        if (!cmt) {
            this.statusBar.setVisible(false);
            this.statusMessageSub = new DummyDisposable();
            this.targetNameSub = new DummyDisposable();
            this.buildTypeSub = new DummyDisposable();
            this.launchTargetSub = new DummyDisposable();
            this.ctestEnabledSub = new DummyDisposable();
            this.testResultsSub = new DummyDisposable();
            this.isBusySub = new DummyDisposable();
            this.activeConfigurePresetSub = new DummyDisposable();
            this.activeBuildPresetSub = new DummyDisposable();
            this.activeTestPresetSub = new DummyDisposable();
            this.statusBar.setActiveKitName('');
            this.statusBar.setConfigurePresetName('');
            this.statusBar.setBuildPresetName('');
            this.statusBar.setTestPresetName('');
        } else {
            this.statusBar.setVisible(true);
            this.statusMessageSub = cmt.onStatusMessageChanged(FireNow, s => this.statusBar.setStatusMessage(s));
            this.targetNameSub = cmt.onTargetNameChanged(FireNow, t => {
                this.statusBar.setBuildTargetName(t);
            });
            this.buildTypeSub = cmt.onActiveVariantNameChanged(FireNow, bt => this.statusBar.setVariantLabel(bt));
            this.launchTargetSub = cmt.onLaunchTargetNameChanged(FireNow, t => {
                this.statusBar.setLaunchTargetName(t || '');
            });
            this.ctestEnabledSub = cmt.onCTestEnabledChanged(FireNow, e => this.statusBar.setCTestEnabled(e));
            this.testResultsSub = cmt.onTestResultsChanged(FireNow, r => this.statusBar.setTestResults(r));
            this.isBusySub = cmt.onIsBusyChanged(FireNow, b => this.statusBar.setIsBusy(b));
            this.statusBar.setActiveKitName(cmt.activeKit ? cmt.activeKit.name : '');
            this.activeConfigurePresetSub = cmt.onActiveConfigurePresetChanged(FireNow, p => {
                this.statusBar.setConfigurePresetName(p?.displayName || p?.name || '');
            });
            this.activeBuildPresetSub = cmt.onActiveBuildPresetChanged(FireNow, p => {
                this.statusBar.setBuildPresetName(p?.displayName || p?.name || '');
            });
            this.activeTestPresetSub = cmt.onActiveTestPresetChanged(FireNow, p => {
                this.statusBar.setTestPresetName(p?.displayName || p?.name || '');
            });
        }
    }

    /**
     * Watches for changes to the kits file
     */
    private readonly kitsWatcher = util.chokidarOnAnyChange(
        chokidar.watch(USER_KITS_FILEPATH, { ignoreInitial: true }),
        _ => rollbar.takePromise(localize('rereading.kits', 'Re-reading kits'), {}, KitsController.readUserKits(this.folders.activeFolder?.cmakeTools)));

    /**
     * Set the current kit for the specified workspace folder
     * @param k The kit
     */
    async setFolderKit(wsf: vscode.WorkspaceFolder, k: Kit | null) {
        const cmtFolder = this.folders.get(wsf);
        // Ignore if folder doesn't exist
        if (cmtFolder) {
            this.statusBar.setActiveKitName(await cmtFolder.kitsController.setFolderActiveKit(k));
        }
    }

    /**
     * Opens a text editor with the user-local `cmake-kits.json` file.
     */
    async editKits(): Promise<vscode.TextEditor | null> {
        log.debug(localize('opening.text.editor.for', 'Opening text editor for {0}', USER_KITS_FILEPATH));
        if (!await fs.exists(USER_KITS_FILEPATH)) {
            interface Item extends vscode.MessageItem {
                action: 'scan' | 'cancel';
            }
            const chosen = await vscode.window.showInformationMessage<Item>(
                localize('no.kits.file.what.to.do', 'No kits file is present. What would you like to do?'),
                { modal: true },
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
        await this.folders.activeFolder?.presetsController.reapplyPresets();
    }

    async scanForKits() {
        KitsController.minGWSearchDirs = await this.getMinGWDirs();
        const cmakeTools = this.folders.activeFolder?.cmakeTools;
        if (undefined === cmakeTools) {
            return;
        }

        const duplicateRemoved = await KitsController.scanForKits(cmakeTools);
        if (duplicateRemoved) {
            // Check each folder. If there is an active kit set and if it is of the old definition,
            // unset the kit
            for (const cmtFolder of this.folders) {
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
    private async getMinGWDirs(): Promise<string[]> {
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
        for (const dir of this.workspaceConfig.mingwSearchDirs) {
            const expandedDir: string = util.lightNormalizePath(await expandString(dir, { vars: optsVars }));
            result.add(expandedDir);
        }
        return Array.from(result);
    }

    /**
     * Show UI to allow the user to select an active kit
     */
    async selectKit(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.kit.in.test.mode', 'Running CMakeTools in test mode. selectKit is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
        if (!cmtFolder) {
            return false;
        }

        const kitSelected = await cmtFolder.kitsController.selectKit();

        let kitSelectionType;
        if (this.folders.activeFolder && this.folders.activeFolder.cmakeTools.activeKit) {
            this.statusBar.setActiveKitName(this.folders.activeFolder.cmakeTools.activeKit.name);

            if (this.folders.activeFolder.cmakeTools.activeKit.name === "__unspec__") {
                kitSelectionType = "unspecified";
            } else {
                if (this.folders.activeFolder.cmakeTools.activeKit.visualStudio ||
                    this.folders.activeFolder.cmakeTools.activeKit.visualStudioArchitecture) {
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
            await this.folders.get(folder)?.kitsController.setKitByName(kitName);
        } else {
            for (const cmtFolder of this.folders) {
                await cmtFolder.kitsController.setKitByName(kitName);
            }
        }
        if (this.folders.activeFolder && this.folders.activeFolder.cmakeTools.activeKit) {
            this.statusBar.setActiveKitName(this.folders.activeFolder.cmakeTools.activeKit.name);
        }
    }

    /**
     * Set the current preset used in the specified folder by name of the preset
     * For backward compatibility, apply preset to all folders if folder is undefined
     */
    async setConfigurePreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            await this.folders.get(folder)?.presetsController.setConfigurePreset(presetName);
        } else {
            for (const cmtFolder of this.folders) {
                await cmtFolder.presetsController.setConfigurePreset(presetName);
            }
        }
    }

    async setBuildPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            await this.folders.get(folder)?.presetsController.setBuildPreset(presetName);
        } else {
            for (const cmtFolder of this.folders) {
                await cmtFolder.presetsController.setBuildPreset(presetName);
            }
        }
    }

    async setTestPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            await this.folders.get(folder)?.presetsController.setTestPreset(presetName);
        } else {
            for (const cmtFolder of this.folders) {
                await cmtFolder.presetsController.setTestPreset(presetName);
            }
        }
    }

    useCMakePresets(folder: vscode.WorkspaceFolder) {
        return this.folders.get(folder)?.useCMakePresets;
    }

    ensureCppToolsProviderRegistered() {
        if (!this.configProviderRegistered) {
            this.doRegisterCppTools();
            this.configProviderRegistered = true;
        }
    }

    doRegisterCppTools() {
        if (this.cppToolsAPI) {
            this.cppToolsAPI.registerCustomConfigurationProvider(this.configProvider);
        }
    }

    private cleanOutputChannel() {
        if (this.workspaceConfig.clearOutputBeforeBuild) {
            log.clearOutputChannel();
        }
    }

    // The below functions are all wrappers around the backend.
    async mapCMakeTools(fn: CMakeToolsMapFn,
        cmt = this.folders.activeFolder ? this.folders.activeFolder.cmakeTools : undefined,
        precheck?: (cmt: CMakeTools) => Promise<boolean>): Promise<any> {
        if (!cmt) {
            rollbar.error(localize('no.active.folder', 'No active folder.'));
            return -2;
        }
        if (!await this.ensureActiveConfigurePresetOrKit(cmt)) {
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
            this.cleanOutputChannel();
        }

        for (const folder of this.folders) {
            if (!await this.ensureActiveConfigurePresetOrKit(folder.cmakeTools)) {
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
            this.cleanOutputChannel();
        }

        return this.mapCMakeTools(fn, this.folders.get(folder)?.cmakeTools, precheck);
    }

    mapQueryCMakeTools(fn: CMakeToolsQueryMapFn, folder?: vscode.WorkspaceFolder | string) {
        const workspaceFolder = this.checkStringFolderArgs(folder);
        if (workspaceFolder) {
            const cmtFolder = this.folders.get(workspaceFolder);
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
        return this.mapCMakeToolsFolder(
            cmt => cmt.configureInternal(ConfigureTrigger.commandConfigure, [], showCommandOnly ? ConfigureType.ShowCommandOnly : ConfigureType.Normal),
            folder, undefined, true);
    }

    showConfigureCommand(folder?: vscode.WorkspaceFolder) {
        return this.configure(folder, true);
    }

    configureAll() {
        return this.mapCMakeToolsAll(cmt => cmt.configureInternal(ConfigureTrigger.commandCleanConfigureAll, [], ConfigureType.Normal), undefined, true);
    }

    editCacheUI() {
        telemetry.logEvent("editCMakeCache", { command: "editCMakeCacheUI" });
        return this.mapCMakeToolsFolder(cmt => cmt.editCacheUI());
    }

    build(folder?: vscode.WorkspaceFolder, name?: string, showCommandOnly?: boolean) {
        return this.mapCMakeToolsFolder(cmt => cmt.build(name ? [name] : undefined, showCommandOnly), folder, this.ensureActiveBuildPreset, true);
    }
    showBuildCommand(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.build(folder, name, true);
    }

    buildAll(name?: string | string[]) {
        return this.mapCMakeToolsAll(cmt => cmt.build(util.isString(name) ? [name] : undefined), this.ensureActiveBuildPreset, true);
    }

    setDefaultTarget(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.mapCMakeToolsFolder(cmt => cmt.setDefaultTarget(name), folder);
    }

    setVariant(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.mapCMakeToolsFolder(cmt => cmt.setVariant(name), folder);
    }

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
        telemetry.logEvent("editCMakeCache", { command: "editCMakeCache" });
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
        return this.mapCMakeToolsFolder(cmt => cmt.cleanRebuild(), folder, this.ensureActiveBuildPreset, true);
    }

    cleanRebuildAll() {
        telemetry.logEvent("clean");
        return this.mapCMakeToolsAll(cmt => cmt.cleanRebuild(), this.ensureActiveBuildPreset, true);
    }

    async buildWithTarget() {
        this.cleanOutputChannel();
        let cmtFolder: CMakeToolsFolder | undefined = this.folders.activeFolder;
        if (!cmtFolder) {
            cmtFolder = await this.pickFolder();
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
    async compileFile(file?: string | vscode.Uri) {
        this.cleanOutputChannel();
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
        for (const folder of this.folders) {
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
        await this.setActiveFolder(folder);
    }

    ctest(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("runTests");
        return this.mapCMakeToolsFolder(cmt => cmt.ctest(), folder, this.ensureActiveTestPreset);
    }

    ctestAll() {
        telemetry.logEvent("runTests");
        return this.mapCMakeToolsAll(cmt => cmt.ctest(), this.ensureActiveTestPreset);
    }

    stop(folder?: vscode.WorkspaceFolder) {
        return this.mapCMakeToolsFolder(cmt => cmt.stop(), folder);
    }

    stopAll() {
        return this.mapCMakeToolsAll(cmt => cmt.stop());
    }

    quickStart(folder?: vscode.WorkspaceFolder) {
        const cmtFolder = this.checkFolderArgs(folder);
        telemetry.logEvent("quickStart");
        return this.mapCMakeTools(cmt => cmt.quickStart(cmtFolder));
    }

    launchTargetPath(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "launchTargetPath" });
        return this.mapQueryCMakeTools(cmt => cmt.launchTargetPath(), folder);
    }

    launchTargetDirectory(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "launchTargetDirectory" });
        return this.mapQueryCMakeTools(cmt => cmt.launchTargetDirectory(), folder);
    }

    launchTargetFilename(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "launchTargetFilename" });
        return this.mapQueryCMakeTools(cmt => cmt.launchTargetFilename(), folder);
    }

    getLaunchTargetPath(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "getLaunchTargetPath" });
        return this.mapQueryCMakeTools(cmt => cmt.getLaunchTargetPath(), folder);
    }

    getLaunchTargetDirectory(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "getLaunchTargetDirectory" });
        return this.mapQueryCMakeTools(cmt => cmt.getLaunchTargetDirectory(), folder);
    }

    getLaunchTargetFilename(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "getLaunchTargetFilename" });
        return this.mapQueryCMakeTools(cmt => cmt.getLaunchTargetFilename(), folder);
    }

    buildTargetName(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildTargetName" });
        return this.mapQueryCMakeTools(cmt => cmt.buildTargetName(), folder);
    }

    buildType(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildType" });
        return this.mapQueryCMakeTools(cmt => cmt.currentBuildType(), folder);
    }

    buildDirectory(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildDirectory" });
        return this.mapQueryCMakeTools(cmt => cmt.buildDirectory(), folder);
    }

    buildKit(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildKit" });
        return this.mapQueryCMakeTools(cmt => cmt.buildKit(), folder);
    }

    executableTargets(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "executableTargets" });
        return this.mapQueryCMakeTools(async cmt => (await cmt.executableTargets).map(target => target.name), folder);
    }

    tasksBuildCommand(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "tasksBuildCommand" });
        return this.mapQueryCMakeTools(cmt => cmt.tasksBuildCommand(), folder);
    }

    debugTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.DebugSession | null> {
        return this.mapCMakeToolsFolder(cmt => cmt.debugTarget(name), folder);
    }

    async debugTargetAll(): Promise<(vscode.DebugSession | null)[]> {
        const debugSessions: (vscode.DebugSession | null)[] = [];
        for (const cmtFolder of this.folders) {
            if (cmtFolder) {
                debugSessions.push(await this.mapCMakeTools(cmt => cmt.debugTarget(), cmtFolder.cmakeTools));
            }
        }
        return debugSessions;
    }

    launchTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.Terminal | null> {
        return this.mapCMakeToolsFolder(cmt => cmt.launchTarget(name), folder);
    }

    async launchTargetAll(): Promise<(vscode.Terminal | null)[]> {
        const terminals: (vscode.Terminal | null)[] = [];
        for (const cmtFolder of this.folders) {
            if (cmtFolder) {
                terminals.push(await this.mapCMakeTools(cmt => cmt.launchTarget(), cmtFolder.cmakeTools));
            }
        }
        return terminals;
    }

    selectLaunchTarget(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.mapCMakeToolsFolder(cmt => cmt.selectLaunchTarget(name), folder);
    }

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
        for (const folder of this.folders.getAll()) {
            configurations.push(await folder.getDiagnostics());
            settings.push(await folder.getSettingsDiagnostics());
        }

        const result: Diagnostics = {
            os: platform(),
            vscodeVersion: vscode.version,
            cmtVersion: util.thisExtensionPackage().version,
            configurations,
            cpptoolsIntegration: this.configProvider.getDiagnostics(),
            settings
        };
        const output = logging.channelManager.get("CMake Diagnostics");
        output.clear();
        output.appendLine(JSON.stringify(result, null, 2));
        output.show();
    }

    activeFolderName(): string {
        return this.folders.activeFolder?.folder.name || '';
    }
    activeFolderPath(): string {
        return this.folders.activeFolder?.folder.uri.fsPath || '';
    }

    async hideLaunchCommand(shouldHide: boolean = true) {
        // Don't hide command selectLaunchTarget here since the target can still be useful, one example is ${command:cmake.launchTargetPath} in launch.json
        this.statusBar.hideLaunchButton(shouldHide);
        await util.setContextValue(hideLaunchCommandKey, shouldHide);
    }

    async hideDebugCommand(shouldHide: boolean = true) {
        // Don't hide command selectLaunchTarget here since the target can still be useful, one example is ${command:cmake.launchTargetPath} in launch.json
        this.statusBar.hideDebugButton(shouldHide);
        await util.setContextValue(hideDebugCommandKey, shouldHide);
    }

    async hideBuildCommand(shouldHide: boolean = true) {
        this.statusBar.hideBuildButton(shouldHide);
        await util.setContextValue(hideBuildCommandKey, shouldHide);
    }

    // Answers whether the workspace contains at least one project folder that is CMake based,
    // without recalculating the valid states of CMakeLists.txt.
    async workspaceHasCMakeProject(): Promise<boolean> {
        for (const cmtFolder of this.folders) {
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
        await this.folders.activeFolder?.presetsController.openCMakePresets();
    }

    /**
     * Show UI to allow the user to add an active configure preset
     */
    async addConfigurePreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.config.preset.in.test.mode', 'Running CMakeTools in test mode. addConfigurePreset is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
        if (!cmtFolder) {
            return false;
        }

        return cmtFolder.presetsController.addConfigurePreset();
    }

    /**
     * Show UI to allow the user to add an active build preset
     */
    async addBuildPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.build.preset.in.test.mode', 'Running CMakeTools in test mode. addBuildPreset is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
        if (!cmtFolder) {
            return false;
        }

        return cmtFolder.presetsController.addBuildPreset();
    }

    /**
     * Show UI to allow the user to add an active test preset
     */
    async addTestPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.test.preset.in.test.mode', 'Running CMakeTools in test mode. addTestPreset is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
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
        if (util.isTestMode()) {
            log.trace(localize('selecting.config.preset.in.test.mode', 'Running CMakeTools in test mode. selectConfigurePreset is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
        if (!cmtFolder) {
            return false;
        }

        const presetSelected = await cmtFolder.presetsController.selectConfigurePreset();

        const configurePreset = this.folders.activeFolder?.cmakeTools.configurePreset;
        this.statusBar.setConfigurePresetName(configurePreset?.displayName || configurePreset?.name || '');

        // Reset build and test presets since they might not be used with the selected configure preset
        const buildPreset = this.folders.activeFolder?.cmakeTools.buildPreset;
        this.statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');
        const testPreset = this.folders.activeFolder?.cmakeTools.testPreset;
        this.statusBar.setTestPresetName(testPreset?.displayName || testPreset?.name || '');

        return presetSelected;
    }

    /**
     * Show UI to allow the user to select an active build preset
     */
    async selectBuildPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.build.preset.in.test.mode', 'Running CMakeTools in test mode. selectBuildPreset is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
        if (!cmtFolder) {
            return false;
        }

        const presetSelected = await cmtFolder.presetsController.selectBuildPreset();

        const buildPreset = this.folders.activeFolder?.cmakeTools.buildPreset;
        this.statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');

        return presetSelected;
    }

    /**
     * Show UI to allow the user to select an active test preset
     */
    async selectTestPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.test.preset.in.test.mode', 'Running CMakeTools in test mode. selectTestPreset is disabled.'));
            return false;
        }

        const cmtFolder = this.checkFolderArgs(folder);
        if (!cmtFolder) {
            return false;
        }

        const presetSelected = await cmtFolder.presetsController.selectTestPreset();

        const testPreset = this.folders.activeFolder?.cmakeTools.testPreset;
        this.statusBar.setTestPresetName(testPreset?.displayName || testPreset?.name || '');

        return presetSelected;
    }
}

async function setup(context: vscode.ExtensionContext, progress?: ProgressHandle) {
    reportProgress(localize('initial.setup', 'Initial setup'), progress);

    // Load a new extension manager
    const ext = extensionManager = await ExtensionManager.create(context);

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
    extensionManager?.showStatusBar(fullFeatureSet);
}

export function isActiveFolder(folder: vscode.WorkspaceFolder): boolean | undefined {
    const cmtFolder = extensionManager?.getCMTFolder(folder);
    return cmtFolder && extensionManager?.isActiveFolder(cmtFolder);
}

// This method updates the full/partial view state of the given folder
// (by analyzing the valid state of its CMakeLists.txt)
// and also calculates the impact on the whole workspace.
// It is called whenever a project folder goes through a relevant event:
// sourceDirectory change, CMakeLists.txt creation/move/deletion.
export async function updateFullFeatureSetForFolder(folder: vscode.WorkspaceFolder) {
    if (extensionManager) {
        const cmt = extensionManager.getCMTFolder(folder)?.cmakeTools;
        if (cmt) {
            // Save the CMakeLists valid state in the map for later reference
            // and evaluate its effects on the global full feature set view.
            const folderFullFeatureSet: boolean = await extensionManager.folderIsCMakeProject(cmt);

            // Reset ignoreCMakeListsMissing now that we have a valid CMakeLists.txt
            // so that the next time we don't have one the user is notified.
            if (folderFullFeatureSet) {
                await cmt.workspaceContext.state.setIgnoreCMakeListsMissing(false);
            }

            // If the given folder is a CMake project, enable full feature set for the whole workspace,
            // otherwise search for at least one more CMake project folder.
            let workspaceFullFeatureSet = folderFullFeatureSet;
            if (!workspaceFullFeatureSet && extensionManager) {
                workspaceFullFeatureSet = await extensionManager.workspaceHasCMakeProject();
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
    return extensionManager?.expShowCMakeLists() || Promise.resolve(false);
}

// this method is called when your extension is deactivated.
export async function deactivate() {
    log.debug(localize('deactivate.cmaketools', 'Deactivate CMakeTools'));
    if (extensionManager) {
        await extensionManager.asyncDispose();
    }
    if (taskProvider) {
        taskProvider.dispose();
    }
}
