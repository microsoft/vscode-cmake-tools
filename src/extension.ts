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
import { CMakeProject, ConfigureType, ConfigureTrigger, DiagnosticsConfiguration, DiagnosticsSettings } from '@cmt/cmakeProject';
import { ConfigurationReader, getSettingsChangePromise, TouchBarConfig } from '@cmt/config';
import { CppConfigurationProvider, DiagnosticsCpptools } from '@cmt/cpptools';
import { CMakeProjectController, FolderProjectMap} from '@cmt/CMakeProjectController';

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
import { cmakeTaskProvider, CMakeTaskProvider } from '@cmt/cmakeTaskProvider';
import * as telemetry from '@cmt/telemetry';
import { ProjectOutlineProvider, TargetNode, SourceFileNode, WorkspaceFolderNode } from '@cmt/tree';
import * as util from '@cmt/util';
import { ProgressHandle, DummyDisposable, reportProgress } from '@cmt/util';
import { DEFAULT_VARIANTS } from '@cmt/variant';
import { expandString, KitContextVars } from '@cmt/expand';
import paths from '@cmt/paths';
import { CMakeDriver, CMakePreconditionProblems } from './drivers/cmakeDriver';
import { platform } from 'os';
import { defaultBuildPreset } from './preset';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
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

type RunCMakeCommand = (cmakeProject: CMakeProject) => Thenable<any>;
type QueryCMakeProject = (cmakeProject: CMakeProject) => Thenable<string | string[] | null>;

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

        this.cmakeProjectController.onAfterAddFolder(async (folderProjectMap: FolderProjectMap) => {
            const folder: vscode.WorkspaceFolder = folderProjectMap.folder;
            const projects: CMakeProject[] = folderProjectMap.projects;
            console.assert(this.cmakeProjectController.numOfRoots === vscode.workspace.workspaceFolders?.length);
            if (this.cmakeProjectController.numOfRoots === 1) {
                // First folder added
                await this.setActiveProject(folder);
            } else if (this.cmakeProjectController.isMultiRoot) {
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
            this.projectOutlineProvider.addFolder(folder);
            if (this.codeModelUpdateSubs.get(folder.uri.fsPath)) {
                // We already have this folder, do nothing
            } else {
                const subs: vscode.Disposable[] = [];
                for (const project of projects) {
                    subs.push(project.onCodeModelChanged(FireLate, () => this.updateCodeModel(folder, project)));
                    subs.push(project.onTargetNameChanged(FireLate, () => this.updateCodeModel(folder, project)));
                    subs.push(project.onLaunchTargetNameChanged(FireLate, () => this.updateCodeModel(folder, project)));
                    subs.push(project.onActiveBuildPresetChanged(FireLate, () => this.updateCodeModel(folder, project)));
                    this.codeModelUpdateSubs.set(project.folderPath, subs);
                }
            }
            rollbar.takePromise('Post-folder-open', { folder: folder }, this.postWorkspaceOpen(folder, this.getActiveCMakeProject()));
        });

        this.cmakeProjectController.onAfterRemoveFolder(async folder => {
            console.assert((vscode.workspace.workspaceFolders === undefined && this.cmakeProjectController.numOfRoots === 0) ||
                (vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length === this.cmakeProjectController.numOfRoots));
            this.codeModelUpdateSubs.delete(folder.uri.fsPath);
            if (!vscode.workspace.workspaceFolders?.length) {
                await this.setActiveProject(undefined);
            } else {
                if (this.activeFolderPath() === folder.uri.fsPath) {
                    await this.setActiveProject(vscode.workspace.workspaceFolders[0]);
                } else {
                    this.setupSubscriptions();
                }
                await util.setContextValue(multiRootModeKey, this.cmakeProjectController.isMultiRoot);

                // Update the full/partial view of the workspace by verifying if after the folder removal
                // it still has at least one CMake project.
                await enableFullFeatureSet(await this.workspaceHasCMakeProject());
            }

            this.onDidChangeActiveTextEditorSub.dispose();
            if (this.cmakeProjectController.isMultiRoot && this.workspaceConfig.autoSelectActiveFolder) {
                this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
            } else {
                this.onDidChangeActiveTextEditorSub = new DummyDisposable();
            }
            this.projectOutlineProvider.removeFolder(folder);
        });

        this.workspaceConfig.onChange('autoSelectActiveFolder', v => {
            if (this.cmakeProjectController.isMultiRoot) {
                telemetry.logEvent('configChanged.autoSelectActiveFolder', { autoSelectActiveFolder: `${v}` });
                this.onDidChangeActiveTextEditorSub.dispose();
                if (v) {
                    this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
                } else {
                    this.onDidChangeActiveTextEditorSub = new DummyDisposable();
                }
            }
            this.statusBar.setAutoSelectActiveProject(v);
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
            await this.cmakeProjectController.loadAllProjects();
            isMultiRoot = this.cmakeProjectController.isMultiRoot;
            await util.setContextValue(multiRootModeKey, isMultiRoot);
            this.projectOutlineProvider.addAllCurrentFolders();
            if (this.workspaceConfig.autoSelectActiveFolder && isMultiRoot) {
                this.statusBar.setAutoSelectActiveProject(true);
                this.onDidChangeActiveTextEditorSub.dispose();
                this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);
            }
            await this.initActiveFolder();
            const activeCMakeProject = this.getActiveCMakeProject();
            if (activeCMakeProject) {
                const folder: vscode.WorkspaceFolder = activeCMakeProject.rootFolder;
                this.onUseCMakePresetsChangedSub = activeCMakeProject?.onUseCMakePresetsChanged(useCMakePresets => this.statusBar.useCMakePresets(useCMakePresets));
                this.codeModelUpdateSubs.set(folder.name, [
                    activeCMakeProject.onCodeModelChanged(FireLate, () => this.updateCodeModel(folder, activeCMakeProject)),
                    activeCMakeProject.onTargetNameChanged(FireLate, () => this.updateCodeModel(folder, activeCMakeProject)),
                    activeCMakeProject.onLaunchTargetNameChanged(FireLate, () => this.updateCodeModel(folder, activeCMakeProject)),
                    activeCMakeProject.onActiveBuildPresetChanged(FireLate, () => this.updateCodeModel(folder, activeCMakeProject))
                ]);
                rollbar.takePromise('Post-folder-open', { folder: folder.name }, this.postWorkspaceOpen(folder, activeCMakeProject));
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

    public isActiveFolder(folder: vscode.WorkspaceFolder): boolean {
        return this.activeCMakeWorkspaceFolder() === folder;
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
    public showCMakeListsExperiment(): Promise<boolean> {
        return this.showCMakeLists;
    }

    /**
     * The folder controller manages multiple instances. One per folder.
     */
    private readonly cmakeProjectController = new CMakeProjectController(this.extensionContext);

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

    private getCMakeProjectsForFolder(folder?: vscode.WorkspaceFolder): CMakeProject[]  | undefined {
        folder = this.getWorkspaceFolder(folder);
        return this.cmakeProjectController.getCMakeProjectsForFolder(folder);
    }

    private getWorkspaceFolder(folder?: vscode.WorkspaceFolder | string): vscode.WorkspaceFolder | undefined {
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
            return this.activeCMakeWorkspaceFolder();
        }
        return workspaceFolder;
    }

    /**
     * Ensure that there is an active kit or configure preset for the current CMakeProject.
     *
     * @returns `false` if there is not active CMakeProject, or it has no active kit
     * and the user cancelled the kit selection dialog.
     */
    private async ensureActiveConfigurePresetOrKit(cmakeProject?: CMakeProject): Promise<boolean> {
        if (!cmakeProject) {
            cmakeProject = this.getActiveCMakeProject();
        }
        if (!cmakeProject) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }

        if (cmakeProject.useCMakePresets) {
            if (cmakeProject.configurePreset) {
                return true;
            }
            const didChoosePreset = await this.selectConfigurePreset(cmakeProject.rootFolder);
            if (!didChoosePreset && !cmakeProject.configurePreset) {
                return false;
            }
            return !!cmakeProject.configurePreset;
        } else {
            if (cmakeProject.activeKit) {
                // We have an active kit. We're good.
                return true;
            }
            // No kit? Ask the user what they want.
            const didChooseKit = await this.selectKit(cmakeProject.rootFolder);
            if (!didChooseKit && !cmakeProject.activeKit) {
                // The user did not choose a kit and kit isn't set in other way such as setKitByName
                return false;
            }
            // Return whether we have an active kit defined.
            return !!cmakeProject.activeKit;
        }
    }

    /**
     * Ensure that there is an active build preset for the current CMakeProject.
     * We pass this in function calls so make it an lambda instead of a function.
     *
     * @returns `false` if there is not active CMakeProject, or it has no active preset
     * and the user cancelled the preset selection dialog.
     */
    private readonly ensureActiveBuildPreset = async (cmakeProject?: CMakeProject): Promise<boolean> => {
        if (!cmakeProject) {
            cmakeProject = this.getActiveCMakeProject();
        }
        if (!cmakeProject) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }
        if (cmakeProject.useCMakePresets) {
            if (cmakeProject.buildPreset) {
                return true;
            }
            const didChoosePreset = await this.selectBuildPreset(cmakeProject.rootFolder);
            if (!didChoosePreset && !cmakeProject.buildPreset) {
                return false;
            }
            return !!cmakeProject.buildPreset;
        }
        return true;
    };

    private readonly ensureActiveTestPreset = async (cmakeProject?: CMakeProject): Promise<boolean> => {
        if (!cmakeProject) {
            cmakeProject = this.getActiveCMakeProject();
        }
        if (!cmakeProject) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }
        if (cmakeProject.useCMakePresets) {
            if (cmakeProject.testPreset) {
                return true;
            }
            const didChoosePreset = await this.selectTestPreset(cmakeProject.rootFolder);
            if (!didChoosePreset && !cmakeProject.testPreset) {
                return false;
            }
            return !!cmakeProject.testPreset;
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
        // Dispose of each CMakeProject we have loaded.
        for (const cmakeProject of this.cmakeProjectController.getAllCMakeProjects()) {
            await cmakeProject.asyncDispose();
        }
        this.cmakeProjectController.dispose();
        await telemetry.deactivate();
    }

    async configureExtensionInternal(trigger: ConfigureTrigger, cmakeProject: CMakeProject): Promise<void> {
        if (trigger !== ConfigureTrigger.configureWithCache && !await this.ensureActiveConfigurePresetOrKit(cmakeProject)) {
            return;
        }

        await cmakeProject.configureInternal(trigger, [], ConfigureType.Normal);
    }

    // This method evaluates whether the given folder represents a CMake project
    // (does have a valid CMakeLists.txt at the location pointed to by the "cmake.sourceDirectory" setting)
    // and also stores the answer in a map for later use.
    async folderIsCMakeProject(cmakeProject: CMakeProject): Promise<boolean> {
        if (this.isCMakeFolder.get(cmakeProject.folderName)) {
            return true;
        }

        const optsVars: KitContextVars = {
            // sourceDirectory cannot be defined based on any of the below variables.
            buildKit: '${buildKit}',
            buildType: '${buildType}',
            buildKitVendor: '${buildKitVendor}',
            buildKitTriple: '${buildKitTriple}',
            buildKitVersion: '${buildKitVersion}',
            buildKitHostOs: '${buildKitVendor}',
            buildKitTargetOs: '${buildKitTargetOs}',
            buildKitTargetArch: '${buildKitTargetArch}',
            buildKitVersionMajor: '${buildKitVersionMajor}',
            buildKitVersionMinor: '${buildKitVersionMinor}',
            generator: '${generator}',
            userHome: paths.userHome,
            workspaceFolder: cmakeProject.workspaceContext.folder.uri.fsPath,
            workspaceFolderBasename: cmakeProject.workspaceContext.folder.name,
            workspaceHash: '${workspaceHash}',
            workspaceRoot: cmakeProject.workspaceContext.folder.uri.fsPath,
            workspaceRootFolderName: cmakeProject.workspaceContext.folder.name
        };

        const sourceDirectory: string = cmakeProject.sourceDir;
        let expandedSourceDirectory: string = util.lightNormalizePath(await expandString(sourceDirectory, { vars: optsVars }));
        if (path.basename(expandedSourceDirectory).toLocaleLowerCase() !== "cmakelists.txt") {
            expandedSourceDirectory = path.join(expandedSourceDirectory, "CMakeLists.txt");
        }

        const isCMake = await fs.exists(expandedSourceDirectory);
        this.isCMakeFolder.set(cmakeProject.folderName, isCMake);

        return isCMake;
    }

    async postWorkspaceOpen(folder: vscode.WorkspaceFolder, cmakeProject?: CMakeProject) {
        // Scan for kits even under presets mode, so we can create presets from compilers.
        // Silent re-scan when detecting a breaking change in the kits definition.
        // Do this only for the first folder, to avoid multiple rescans taking place in a multi-root workspace.
        const silentScanForKitsNeeded: boolean = vscode.workspace.workspaceFolders !== undefined &&
            vscode.workspace.workspaceFolders[0] === cmakeProject?.rootFolder &&
            await scanForKitsIfNeeded(cmakeProject);

        let shouldConfigure = cmakeProject?.workspaceContext.config.configureOnOpen;
        if (shouldConfigure === null && !util.isTestMode()) {
            interface Choice1 {
                title: string;
                doConfigure: boolean;
            }
            const chosen = await vscode.window.showInformationMessage<Choice1>(
                localize('configure.this.project', 'Would you like to configure project {0}?', `"${folder.name}"`),
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
                        const config = vscode.workspace.getConfiguration(undefined, folder.uri);
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
        if (cmakeProject) {
            if (!await this.folderIsCMakeProject(cmakeProject)) {
                await cmakeProject.cmakePreConditionProblemHandler(CMakePreconditionProblems.MissingCMakeListsFile, false, this.workspaceConfig);
            } else {
                if (shouldConfigure === true) {
                    // We've opened a new workspace folder, and the user wants us to
                    // configure it now.
                    log.debug(localize('configuring.workspace.on.open', 'Configuring workspace on open {0}', folder.uri.toString()));
                    await this.configureExtensionInternal(ConfigureTrigger.configureOnOpen, cmakeProject);
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
                        await this.configureExtensionInternal(ConfigureTrigger.buttonNewKitsDefinition, cmakeProject);
                    } else {
                        log.debug(localize('using.cache.to.configure.workspace.on.open', 'Attempting to use cache to configure workspace {0}', folder.uri.toString()));
                        await this.configureExtensionInternal(ConfigureTrigger.configureWithCache, cmakeProject);
                    }
                }
            }
        }

        this.updateCodeModel(folder, cmakeProject);
    }

    private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
        if (vscode.workspace.workspaceFolders) {
            let ws: vscode.WorkspaceFolder | undefined;
            if (editor) {
                ws = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            }
            if (ws) {
                if (!this.activeCMakeWorkspaceFolder() || ws.uri.fsPath !== this.activeFolderPath()) {
                    // active folder changed.
                    await this.setActiveProject(ws, editor);
                }
            } else if (!ws && !this.activeCMakeWorkspaceFolder() && vscode.workspace.workspaceFolders.length >= 1) {
                await this.setActiveProject(vscode.workspace.workspaceFolders[0], editor);
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
            const lastActiveFolderPath = this.activeFolderPath();
            const selection = await vscode.window.showWorkspaceFolderPick(); //ELLA
            if (selection) {
                // Ingore if user cancelled
                await this.setActiveProject(selection);
                telemetry.logEvent("selectactivefolder");
                // this.folders.activeFolder must be there at this time
                const currentActiveFolderPath = this.activeFolderPath();
                await this.extensionContext.workspaceState.update('activeFolder', currentActiveFolderPath);
                if (lastActiveFolderPath !== currentActiveFolderPath) {
                    const folder: vscode.WorkspaceFolder | undefined = this.activeCMakeWorkspaceFolder()!;
                    const cmakeProject: CMakeProject | undefined = this.getActiveCMakeProject();
                    rollbar.takePromise('Post-folder-open', { folder: selection }, this.postWorkspaceOpen(folder, cmakeProject));
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
        return this.setActiveProject(folder, vscode.window.activeTextEditor);
    }

    /**
     * Set the active workspace folder. This reloads a lot of different bits and
     * pieces to control which backend has control and receives user input.
     * @param ws The workspace to activate
     */
    private async setActiveProject(ws: vscode.WorkspaceFolder | undefined, editor?: vscode.TextEditor | undefined) {
        // Set the new workspace
        const activeProjectName = this.cmakeProjectController.setActiveCMakeProject(ws, editor);
        const activeProject: CMakeProject | undefined = this.getActiveCMakeProject();
        this.statusBar.setActiveProjectName(activeProjectName || ws?.name || "");
        const useCMakePresets = activeProject?.useCMakePresets || false;
        this.statusBar.useCMakePresets(useCMakePresets);
        if (!useCMakePresets) {
            this.statusBar.setActiveKitName(activeProject?.activeKit?.name || '');
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
    private updateCodeModel(folder: vscode.WorkspaceFolder, cmakeProject?: CMakeProject) {
        if (!cmakeProject) {
            return;
        }
        this.projectOutlineProvider.updateCodeModel(
            cmakeProject.workspaceContext.folder,
            cmakeProject.codeModelContent,
            {
                defaultTarget: cmakeProject.defaultBuildTarget || undefined,
                launchTargetName: cmakeProject.launchTargetName
            }
        );
        rollbar.invokeAsync(localize('update.code.model.for.cpptools', 'Update code model for cpptools'), {}, async () => {
            if (vscode.workspace.getConfiguration('C_Cpp', folder.uri).get<string>('intelliSenseEngine')?.toLocaleLowerCase() === 'disabled') {
                log.debug(localize('update.intellisense.disabled', 'Not updating the configuration provider because {0} is set to {1}', '"C_Cpp.intelliSenseEngine"', '"Disabled"'));
                return;
            }
            if (!this.cppToolsAPI && !util.isTestMode()) {
                try {
                    this.cppToolsAPI = await cpt.getCppToolsApi(cpt.Version.latest);
                } catch (err) {
                    log.debug(localize('failed.to.get.cpptools.api', 'Failed to get cppTools API'));
                }
            }

            if (this.cppToolsAPI && (cmakeProject.activeKit || cmakeProject.configurePreset)) {
                const cpptools = this.cppToolsAPI;
                let cache: CMakeCache;
                try {
                    cache = await CMakeCache.fromPath(await cmakeProject.cachePath);
                } catch (e: any) {
                    rollbar.exception(localize('filed.to.open.cache.file.on.code.model.update', 'Failed to open CMake cache file on code model update'), e);
                    return;
                }
                const drv: CMakeDriver | null = await cmakeProject.getCMakeDriverInstance();
                const configureEnv = await drv?.getConfigureEnvironment();

                const configurationTypes = cache.get('CMAKE_CONFIGURATION_TYPES');
                const isMultiConfig = !!configurationTypes;
                if (drv) {
                    drv.isMultiConfig = isMultiConfig;
                }
                const actualBuildType = await (async () => {
                    if (cmakeProject.useCMakePresets) {
                        if (isMultiConfig) {
                            // The `configuration` is not set on the default build preset because it is optional for single-config generators.
                            // If we have a multi-config generator we need to select the first value from CMAKE_CONFIGURATION_TYPES to match CMake's behavior.
                            if (cmakeProject.buildPreset?.name === defaultBuildPreset.name) {
                                const buildTypes = configurationTypes.as<string>().split(';');
                                if (buildTypes.length > 0) {
                                    return buildTypes[0];
                                }
                            }
                            return cmakeProject.buildPreset?.configuration || null;
                        } else {
                            const buildType = cache.get('CMAKE_BUILD_TYPE');
                            return buildType ? buildType.as<string>() : null; // Single config generators set the build type during config, not build.
                        }
                    } else {
                        return cmakeProject.currentBuildType();
                    }
                })();

                const clCompilerPath = await findCLCompilerPath(configureEnv);
                this.configProvider.cpptoolsVersion = cpptools.getVersion();
                let codeModelContent;
                if (cmakeProject.codeModelContent) {
                    codeModelContent = cmakeProject.codeModelContent;
                    this.configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmakeProject.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmakeProject.folderPath });
                } else if (drv && drv.codeModelContent) {
                    codeModelContent = drv.codeModelContent;
                    this.configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmakeProject.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmakeProject.folderPath });
                    this.projectOutlineProvider.updateCodeModel(
                        cmakeProject.workspaceContext.folder,
                        codeModelContent,
                        {
                            defaultTarget: cmakeProject.defaultBuildTarget || undefined,
                            launchTargetName: cmakeProject.launchTargetName
                        }
                    );
                }
                // Inform cpptools that custom CppConfigurationProvider will be able to service the current workspace.
                this.ensureCppToolsProviderRegistered();
                if (cpptools.notifyReady && this.cpptoolsNumFoldersReady < this.cmakeProjectController.numOfRoots) {
                    ++this.cpptoolsNumFoldersReady;
                    if (this.cpptoolsNumFoldersReady === this.cmakeProjectController.numOfRoots) {
                        // Notify cpptools that the provider is ready to provide IntelliSense configurations.
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
        const cmakeProject = this.getActiveCMakeProject();
        if (!cmakeProject) {
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
            this.statusMessageSub = cmakeProject.onStatusMessageChanged(FireNow, s => this.statusBar.setStatusMessage(s));
            this.targetNameSub = cmakeProject.onTargetNameChanged(FireNow, t => {
                this.statusBar.setBuildTargetName(t);
            });
            this.buildTypeSub = cmakeProject.onActiveVariantNameChanged(FireNow, bt => this.statusBar.setVariantLabel(bt));
            this.launchTargetSub = cmakeProject.onLaunchTargetNameChanged(FireNow, t => {
                this.statusBar.setLaunchTargetName(t || '');
            });
            this.ctestEnabledSub = cmakeProject.onCTestEnabledChanged(FireNow, e => this.statusBar.setCTestEnabled(e));
            this.testResultsSub = cmakeProject.onTestResultsChanged(FireNow, r => this.statusBar.setTestResults(r));
            this.isBusySub = cmakeProject.onIsBusyChanged(FireNow, b => this.statusBar.setIsBusy(b));
            this.statusBar.setActiveKitName(cmakeProject.activeKit ? cmakeProject.activeKit.name : '');
            this.activeConfigurePresetSub = cmakeProject.onActiveConfigurePresetChanged(FireNow, p => {
                this.statusBar.setConfigurePresetName(p?.displayName || p?.name || '');
            });
            this.activeBuildPresetSub = cmakeProject.onActiveBuildPresetChanged(FireNow, p => {
                this.statusBar.setBuildPresetName(p?.displayName || p?.name || '');
            });
            this.activeTestPresetSub = cmakeProject.onActiveTestPresetChanged(FireNow, p => {
                this.statusBar.setTestPresetName(p?.displayName || p?.name || '');
            });
        }
    }

    /**
     * Watches for changes to the kits file
     */
    private readonly kitsWatcher = util.chokidarOnAnyChange(
        chokidar.watch(USER_KITS_FILEPATH, { ignoreInitial: true }),
        _ => rollbar.takePromise(localize('rereading.kits', 'Re-reading kits'), {}, KitsController.readUserKits(this.getActiveCMakeProject())));

    /**
     * Set the current kit for the specified workspace folder
     * @param k The kit
     */
    async setFolderKit(wsf: vscode.WorkspaceFolder, k: Kit | null) {
        const cmakeWorkspaceFolder = this.cmakeProjectController.getCMakeProjectsForFolder(wsf);
        // Ignore if folder doesn't exist
        if (cmakeWorkspaceFolder) {
            this.statusBar.setActiveKitName(await this.getActiveCMakeProject()!.kitsController.setFolderActiveKit(k));
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
        await this.getActiveCMakeProject()?.presetsController.reapplyPresets();
    }

    async scanForKits() {
        KitsController.minGWSearchDirs = await this.getMinGWDirs();
        const cmakeProject =this.getActiveCMakeProject();
        if (undefined === cmakeProject) {
            return;
        }

        const duplicateRemoved = await KitsController.scanForKits(cmakeProject);
        if (duplicateRemoved) {
            // Check each folder. If there is an active kit set and if it is of the old definition,
            // unset the kit
            const activeCMakeProject = this.getActiveCMakeProject();
            const activeKit = activeCMakeProject?.activeKit;
            if (activeKit) {
                const definition = activeKit.visualStudio;
                if (definition && (definition.startsWith("VisualStudio.15") || definition.startsWith("VisualStudio.16"))) {
                    await activeCMakeProject?.kitsController.setFolderActiveKit(null);
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

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        const activeCMakeProject = this.getActiveCMakeProject();
        const kitSelected = await activeCMakeProject?.kitsController.selectKit();

        let kitSelectionType;
        // const activeFolder = this.activeFolder();
        const activeKit = activeCMakeProject?.activeKit;
        if (activeKit) {
            this.statusBar.setActiveKitName(activeKit.name);

            if (activeKit.name === "__unspec__") {
                kitSelectionType = "unspecified";
            } else {
                if (activeKit.visualStudio ||
                    activeKit.visualStudioArchitecture) {
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
            await this.getActiveCMakeProject()?.kitsController.setKitByName(kitName);
        }
        const activeFolder = this.activeCMakeWorkspaceFolder();
        const activeKit = this.getActiveCMakeProject()?.activeKit;
        if (activeFolder && activeKit) {
            this.statusBar.setActiveKitName(activeKit.name);
        }
    }

    /**
     * Set the current preset used in the specified folder by name of the preset
     * For backward compatibility, apply preset to all folders if folder is undefined
     */
    async setConfigurePreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            await this.getActiveCMakeProject()?.presetsController.setConfigurePreset(presetName);
        }
    }

    async setBuildPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            await this.getActiveCMakeProject()?.presetsController.setBuildPreset(presetName);
        }
    }

    async setTestPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            await this.getActiveCMakeProject()?.presetsController.setTestPreset(presetName);
        }
    }

    useCMakePresets(folder: vscode.WorkspaceFolder): boolean {
        return this.cmakeProjectController.useCMakePresetsForFolder(folder);
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
    async runCMakeCommand(command: RunCMakeCommand,
        cmakeProject = this.getActiveCMakeProject(),
        precheck?: (cmakeProject: CMakeProject) => Promise<boolean>): Promise<any> {
        if (!cmakeProject) {
            rollbar.error(localize('no.active.folder', 'No active folder.'));
            return -2;
        }
        if (!await this.ensureActiveConfigurePresetOrKit(cmakeProject)) {
            return -1;
        }
        if (precheck && !await precheck(cmakeProject)) {
            return -100;
        }

        return command(cmakeProject);
    }

    async runCMakeCommandForAll(command: RunCMakeCommand, precheck?: (cmakeProject: CMakeProject) => Promise<boolean>, cleanOutputChannel?: boolean): Promise<any> {
        if (cleanOutputChannel) {
            this.cleanOutputChannel();
        }

        const activeCMakeProject = this.getActiveCMakeProject();
        if (activeCMakeProject) {
            if (!await this.ensureActiveConfigurePresetOrKit(activeCMakeProject)) {
                return -1;
            }
            if (precheck && !await precheck(activeCMakeProject)) {
                return -100;
            }

            const retc = await command(activeCMakeProject);
            if (retc) {
                return retc;
            }
        }
        // Succeeded
        return 0;
    }

    runCMakeCommandForFolder(command: RunCMakeCommand, _folder?: vscode.WorkspaceFolder, precheck?: (cmakeProject: CMakeProject) => Promise<boolean>, cleanOutputChannel?: boolean): Promise<any> {
        if (cleanOutputChannel) {
            this.cleanOutputChannel();
        }

        return this.runCMakeCommand(command, this.getActiveCMakeProject(), precheck);
    }

    queryCMakeProject(query: QueryCMakeProject, folder?: vscode.WorkspaceFolder | string) {
        const workspaceFolder: vscode.WorkspaceFolder | undefined = this.getWorkspaceFolder(folder);
        if (workspaceFolder) {
            const cmakeWorkspaceFolder = this.cmakeProjectController.getCMakeProjectsForFolder(workspaceFolder);
            if (cmakeWorkspaceFolder) {
                return query(this.getActiveCMakeProject()!);
            }
        } else {
            rollbar.error(localize('invalid.folder', 'Invalid folder.'));
        }
        return Promise.resolve(null);
    }

    cleanConfigure(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("deleteCacheAndReconfigure");
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.cleanConfigure(ConfigureTrigger.commandCleanConfigure), folder, undefined, true);
    }

    cleanConfigureAll() {
        telemetry.logEvent("deleteCacheAndReconfigure");
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.cleanConfigure(ConfigureTrigger.commandCleanConfigureAll), undefined, true);
    }

    configure(folder?: vscode.WorkspaceFolder, showCommandOnly?: boolean) {
        return this.runCMakeCommandForFolder(
            cmakeProject => cmakeProject.configureInternal(ConfigureTrigger.commandConfigure, [], showCommandOnly ? ConfigureType.ShowCommandOnly : ConfigureType.Normal),
            folder, undefined, true);
    }

    showConfigureCommand(folder?: vscode.WorkspaceFolder) {
        return this.configure(folder, true);
    }

    configureAll() {
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.configureInternal(ConfigureTrigger.commandCleanConfigureAll, [], ConfigureType.Normal), undefined, true);
    }

    editCacheUI() {
        telemetry.logEvent("editCMakeCache", { command: "editCMakeCacheUI" });
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.editCacheUI());
    }

    build(folder?: vscode.WorkspaceFolder, name?: string, showCommandOnly?: boolean, isBuildCommand?: boolean) {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.build(name ? [name] : undefined, showCommandOnly, (isBuildCommand === undefined) ? true : isBuildCommand), folder, this.ensureActiveBuildPreset, true);
    }
    showBuildCommand(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.build(folder, name, true, false);
    }

    buildAll(name?: string | string[]) {
        return this.runCMakeCommandForAll(cmakeProject => {
            const targets = util.isArrayOfString(name) ? name : util.isString(name) ? [name] : undefined;
            return cmakeProject.build(targets);
        },
        this.ensureActiveBuildPreset,
        true);
    }

    setDefaultTarget(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.setDefaultTarget(name), folder);
    }

    setVariant(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.setVariant(name), folder);
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
            return this.runCMakeCommandForAll(cmakeProject => cmakeProject.setVariant(choice.label));
        }
        return false;
    }

    install(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("install");
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.install(), folder, undefined, true);
    }

    installAll() {
        telemetry.logEvent("install");
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.install(), undefined, true);
    }

    editCache(folder: vscode.WorkspaceFolder) {
        telemetry.logEvent("editCMakeCache", { command: "editCMakeCache" });
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.editCache(), folder);
    }

    clean(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("clean");
        return this.build(folder, 'clean', undefined, false);
    }

    cleanAll() {
        telemetry.logEvent("clean");
        return this.buildAll(['clean']);
    }

    cleanRebuild(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("clean");
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.cleanRebuild(), folder, this.ensureActiveBuildPreset, true);
    }

    cleanRebuildAll() {
        telemetry.logEvent("clean");
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.cleanRebuild(), this.ensureActiveBuildPreset, true);
    }

    async buildWithTarget() {
        this.cleanOutputChannel();
        let activeCMakeProject: CMakeProject | undefined = this.getActiveCMakeProject();
        if (!activeCMakeProject) {
            activeCMakeProject = await this.pickCMakeProject();
            if (!activeCMakeProject) {
                return; // Error or nothing is opened
            }
        } else {
            return activeCMakeProject.buildWithTarget();
        }
    }

    private async pickCMakeProject(): Promise<CMakeProject | undefined> {
        const projects: CMakeProject[] = this.cmakeProjectController.getAllCMakeProjects();
        interface ProjectItem extends vscode.QuickPickItem {
            cmakeProject: CMakeProject;
        }
        const items = projects.map(project => {
            const item: ProjectItem = {
                label: project.folderName,
                cmakeProject: project
            };
            return item;
        });
        const selection = await vscode.window.showQuickPick(items);
        if (selection) {
            console.assert(selection.cmakeProject.folderName, 'Folder not found in folder controller.');
            return selection.cmakeProject;
        }
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
        const term = await this.getActiveCMakeProject()?.tryCompileFile(file);
        if (term) {
            return term;
        }
        void vscode.window.showErrorMessage(localize('compilation information.not.found', 'Unable to find compilation information for this file'));
    }

    async selectWorkspace(folder?: vscode.WorkspaceFolder) {
        if (!folder) {
            return;
        }
        await this.setActiveProject(folder);
    }

    ctest(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("runTests");
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.ctest(), folder, this.ensureActiveTestPreset);
    }

    ctestAll() {
        telemetry.logEvent("runTests");
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.ctest(), this.ensureActiveTestPreset);
    }

    stop(folder?: vscode.WorkspaceFolder) {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.stop(), folder);
    }

    stopAll() {
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.stop());
    }

    quickStart(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("quickStart");
        return this.runCMakeCommand(cmakeProject => cmakeProject.quickStart(folder));
    }

    launchTargetPath(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "launchTargetPath" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.launchTargetPath(), folder);
    }

    launchTargetDirectory(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "launchTargetDirectory" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.launchTargetDirectory(), folder);
    }

    launchTargetFilename(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "launchTargetFilename" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.launchTargetFilename(), folder);
    }

    getLaunchTargetPath(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "getLaunchTargetPath" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.getLaunchTargetPath(), folder);
    }

    getLaunchTargetDirectory(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "getLaunchTargetDirectory" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.getLaunchTargetDirectory(), folder);
    }

    getLaunchTargetFilename(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "getLaunchTargetFilename" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.getLaunchTargetFilename(), folder);
    }

    buildTargetName(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildTargetName" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.buildTargetName(), folder);
    }

    buildType(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildType" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.currentBuildType(), folder);
    }

    buildDirectory(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildDirectory" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.buildDirectory(), folder);
    }

    buildKit(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "buildKit" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.buildKit(), folder);
    }

    executableTargets(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "executableTargets" });
        return this.queryCMakeProject(async cmakeProject => (await cmakeProject.executableTargets).map(target => target.name), folder);
    }

    tasksBuildCommand(folder?: vscode.WorkspaceFolder | string) {
        telemetry.logEvent("substitution", { command: "tasksBuildCommand" });
        return this.queryCMakeProject(cmakeProject => cmakeProject.tasksBuildCommand(), folder);
    }

    debugTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.DebugSession | null> {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.debugTarget(name), folder);
    }

    async debugTargetAll(): Promise<(vscode.DebugSession | null)[]> {
        const debugSessions: (vscode.DebugSession | null)[] = [];
        for (const cmakeWorkspaceFolder of this.cmakeProjectController) {
            if (cmakeWorkspaceFolder) {
                debugSessions.push(await this.runCMakeCommand(cmakeProject => cmakeProject.debugTarget(), this.getActiveCMakeProject()));
            }
        }
        return debugSessions;
    }

    launchTarget(folder?: vscode.WorkspaceFolder, name?: string): Promise<vscode.Terminal | null> {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.launchTarget(name), folder);
    }

    async launchTargetAll(): Promise<(vscode.Terminal | null)[]> {
        const terminals: (vscode.Terminal | null)[] = [];
        for (const cmakeWorkspaceFolder of this.cmakeProjectController) {
            if (cmakeWorkspaceFolder) {
                terminals.push(await this.runCMakeCommand(cmakeProject => cmakeProject.launchTarget(), this.getActiveCMakeProject()));
            }
        }
        return terminals;
    }

    selectLaunchTarget(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.runCMakeCommandForFolder(cmakeProject => cmakeProject.selectLaunchTarget(name), folder);
    }

    async resetState(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("resetExtension");
        if (folder) {
            await this.runCMakeCommandForFolder(cmakeProject => cmakeProject.resetState(), folder);
        } else {
            await this.runCMakeCommandForAll(cmakeProject => cmakeProject.resetState());
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
        for (const folder of this.cmakeProjectController.getAllCMakeProjects()) {
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

    activeCMakeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        return this.getActiveCMakeProject()?.rootFolder;
    }

    activeFolderName(): string {
        return this.cmakeProjectController.activeFolderName || '';
    }

    activeFolderPath(): string {
        return this.cmakeProjectController.activeFolderPath || '';
    }

    public getCMakeWorkspaceFolder(folder: vscode.WorkspaceFolder): CMakeProject[] | undefined {
        return this.cmakeProjectController.getCMakeProjectsForFolder(folder);
    }

    public getActiveCMakeProject(): CMakeProject | undefined {
        return this.cmakeProjectController.getActiveCMakeProject();
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
        if (await this.folderIsCMakeProject(this.getActiveCMakeProject()!)) {
            return true;
        }

        return false;
    }

    activeConfigurePresetName(): string {
        telemetry.logEvent("substitution", { command: "activeConfigurePresetName" });
        return this.getActiveCMakeProject()?.configurePreset?.name || '';
    }

    activeBuildPresetName(): string {
        telemetry.logEvent("substitution", { command: "activeBuildPresetName" });
        return this.getActiveCMakeProject()?.buildPreset?.name || '';
    }

    activeTestPresetName(): string {
        telemetry.logEvent("substitution", { command: "activeTestPresetName" });
        return this.getActiveCMakeProject()?.testPreset?.name || '';
    }

    /**
     * Opens CMakePresets.json at the root of the project. Creates one if it does not exist.
     */
    async openCMakePresets(): Promise<void> {
        await this.getActiveCMakeProject()?.presetsController.openCMakePresets();
    }

    /**
     * Show UI to allow the user to add an active configure preset
     */
    async addConfigurePreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.config.preset.in.test.mode', 'Running CMakeTools in test mode. addConfigurePreset is disabled.'));
            return false;
        }

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        return this.getActiveCMakeProject()!.presetsController.addConfigurePreset();
    }

    /**
     * Show UI to allow the user to add an active build preset
     */
    async addBuildPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.build.preset.in.test.mode', 'Running CMakeTools in test mode. addBuildPreset is disabled.'));
            return false;
        }

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        return this.getActiveCMakeProject()!.presetsController.addBuildPreset();
    }

    /**
     * Show UI to allow the user to add an active test preset
     */
    async addTestPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.test.preset.in.test.mode', 'Running CMakeTools in test mode. addTestPreset is disabled.'));
            return false;
        }

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        return this.getActiveCMakeProject()!.presetsController.addTestPreset();
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

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        const presetSelected = await this.getActiveCMakeProject()!.presetsController.selectConfigurePreset();

        const configurePreset = this.getActiveCMakeProject()?.configurePreset;
        this.statusBar.setConfigurePresetName(configurePreset?.displayName || configurePreset?.name || '');

        // Reset build and test presets since they might not be used with the selected configure preset
        const buildPreset = this.getActiveCMakeProject()?.buildPreset;
        this.statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');
        const testPreset = this.getActiveCMakeProject()?.testPreset;
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

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        const presetSelected = await this.getActiveCMakeProject()!.presetsController.selectBuildPreset();

        const buildPreset = this.getActiveCMakeProject()?.buildPreset;
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

        const cmakeWorkspaceFolder = this.getCMakeProjectsForFolder(folder);
        if (!cmakeWorkspaceFolder) {
            return false;
        }

        const presetSelected = await this.getActiveCMakeProject()!.presetsController.selectTestPreset();

        const testPreset = this.getActiveCMakeProject()?.testPreset;
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
                const command = (ext[name] as Function).bind(ext);
                // Call the method
                const ret = await command(...args);
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
        'activeConfigurePresetName',
        'activeBuildPresetName',
        'activeTestPresetName',
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
    if (util.isTestMode()) {
        log.trace(localize('register.command', 'Register CMakeTools extension command cmake.getSettingsChangePromise'));
        context.subscriptions.push(vscode.commands.registerCommand('cmake.getSettingsChangePromise', () => getSettingsChangePromise()));
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
    // context.subscriptions.push(vscode.commands.registerCommand('cmake._extensionInstance', () => cmakeProject));

}

// Enable all or part of the CMake Tools palette commands
// and show or hide the buttons in the status bar, according to the boolean.
// The scope of this is the whole workspace.
export async function enableFullFeatureSet(fullFeatureSet: boolean) {
    await util.setContextValue("cmake:enableFullFeatureSet", fullFeatureSet);
    extensionManager?.showStatusBar(fullFeatureSet);
}

export function isActiveFolder(folder: vscode.WorkspaceFolder): boolean | undefined {
    return extensionManager?.isActiveFolder(folder);
}

export function getActiveCMakeProject(): CMakeProject | undefined {
    return extensionManager?.getActiveCMakeProject();
}

// This method updates the full/partial view state of the given folder
// (by analyzing the valid state of its CMakeLists.txt)
// and also calculates the impact on the whole workspace.
// It is called whenever a project folder goes through a relevant event:
// sourceDirectory change, CMakeLists.txt creation/move/deletion.
export async function updateFullFeatureSetForFolder(folderName: string) {
    if (extensionManager) {
        const cmakeProject: CMakeProject | undefined = getActiveCMakeProject();
        if (cmakeProject) {
            // Save the CMakeLists valid state in the map for later reference
            // and evaluate its effects on the global full feature set view.
            const folderFullFeatureSet: boolean = await extensionManager.folderIsCMakeProject(cmakeProject);

            // Reset ignoreCMakeListsMissing now that we have a valid CMakeLists.txt
            // so that the next time we don't have one the user is notified.
            if (folderFullFeatureSet) {
                await cmakeProject.workspaceContext.state.setIgnoreCMakeListsMissing(false);
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

    // This shouldn't normally happen (not finding a cmake project or not having a valid extension manager)
    // but just in case, enable full feature set.
    log.info(`Cannot find CMake Project for folder ${folderName} or we don't have an extension manager created yet. ` +
        `Setting feature set view to "full".`);
    await enableFullFeatureSet(true);
}

// Whether this CMake Tools extension instance will show the "Create/Locate/Ignore" toast popup
// for a non CMake project (as opposed to listing all existing CMakeLists.txt in the workspace
// in a quickPick.)
export function showCMakeListsExperiment(): Promise<boolean> {
    return extensionManager?.showCMakeListsExperiment() || Promise.resolve(false);
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
