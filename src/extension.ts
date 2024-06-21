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
import * as api from 'vscode-cmake-tools';
import { CMakeCache } from '@cmt/cache';
import { CMakeProject, ConfigureType, ConfigureTrigger, DiagnosticsConfiguration, DiagnosticsSettings } from '@cmt/cmakeProject';
import { ConfigurationReader, getSettingsChangePromise, TouchBarConfig } from '@cmt/config';
import { CppConfigurationProvider, DiagnosticsCpptools } from '@cmt/cpptools';
import { ProjectController, FolderProjectType} from '@cmt/projectController';

import {
    SpecialKits,
    USER_KITS_FILEPATH,
    findCLCompilerPath,
    scanForKitsIfNeeded
} from '@cmt/kit';
import { KitsController } from '@cmt/kitsController';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import { FireNow, FireLate } from '@cmt/prop';
import rollbar from '@cmt/rollbar';
import { StateManager } from './state';
import { cmakeTaskProvider, CMakeTaskProvider } from '@cmt/cmakeTaskProvider';
import * as telemetry from '@cmt/telemetry';
import { ProjectOutline, ProjectNode, TargetNode, SourceFileNode, WorkspaceFolderNode } from '@cmt/projectOutline/projectOutline';
import * as util from '@cmt/util';
import { ProgressHandle, DummyDisposable, reportProgress, runCommand } from '@cmt/util';
import { DEFAULT_VARIANTS } from '@cmt/variant';
import { expandString, KitContextVars } from '@cmt/expand';
import paths from '@cmt/paths';
import { CMakeDriver, CMakePreconditionProblems } from './drivers/cmakeDriver';
import { platform } from 'os';
import { CMakeToolsApiImpl } from './api';
import { DirectoryContext } from './workspace';
import { ProjectStatus } from './projectStatus';
import { PinnedCommands } from './pinnedCommands';
import { StatusBar } from '@cmt/status';
import { DebugAdapterNamedPipeServerDescriptorFactory } from './debug/debugAdapterNamedPipeServerDescriptorFactory';
import { getCMakeExecutableInformation } from './cmake/cmakeExecutable';
import { DebuggerInformation, getDebuggerPipeName } from './debug/debuggerConfigureDriver';
import { DebugConfigurationProvider, DynamicDebugConfigurationProvider } from './debug/debugConfigurationProvider';
import { deIntegrateTestExplorer } from './ctest';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
let taskProvider: vscode.Disposable;
let pinnedCommands: PinnedCommands;

const log = logging.createLogger('extension');

const multiProjectModeKey = 'cmake:multiProject';
export const hideLaunchCommandKey = 'cmake:hideLaunchCommand';
export const hideDebugCommandKey = 'cmake:hideDebugCommand';
export const hideBuildCommandKey = 'cmake:hideBuildCommand';

/**
 * The global extension manager. There is only one of these, even if multiple
 * backends.
 */
export let extensionManager: ExtensionManager | null = null;

type RunCMakeCommand = (project: CMakeProject) => Thenable<any>;
type QueryCMakeProject = (project: CMakeProject) => Thenable<string | string[] | null>;
type FolderTargetNameArgsType = vscode.WorkspaceFolder | string | { folder?: vscode.WorkspaceFolder | string; targetName?: string };

interface Diagnostics {
    os: string;
    vscodeVersion: string;
    cmtVersion: string;
    configurations: DiagnosticsConfiguration[];
    settings: DiagnosticsSettings[];
    cpptoolsIntegration: DiagnosticsCpptools;
}

interface ExtensionActiveCommandsInfo {
    contextUsed: {[key: string]: any};
    extensionActiveCommands: string [];
}

/**
 * A class to manage the extension.
 * This is the true "singleton" of the extension. It acts as the glue between
 * the lower layers and the VSCode UX. When a user presses a button to
 * necessitate user input, this class acts as intermediary and will send
 * important information down to the lower layers.
 */
export class ExtensionManager implements vscode.Disposable {
    constructor(public readonly extensionContext: vscode.ExtensionContext) {
        telemetry.activate(extensionContext);
        this.api = new CMakeToolsApiImpl(this);
    }

    private contextValues: {[key: string]: any} = {};
    private extensionActiveCommandsInfo: ExtensionActiveCommandsInfo | null = null;
    private localizedStrings: {[key: string]: string} = {};
    private onDidChangeActiveTextEditorSub: vscode.Disposable = new DummyDisposable();
    private readonly extensionActiveCommandsEmitter = new vscode.EventEmitter<void>();
    private readonly workspaceConfig: ConfigurationReader = ConfigurationReader.create();

    private updateTouchBarVisibility(config: TouchBarConfig) {
        const touchBarVisible = config.visibility === "default";
        void setContextAndStore("cmake:enableTouchBar", touchBarVisible);
        void setContextAndStore("cmake:enableTouchBar.build", touchBarVisible && !(config.advanced?.build === "hidden"));
        void setContextAndStore("cmake:enableTouchBar.configure", touchBarVisible && !(config.advanced?.configure === "hidden"));
        void setContextAndStore("cmake:enableTouchBar.debug", touchBarVisible && !(config.advanced?.debug === "hidden"));
        void setContextAndStore("cmake:enableTouchBar.launch", touchBarVisible && !(config.advanced?.launch === "hidden"));
    }
    /**
     * Second-phase async init
     */
    public async init() {
        this.updateTouchBarVisibility(this.workspaceConfig.touchbar);
        this.workspaceConfig.onChange('touchbar', config => this.updateTouchBarVisibility(config));

        let cmakePath = this.workspaceConfig.rawCMakePath;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) {
            const workspaceContext = DirectoryContext.createForDirectory(vscode.workspace.workspaceFolders[0], new StateManager(this.extensionContext, vscode.workspace.workspaceFolders[0]));
            cmakePath = await workspaceContext.getCMakePath() || '';
        }
        // initialize the state of the cmake exe
        await getCMakeExecutableInformation(cmakePath);

        await util.setContextValue("cmake:testExplorerIntegrationEnabled", this.workspaceConfig.testExplorerIntegrationEnabled);
        this.workspaceConfig.onChange("ctest", async (value) => {
            await util.setContextValue("cmake:testExplorerIntegrationEnabled", value.testExplorerIntegrationEnabled);
            if (!value.testExplorerIntegrationEnabled) {
                // Dynamically de-integrate the test explorer.
                deIntegrateTestExplorer();
            } else {
                // Attempt to refresh the tests when dynamically re-integrating the test explorer.
                await getActiveProject()?.refreshTests();
            }
        });

        this.onDidChangeActiveTextEditorSub = vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e), this);

        this.projectController.onAfterAddFolder(async (folderProjectMap: FolderProjectType) => {
            const folder: vscode.WorkspaceFolder = folderProjectMap.folder;
            if (this.projectController.numOfWorkspaceFolders === 1) {
                // First folder added
                await this.updateActiveProject(folder);
            } else {
                await this.initActiveProject();
            }
            await setContextAndStore(multiProjectModeKey, this.projectController.hasMultipleProjects);
            this.projectOutline.addFolder(folder);
            if (this.codeModelUpdateSubs.get(folder.uri.fsPath)) {
                this.codeModelUpdateSubs.get(folder.uri.fsPath)?.forEach(sub => sub.dispose());
                this.codeModelUpdateSubs.delete(folder.uri.fsPath);
            }
            const subs: vscode.Disposable[] = [];
            for (const project of folderProjectMap.projects) {
                subs.push(project.onCodeModelChanged(FireLate, () => this.updateCodeModel(project)));
                subs.push(project.onTargetNameChanged(FireLate, () => this.updateCodeModel(project)));
                subs.push(project.onLaunchTargetNameChanged(FireLate, () => this.updateCodeModel(project)));
                subs.push(project.onActiveBuildPresetChanged(FireLate, () => this.updateCodeModel(project)));
                this.codeModelUpdateSubs.set(project.folderPath, subs);
                rollbar.takePromise('Post-folder-open', { folder: folder, project: project }, this.postWorkspaceOpen(project));
            }
        });

        this.projectController.onBeforeRemoveFolder(async projects => {
            for (const project of projects) {
                project.removeTestExplorerRoot(project.folderPath);
            }
        });

        this.projectController.onAfterRemoveFolder(async folder => {
            console.assert((vscode.workspace.workspaceFolders === undefined && this.projectController.numOfWorkspaceFolders === 0) ||
                (vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length === this.projectController.numOfWorkspaceFolders));
            this.codeModelUpdateSubs.get(folder.uri.fsPath)?.forEach(sub => sub.dispose());
            this.codeModelUpdateSubs.delete(folder.uri.fsPath);
            if (!vscode.workspace.workspaceFolders?.length) {
                await this.updateActiveProject(undefined);
            } else {
                if (this.activeFolderPath() === folder.uri.fsPath) {
                    await this.updateActiveProject(vscode.workspace.workspaceFolders[0]);
                } else {
                    this.setupSubscriptions();
                }
                await setContextAndStore(multiProjectModeKey, this.projectController.hasMultipleProjects);
                // Update the full/partial view of the workspace by verifying if after the folder removal
                // it still has at least one CMake project.
                await enableFullFeatureSet(this.workspaceHasAtLeastOneProject());
            }

            this.projectOutline.removeFolder(folder);
        });

        this.workspaceConfig.onChange('autoSelectActiveFolder', v => {
            if (this.projectController.hasMultipleProjects) {
                telemetry.logEvent('configChanged.autoSelectActiveFolder', { autoSelectActiveFolder: `${v}` });
            }
            this.statusBar.setAutoSelectActiveProject(v);
        });
        this.workspaceConfig.onChange('options', v => {
            telemetry.logEvent('configChanged.options', {
                statusBarVisibility: `${v.statusBarVisibility}`,
                advanced_configure_projectStatusVisibility: `${v.advanced?.configure?.projectStatusVisibility}`,
                advanced_configurePreset_statusBarVisibility: `${v.advanced?.configurePreset?.statusBarVisibility}`,
                advanced_configurePreset_statusBarLength: `${v.advanced?.configurePreset?.statusBarLength}`,
                advanced_buildPreset_statusBarVisibility: `${v.advanced?.buildPreset?.statusBarVisibility}`,
                advanced_buildPreset_statusBarLength: `${v.advanced?.buildPreset?.statusBarLength}`,
                advanced_testPreset_statusBarVisibility: `${v.advanced?.testPreset?.statusBarVisibility}`,
                advanced_testPreset_statusBarLength: `${v.advanced?.testPreset?.statusBarLength}`,
                advanced_packagePreset_statusBarVisibility: `${v.advanced?.packagePreset?.statusBarVisibility}`,
                advanced_packagePreset_statusBarLength: `${v.advanced?.packagePreset?.statusBarLength}`,
                advanced_workflowPreset_statusBarVisibility: `${v.advanced?.workflowPreset?.statusBarVisibility}`,
                advanced_workflowPreset_statusBarLength: `${v.advanced?.workflowPreset?.statusBarLength}`,
                advanced_kit_statusBarVisibility: `${v.advanced?.kit?.statusBarVisibility}`,
                advanced_kit_statusBarLength: `${v.advanced?.kit?.statusBarLength}`,
                advanced_variant_statusBarVisibility: `${v.advanced?.variant?.statusBarVisibility}`,
                advanced_folder_statusBarVisibility: `${v.advanced?.folder?.statusBarVisibility}`,
                advanced_folder_statusBarLength: `${v.advanced?.folder?.statusBarLength}`,
                advanced_folder_projectStatusVisibility: `${v.advanced?.folder?.projectStatusVisibility}`,
                advanced_buildTarget_statusBarVisibility: `${v.advanced?.buildTarget?.statusBarVisibility}`,
                advanced_buildTarget_statusBarLength: `${v.advanced?.buildTarget?.statusBarLength}`,
                advanced_build_statusBarVisibility: `${v.advanced?.build?.statusBarVisibility}`,
                advanced_build_projectStatusVisibility: `${v.advanced?.build?.projectStatusVisibility}`,
                advanced_launchTarget_statusBarVisibility: `${v.advanced?.launchTarget?.statusBarVisibility}`,
                advanced_launchTarget_statusBarLength: `${v.advanced?.launchTarget?.statusBarLength}`,
                advanced_debug_statusBarVisibility: `${v.advanced?.debug?.statusBarVisibility}`,
                advanced_debug_projectStatusVisibility: `${v.advanced?.debug?.projectStatusVisibility}`,
                advanced_launch_statusBarVisibility: `${v.advanced?.launch?.statusBarVisibility}`,
                advanced_launch_projectStatusVisibility: `${v.advanced?.launch?.projectStatusVisibility}`,
                advanced_ctest_statusBarVisibility: `${v.advanced?.ctest?.statusBarVisibility}`,
                advanced_ctest_statusBarLength: `${v.advanced?.ctest?.statusBarLength}`,
                advanced_ctest_color: `${v.advanced?.ctest?.color}`,
                advanced_ctest_projectStatusVisibility: `${v.advanced?.ctest?.projectStatusVisibility}`,
                advanced_cpack_statusBarVisibility: `${v.advanced?.cpack?.statusBarVisibility}`,
                advanced_cpack_statusBarLength: `${v.advanced?.cpack?.statusBarLength}`,
                advanced_cpack_color: `${v.advanced?.cpack?.color}`,
                advanced_cpack_projectStatusVisibility: `${v.advanced?.cpack?.projectStatusVisibility}`,
                advanced_workflow_statusBarVisibility: `${v.advanced?.workflow?.statusBarVisibility}`,
                advanced_workflow_statusBarLength: `${v.advanced?.workflow?.statusBarLength}`,
                advanced_workflow_color: `${v.advanced?.workflow?.color}`,
                advanced_workflow_projectStatusVisibility: `${v.advanced?.workflow?.projectStatusVisibility}`
            });
        });
        this.workspaceConfig.onChange('additionalCompilerSearchDirs', async _ => {
            KitsController.additionalCompilerSearchDirs = await this.getAdditionalCompilerDirs();
        });
        this.workspaceConfig.onChange('mingwSearchDirs', async _ => { // Deprecated in 1.14, replaced by additionalCompilerSearchDirs, but kept for backwards compatibility
            KitsController.additionalCompilerSearchDirs = await this.getAdditionalCompilerDirs();
        });
        KitsController.additionalCompilerSearchDirs = await this.getAdditionalCompilerDirs();

        let isMultiProject = false;
        if (vscode.workspace.workspaceFolders) {
            await this.projectController.loadAllProjects();
            isMultiProject = this.projectController.hasMultipleProjects;
            await setContextAndStore(multiProjectModeKey, isMultiProject);
            this.projectOutline.addAllCurrentFolders();
            if (this.workspaceConfig.autoSelectActiveFolder && isMultiProject) {
                this.statusBar.setAutoSelectActiveProject(true);
            }
            await this.initActiveProject();
        }
        const isFullyActivated: boolean = this.workspaceHasAtLeastOneProject();
        await enableFullFeatureSet(isFullyActivated);

        const telemetryProperties: telemetry.Properties = {
            isMultiRoot: `${this.projectController.hasMultipleRoots}`,
            hasMultiProject: `${this.projectController.hasMultipleProjectsInOneFolder}`,
            isFullyActivated: `${isFullyActivated}`
        };
        if (isMultiProject) {
            telemetryProperties['autoSelectActiveFolder'] = `${this.workspaceConfig.autoSelectActiveFolder}`;
        }
        telemetry.sendOpenTelemetry(telemetryProperties);

        // do these last
        this.localizedStrings = await util.getExtensionLocalizedPackageJson();
        this.setExtensionActiveCommands();
    }

    public getWorkspaceConfig() {
        return this.workspaceConfig;
    }

    public updateContextValues(key: string, value: string) {
        this.contextValues[key] = value;

        // contextvalues have changed so update active extension commands.
        if (this.extensionActiveCommandsInfo && (!this.extensionActiveCommandsInfo.contextUsed.hasOwnProperty(key) || this.extensionActiveCommandsInfo.contextUsed[key] !== value)) {
            this.setExtensionActiveCommands();
            this.extensionActiveCommandsEmitter.fire();
        }
    }

    public onExtensionActiveCommandsChanged(listener: () => any, thisObject: any | null) {
        this.extensionActiveCommandsEmitter.event(listener, thisObject);
    }

    get extensionActiveCommands(): string[] {
        return this.extensionActiveCommandsInfo ? this.extensionActiveCommandsInfo.extensionActiveCommands : [];
    }

    get extensionLocalizedStrings(): {[key: string]: string} {
        return this.localizedStrings;
    }

    public setExtensionActiveCommands() {
        this.extensionActiveCommandsInfo  = { contextUsed: this.contextValues ? {...this.contextValues} : {}, extensionActiveCommands: this.contextValues ? util.thisExtensionActiveCommands(this.contextValues) : [] } as ExtensionActiveCommandsInfo;
    }

    public showStatusBar(fullFeatureSet: boolean) {
        this.statusBar.setVisible(fullFeatureSet);
    }

    public getStatusBar(): StatusBar {
        return this.statusBar;
    }

    /**
     * Create a new extension manager instance. There must only be one!
     * @param ctx The extension context
     */
    static async create(ctx: vscode.ExtensionContext) {
        const inst = new ExtensionManager(ctx);
        return inst;
    }
    /**
     * The project status view controller
     */
    projectStatus = new ProjectStatus();

    // NOTE: (from sidebar) The project controller manages all the projects in the workspace
    public readonly projectController = new ProjectController(this.extensionContext, this.projectStatus);
    /**
     * The status bar controller
     */
    private readonly statusBar = new StatusBar(this.workspaceConfig);
    // Subscriptions for status bar items:
    private statusMessageSub: vscode.Disposable = new DummyDisposable();
    private targetNameSub: vscode.Disposable = new DummyDisposable();
    private buildTypeSub: vscode.Disposable = new DummyDisposable();
    private launchTargetSub: vscode.Disposable = new DummyDisposable();
    private projectSubscriptions: vscode.Disposable[] = [
        this.targetNameSub,
        this.launchTargetSub
    ];
    private ctestEnabledSub: vscode.Disposable = new DummyDisposable();
    private isBusySub: vscode.Disposable = new DummyDisposable();
    private activeConfigurePresetSub: vscode.Disposable = new DummyDisposable();
    private activeBuildPresetSub: vscode.Disposable = new DummyDisposable();
    private activeTestPresetSub: vscode.Disposable = new DummyDisposable();
    private activePackagePresetSub: vscode.Disposable = new DummyDisposable();
    private activeWorkflowPresetSub: vscode.Disposable = new DummyDisposable();

    // Watch the code model so that we may update the tree view
    // <fspath, sub>
    private readonly codeModelUpdateSubs = new Map<string, vscode.Disposable[]>();

    /**
     * The project outline tree data provider
     */
    private readonly projectOutline = new ProjectOutline();
    private readonly projectOutlineTreeView = vscode.window.createTreeView('cmake.outline', {
        treeDataProvider: this.projectOutline,
        showCollapseAll: true
    });

    /**
     * CppTools project configuration provider. Tells cpptools how to search for
     * includes, preprocessor defs, etc.
     */
    private readonly configProvider = new CppConfigurationProvider();
    private cppToolsAPI?: cpt.CppToolsApi;
    private configProviderRegistered?: boolean = false;

    private getProjectsForWorkspaceFolder(folder?: vscode.WorkspaceFolder): CMakeProject[]  | undefined {
        folder = this.getWorkspaceFolder(folder);
        return this.projectController.getProjectsForWorkspaceFolder(folder);
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
            cmakeProject = this.getActiveProject();
        }
        if (!cmakeProject) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }

        if (cmakeProject.useCMakePresets) {
            if (cmakeProject.configurePreset) {
                return true;
            }
            const didChoosePreset = await this.selectConfigurePreset(cmakeProject.workspaceFolder);
            if (!didChoosePreset && !cmakeProject.configurePreset) {
                return false;
            }
            return !!cmakeProject.configurePreset;
        } else {
            if (cmakeProject.activeKit) {
                // We have an active kit. We're good.
                return true;
            }

            const hascmakelists = await util.globForFileName("CMakeLists.txt", 3, cmakeProject.folderPath);

            // No kit selected? Is enable kit scan on?
            // Or, is this an empty workspace from QuickStart ie: no CMakeLists.txt
            if (!this.workspaceConfig.enableAutomaticKitScan || !hascmakelists) {
                await cmakeProject.kitsController.setKitByName(SpecialKits.Unspecified);
                return true;
            }
            // Ask the user what they want.
            const didChooseKit = await this.selectKit(cmakeProject.workspaceFolder);
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
    private readonly ensureActiveBuildPreset = async (project?: CMakeProject): Promise<boolean> => {
        if (!project) {
            project = this.getActiveProject();
        }
        if (!project) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }
        if (project.useCMakePresets) {
            if (project.buildPreset) {
                return true;
            }
            const didChoosePreset = await this.selectBuildPreset(project.workspaceFolder);
            if (!didChoosePreset && !project.buildPreset) {
                return false;
            }
            return !!project.buildPreset;
        }
        return true;
    };

    private readonly ensureActiveTestPreset = async (project?: CMakeProject): Promise<boolean> => {
        if (!project) {
            project = this.getActiveProject();
        }
        if (!project) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }
        if (project.useCMakePresets) {
            if (project.testPreset) {
                return true;
            }
            const didChoosePreset = await this.selectTestPreset(project.workspaceFolder);
            if (!didChoosePreset && !project.testPreset) {
                return false;
            }
            return !!project.testPreset;
        }
        return true;
    };

    private readonly ensureActivePackagePreset = async (project?: CMakeProject): Promise<boolean> => {
        if (!project) {
            project = this.getActiveProject();
        }
        if (!project) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }
        if (project.useCMakePresets) {
            if (project.packagePreset) {
                return true;
            }
            const didChoosePreset = await this.selectPackagePreset(project.workspaceFolder);
            if (!didChoosePreset && !project.packagePreset) {
                return false;
            }
            return !!project.packagePreset;
        }
        return true;
    };

    private readonly ensureActiveWorkflowPreset = async (project?: CMakeProject): Promise<boolean> => {
        if (!project) {
            project = this.getActiveProject();
        }
        if (!project) {
            // No CMakeProject. Probably no workspace open.
            return false;
        }
        if (project.useCMakePresets) {
            if (project.workflowPreset) {
                return true;
            }
            const didChoosePreset = await this.selectWorkflowPreset(project.workspaceFolder);
            if (!didChoosePreset && !project.workflowPreset) {
                return false;
            }
            return !!project.workflowPreset;
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
        void this.kitsWatcher.close();
        this.projectOutlineTreeView.dispose();
        this.extensionActiveCommandsEmitter.dispose();
        pinnedCommands.dispose();
        if (this.cppToolsAPI) {
            this.cppToolsAPI.dispose();
        }
        if (this.projectStatus) {
            this.projectStatus.dispose();
        }
        await this.projectController.dispose();
        await telemetry.deactivate();
    }

    async configureExtensionInternal(trigger: ConfigureTrigger, project: CMakeProject): Promise<void> {
        if (trigger !== ConfigureTrigger.configureWithCache && !await this.ensureActiveConfigurePresetOrKit(project)) {
            return;
        }

        await project.configureInternal(trigger, [], ConfigureType.Normal);
    }

    async postWorkspaceOpen(project?: CMakeProject) {
        if (!project) {
            return;
        }
        const rootFolder: vscode.WorkspaceFolder = project.workspaceFolder;
        project.addTestExplorerRoot(project.folderPath);
        // Scan for kits even under presets mode, so we can create presets from compilers.
        // Silent re-scan when detecting a breaking change in the kits definition.
        // Do this only for the first folder, to avoid multiple rescans taking place in a multi-root workspace.
        const silentScanForKitsNeeded: boolean = vscode.workspace.workspaceFolders !== undefined &&
            vscode.workspace.workspaceFolders[0] === rootFolder &&
            await scanForKitsIfNeeded(project);

        let shouldConfigure = project?.workspaceContext.config.configureOnOpen;

        const hascmakelists = await util.globForFileName("CMakeLists.txt", 3, project.folderPath);
        if (shouldConfigure === null && !util.isTestMode() && hascmakelists) {
            interface Choice1 {
                title: string;
                doConfigure: boolean;
            }
            const chosen = await vscode.window.showInformationMessage<Choice1>(
                localize('configure.this.project', 'Would you like to configure project {0}?', `"${rootFolder.name}"`),
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
                        const config = vscode.workspace.getConfiguration(undefined, rootFolder.uri);
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
        if (!project.hasCMakeLists()) {
            if (shouldConfigure === true && hascmakelists) {
                await project.cmakePreConditionProblemHandler(CMakePreconditionProblems.MissingCMakeListsFile, false, this.workspaceConfig);
            }
        } else {
            if (shouldConfigure === true) {
                // We've opened a new workspace folder, and the user wants us to
                // configure it now.
                log.debug(localize('configuring.workspace.on.open', 'Configuring workspace on open {0}', project.folderPath));
                await this.configureExtensionInternal(ConfigureTrigger.configureOnOpen, project);
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
                    await this.configureExtensionInternal(ConfigureTrigger.buttonNewKitsDefinition, project);
                } else {
                    log.debug(localize('using.cache.to.configure.workspace.on.open', 'Attempting to use cache to configure workspace {0}', rootFolder.uri.toString()));
                    await this.configureExtensionInternal(ConfigureTrigger.configureWithCache, project);
                }
            }
        }
    }

    private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
        if (this.workspaceConfig.autoSelectActiveFolder && this.projectController.hasMultipleProjects && vscode.workspace.workspaceFolders) {
            let folder: vscode.WorkspaceFolder | undefined;
            if (editor) {
                folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            }
            if (folder) {
                if (!this.activeCMakeWorkspaceFolder() || folder.uri.fsPath !== this.activeFolderPath()) {
                    // active folder changed.
                    await this.updateActiveProject(folder, editor);
                }
            } else if (!folder && !this.activeCMakeWorkspaceFolder() && vscode.workspace.workspaceFolders.length >= 1) {
                await this.updateActiveProject(vscode.workspace.workspaceFolders[0], editor);
            } else if (!folder) {
                // When adding a folder but the focus is on somewhere else
                // Do nothing but make sure we are showing the active folder correctly
                this.statusBar.update();
            }
        }
    }

    /**
     * Show UI to allow the user to select an active project
     */
    async selectActiveFolder(project?: CMakeProject | string[]) {
        let selection: CMakeProject | undefined;
        if (project instanceof CMakeProject) {
            selection = project;
        } else if (Array.isArray(project) && project.length > 0 && typeof project[0] === "string") {
            const projects: CMakeProject[] = this.projectController.getAllCMakeProjects();
            if (projects.length !== 0) {
                selection = projects.find(proj => proj.folderName === project[0]);
            }
        } else if (vscode.workspace.workspaceFolders?.length) {
            selection = await this.pickCMakeProject();
        }

        if (selection) {
            // Ignore if user cancelled
            await this.setActiveProject(selection);
            telemetry.logEvent("selectactivefolder");
            const currentActiveFolderPath = this.activeFolderPath();
            await this.extensionContext.workspaceState.update('activeFolder', currentActiveFolderPath);
        }
    }

    private async initActiveProject(): Promise<CMakeProject | undefined> {
        let folder: vscode.WorkspaceFolder | undefined;
        if (vscode.workspace.workspaceFolders && vscode.window.activeTextEditor && this.workspaceConfig.autoSelectActiveFolder) {
            folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
            await this.updateActiveProject(folder ?? vscode.workspace.workspaceFolders[0], folder ? vscode.window.activeTextEditor : undefined);
            return this.getActiveProject();
        }
        const activeFolder = this.extensionContext.workspaceState.get<string>('activeFolder');
        if (activeFolder) {
            folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(activeFolder));
        }
        if (!folder) {
            folder = vscode.workspace.workspaceFolders![0];
        }
        await this.updateActiveProject(folder, vscode.window.activeTextEditor);
        return this.getActiveProject();
    }

    // Update the active project
    private async updateActiveProject(workspaceFolder?: vscode.WorkspaceFolder, editor?: vscode.TextEditor): Promise<void> {
        await this.projectController.updateActiveProject(workspaceFolder, editor, this.workspaceConfig.options);
        await this.postUpdateActiveProject();
    }

    // Update the active project from the staus bar
    private async setActiveProject(project: CMakeProject): Promise<void> {
        await this.projectController.setActiveProject(project);
        await this.postUpdateActiveProject();
    }

    async updateStatusBarForActiveProjectChange(): Promise<void> {
        await this.postUpdateActiveProject();
    }

    private async postUpdateActiveProject() {
        const activeProject: CMakeProject | undefined = this.getActiveProject();
        if (activeProject) {
            this.statusBar.setActiveProjectName(activeProject.folderName, this.projectController.hasMultipleProjects);
            const useCMakePresets = activeProject?.useCMakePresets || false;
            this.statusBar.useCMakePresets(useCMakePresets);
            if (!useCMakePresets) {
                this.statusBar.setActiveKitName(activeProject.activeKit?.name || '');
            }
            this.projectOutline.setActiveFolder(activeProject.folderPath);
            this.setupSubscriptions();
            this.onActiveProjectChangedEmitter.fire(vscode.Uri.file(activeProject.folderPath));
            const currentActiveFolderPath = this.activeFolderPath();
            await this.extensionContext.workspaceState.update('activeFolder', currentActiveFolderPath);
        }
    }

    private disposeSubs() {
        util.disposeAll(this.projectSubscriptions);
        for (const sub of [this.statusMessageSub, this.targetNameSub, this.buildTypeSub, this.launchTargetSub, this.ctestEnabledSub, this.isBusySub, this.activeConfigurePresetSub, this.activeBuildPresetSub, this.activeTestPresetSub, this.activePackagePresetSub, this.activeWorkflowPresetSub]) {
            sub.dispose();
        }
    }

    private updateCodeModel(cmakeProject?: CMakeProject) {
        if (!cmakeProject) {
            return;
        }
        const folder: vscode.WorkspaceFolder = cmakeProject.workspaceFolder;
        this.projectOutline.updateCodeModel(cmakeProject, cmakeProject.codeModelContent);
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
                const actualBuildType = await cmakeProject.currentBuildType();

                const clCompilerPath = await findCLCompilerPath(configureEnv);
                this.configProvider.cpptoolsVersion = cpptools.getVersion();
                let codeModelContent;
                if (cmakeProject.codeModelContent) {
                    codeModelContent = cmakeProject.codeModelContent;
                    this.configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmakeProject.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmakeProject.folderPath });
                } else if (drv && drv.codeModelContent) {
                    codeModelContent = drv.codeModelContent;
                    this.configProvider.updateConfigurationData({ cache, codeModelContent, clCompilerPath, activeTarget: cmakeProject.defaultBuildTarget, activeBuildTypeVariant: actualBuildType, folder: cmakeProject.folderPath });
                    this.projectOutline.updateCodeModel(cmakeProject, codeModelContent);
                }
                // Inform cpptools that custom CppConfigurationProvider will be able to service the current workspace.
                this.ensureCppToolsProviderRegistered();
                if (this.configProvider.ready) {
                    // TODO: Make this smarter and only notify when there are changes to files that have been requested by cpptools already.
                    cpptools.didChangeCustomBrowseConfiguration(this.configProvider);
                    cpptools.didChangeCustomConfiguration(this.configProvider);
                } else {
                    // we should only initialize and call the cpptools notifyReady if we actually have content.
                    if (codeModelContent) {
                        this.configProvider.markAsReady();
                        if (cpptools.notifyReady) {
                            // Notify cpptools that the provider is ready to provide IntelliSense configurations.
                            cpptools.notifyReady(this.configProvider);
                        } else {
                            cpptools.didChangeCustomBrowseConfiguration(
                                this.configProvider
                            );
                            cpptools.didChangeCustomConfiguration(
                                this.configProvider
                            );
                        }
                    }
                }
            }
        });
    }

    private setupSubscriptions() {
        this.disposeSubs();
        const cmakeProject = this.getActiveProject();
        // Note: No package nor workflow preset info in the status bar
        if (!cmakeProject) {
            this.statusBar.setVisible(false);
            this.statusMessageSub = new DummyDisposable();
            this.targetNameSub = new DummyDisposable();
            this.buildTypeSub = new DummyDisposable();
            this.launchTargetSub = new DummyDisposable();
            this.ctestEnabledSub = new DummyDisposable();
            this.isBusySub = new DummyDisposable();
            this.activeConfigurePresetSub = new DummyDisposable();
            this.activeBuildPresetSub = new DummyDisposable();
            this.activeTestPresetSub = new DummyDisposable();
            this.activePackagePresetSub = new DummyDisposable();
            this.activeWorkflowPresetSub = new DummyDisposable();
            this.statusBar.setActiveKitName('');
            this.statusBar.setConfigurePresetName('');
            this.statusBar.setBuildPresetName('');
            this.statusBar.setTestPresetName('');
            this.statusBar.setPackagePresetName('');
            this.statusBar.setWorkflowPresetName('');
        } else {
            this.statusMessageSub = cmakeProject.onStatusMessageChanged(FireNow, s => this.statusBar.setStatusMessage(s));
            this.targetNameSub = cmakeProject.onTargetNameChanged(FireNow, t => {
                this.statusBar.setBuildTargetName(t);
                this.onBuildTargetChangedEmitter.fire(t);
            });
            this.buildTypeSub = cmakeProject.onActiveVariantNameChanged(FireNow, bt => this.statusBar.setVariantLabel(bt));
            this.launchTargetSub = cmakeProject.onLaunchTargetNameChanged(FireNow, t => {
                this.statusBar.setLaunchTargetName(t || '');
                this.onLaunchTargetChangedEmitter.fire(t || '');
            });
            this.ctestEnabledSub = cmakeProject.onCTestEnabledChanged(FireNow, e => this.statusBar.setCTestEnabled(e));
            this.isBusySub = cmakeProject.onIsBusyChanged(FireNow, b => this.statusBar.setIsBusy(b));
            this.statusBar.setActiveKitName(cmakeProject.activeKit ? cmakeProject.activeKit.name : '');
            this.activeConfigurePresetSub = cmakeProject.onActiveConfigurePresetChanged(FireNow, p => {
                this.statusBar.setConfigurePresetName(p?.displayName || p?.name || '');
                cmakeProject.notifyOnSelectedConfigurationChanged(api.ConfigurationType.ConfigurePreset);
            });
            this.activeBuildPresetSub = cmakeProject.onActiveBuildPresetChanged(FireNow, p => {
                this.statusBar.setBuildPresetName(p?.displayName || p?.name || '');
                cmakeProject.notifyOnSelectedConfigurationChanged(api.ConfigurationType.BuildPreset);
            });
            this.activeTestPresetSub = cmakeProject.onActiveTestPresetChanged(FireNow, p => {
                this.statusBar.setTestPresetName(p?.displayName || p?.name || '');
            });
            this.activePackagePresetSub = cmakeProject.onActivePackagePresetChanged(FireNow, p => {
                this.statusBar.setPackagePresetName(p?.displayName || p?.name || '');
            });
            this.activeWorkflowPresetSub = cmakeProject.onActiveWorkflowPresetChanged(FireNow, p => {
                this.statusBar.setWorkflowPresetName(p?.displayName || p?.name || '');
            });
        }
    }

    /**
     * Watches for changes to the kits file
     */
    private readonly kitsWatcher = util.chokidarOnAnyChange(
        chokidar.watch(USER_KITS_FILEPATH, { ignoreInitial: true }),
        _ => rollbar.takePromise(localize('rereading.kits', 'Re-reading kits'), {}, KitsController.readUserKits(this.getActiveProject())));

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
        await this.getActiveProject()?.presetsController.reapplyPresets();
    }

    async scanForKits() {
        KitsController.additionalCompilerSearchDirs = await this.getAdditionalCompilerDirs();
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length < 1) {
            return;
        }
        const workspaceContext = DirectoryContext.createForDirectory(vscode.workspace.workspaceFolders[0], new StateManager(this.extensionContext, vscode.workspace.workspaceFolders[0]));
        const cmakePath: string = await workspaceContext.getCMakePath() || '';
        const duplicateRemoved = await KitsController.scanForKits(cmakePath);
        if (duplicateRemoved) {
            // Check each project. If there is an active kit set and if it is of the old definition, unset the kit.
            for (const project of this.projectController.getAllCMakeProjects()) {
                const activeKit = project.activeKit;
                if (activeKit) {
                    const definition = activeKit.visualStudio;
                    if (definition && (definition.startsWith("VisualStudio.15") || definition.startsWith("VisualStudio.16"))) {
                        await project.kitsController.setFolderActiveKit(null);
                    }
                }
            }
        }
    }

    /**
     * Get the current additional compiler search directories, like MinGW directories
     */
    private async getAdditionalCompilerDirs(): Promise<string[]> {
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
            projectName: "",
            sourceDir: ""
        };
        const result = new Set<string>();
        for (const dir of this.workspaceConfig.additionalCompilerSearchDirs) {
            const expandedDir: string = util.lightNormalizePath(await expandString(dir, { vars: optsVars }));
            result.add(expandedDir);
        }
        return Array.from(result);
    }

    viewPackageSettings(): void {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@id:cmake.cpackArgs, @id:cmake.cpackEnvironment, @id:cmake.environment');
    }

    /**
    * Show UI to allow the user to select an active kit
    */
    async selectKit(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.kit.in.test.mode', 'Running CMakeTools in test mode. selectKit is disabled.'));
            return false;
        }

        const cmakeProject = this.getProjectsForWorkspaceFolder(folder);
        if (!cmakeProject) {
            return false;
        }

        const activeProject = this.getActiveProject();
        const kitSelected = await activeProject?.kitsController.selectKit();

        let kitSelectionType;
        const activeKit = activeProject?.activeKit;
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
        const projects = folder ? this.projectController.getProjectsForWorkspaceFolder(folder) : this.projectController.getAllCMakeProjects();
        for (const project of projects || []) {
            await project.kitsController.setKitByName(kitName);
        }
        const activeKit = this.getActiveProject()?.activeKit;
        if (activeKit) {
            this.statusBar.setActiveKitName(activeKit.name);
        }
    }

    /**
     * Set the current preset used in the specified folder by name of the preset
     * For backward compatibility, apply preset to all folders if folder is undefined
     */
    async setConfigurePreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            if (!this.useCMakePresets(folder)) {
                log.info(localize('skip.set.config.preset', 'Using kits, skip setting configure preset: {0}', presetName));
                return;
            }
            await this.getActiveProject()?.presetsController.setConfigurePreset(presetName);
        } else {
            for (const project of this.projectController.getAllCMakeProjects()) {
                if (!project.useCMakePresets) {
                    log.info(localize('skip.set.config.preset', 'Using kits, skip setting configure preset: {0}', presetName));
                    return;
                }
                await project.presetsController.setConfigurePreset(presetName);
            }
        }
    }

    async setBuildPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            if (!this.useCMakePresets(folder)) {
                log.info(localize('skip.set.build.preset', 'Using kits, skip setting build preset: {0}', presetName));
                return;
            }
            await this.getActiveProject()?.presetsController.setBuildPreset(presetName);
        } else {
            for (const project of this.projectController.getAllCMakeProjects()) {
                if (!project.useCMakePresets) {
                    log.info(localize('skip.set.build.preset', 'Using kits, skip setting build preset: {0}', presetName));
                    return;
                }
                await project.presetsController.setBuildPreset(presetName);
            }
        }
    }

    async setTestPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            if (!this.useCMakePresets(folder)) {
                log.info(localize('skip.set.test.preset', 'Using kits, skip setting test preset: {0}', presetName));
                return;
            }
            await this.getActiveProject()?.presetsController.setTestPreset(presetName);
        } else {
            for (const project of this.projectController.getAllCMakeProjects()) {
                if (!project.useCMakePresets) {
                    log.info(localize('skip.set.test.preset', 'Using kits, skip setting test preset: {0}', presetName));
                    return;
                }
                await project.presetsController.setTestPreset(presetName);
            }
        }
    }

    async setPackagePreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            if (!this.useCMakePresets(folder)) {
                log.info(localize('skip.set.package.preset', 'Using kits, skip setting package preset: {0}', presetName));
                return;
            }
            await this.getActiveProject()?.presetsController.setPackagePreset(presetName);
        } else {
            for (const project of this.projectController.getAllCMakeProjects()) {
                if (!project.useCMakePresets) {
                    log.info(localize('skip.set.package.preset', 'Using kits, skip setting package preset: {0}', presetName));
                    return;
                }
                await project.presetsController.setPackagePreset(presetName);
            }
        }
    }

    async setWorkflowPreset(presetName: string, folder?: vscode.WorkspaceFolder) {
        if (folder) {
            if (!this.useCMakePresets(folder)) {
                log.info(localize('skip.set.workflow.preset', 'Using kits, skip setting workflow preset: {0}', presetName));
                return;
            }
            await this.getActiveProject()?.presetsController.setWorkflowPreset(presetName);
        } else {
            for (const project of this.projectController.getAllCMakeProjects()) {
                if (!project.useCMakePresets) {
                    log.info(localize('skip.set.workflow.preset', 'Using kits, skip setting workflow preset: {0}', presetName));
                    return;
                }
                await project.presetsController.setWorkflowPreset(presetName);
            }
        }
    }

    useCMakePresets(folder: vscode.WorkspaceFolder): boolean {
        return this.projectController.useCMakePresetsForFolder(folder);
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

    cleanOutputChannel() {
        if (this.workspaceConfig.clearOutputBeforeBuild) {
            log.clearOutputChannel();
        }
    }

    // The below functions are all wrappers around the backend.
    async runCMakeCommandForProject(command: RunCMakeCommand,
        cmakeProject = this.getActiveProject(),
        precheck?: (cmakeProject: CMakeProject) => Promise<boolean>): Promise<any> {
        if (!cmakeProject) {
            rollbar.error(localize('no.active.cmake.project', 'No active CMake project.'));
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
        const projects = this.projectController.getAllCMakeProjects();
        for (const project of projects) {
            if (!await this.ensureActiveConfigurePresetOrKit(project)) {
                return -1;
            }
            if (precheck && !await precheck(project)) {
                return -100;
            }

            const retc = await command(project);
            if (retc) {
                return retc;
            }
        }
        // Succeeded
        return 0;
    }

    private getProjectFromFolder(folder?: vscode.WorkspaceFolder | string, sourceDir?: string) {
        const workspaceFolder: vscode.WorkspaceFolder | undefined = this.getWorkspaceFolder(folder);
        if (workspaceFolder) {
            const activeProject: CMakeProject | undefined = this.getActiveProject();
            const projects: CMakeProject[] | undefined = this.projectController.getProjectsForWorkspaceFolder(workspaceFolder);
            if (!projects || projects.length === 0) {
                return activeProject;
            } else {
                // Choose project by corresponding source directory
                return projects.find(project => sourceDir && (path.normalize(sourceDir) === path.normalize(project.folderPath)))
                    // Choose project by folder of active project
                    ?? projects.find(project => activeProject?.folderPath === project.folderPath)
                    // Fallback to first project
                    ?? projects[0];
            }
        }
        return undefined;
    }

    runCMakeCommand(command: RunCMakeCommand, folder?: vscode.WorkspaceFolder, precheck?: (cmakeProject: CMakeProject) => Promise<boolean>, cleanOutputChannel?: boolean, sourceDir?: string): Promise<any> {
        if (cleanOutputChannel) {
            this.cleanOutputChannel();
        }
        const project = this.getProjectFromFolder(folder, sourceDir);
        if (project) {
            return this.runCMakeCommandForProject(command, project, precheck);
        }

        rollbar.error(localize('invalid.folder', 'Invalid folder.'));
        return this.runCMakeCommandForProject(command, project, precheck);
    }

    queryCMakeProject(query: QueryCMakeProject, folder?: vscode.WorkspaceFolder | string) {
        const project = this.getProjectFromFolder(folder);
        if (project) {
            return query(project);
        }

        rollbar.error(localize('invalid.folder', 'Invalid folder.'));
        return Promise.resolve(null);
    }

    cleanConfigure(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("deleteCacheAndReconfigure");
        return this.runCMakeCommand(cmakeProject => cmakeProject.cleanConfigure(ConfigureTrigger.commandCleanConfigure), folder, undefined, true);
    }

    cleanConfigureWithDebugger(folder?: vscode.WorkspaceFolder) {
        return vscode.debug.startDebugging(undefined, {
            name: localize("cmake.debug.name", "CMake Debugger"),
            request: "launch",
            type: "cmake",
            cmakeDebugType: "configure",
            pipeName: getDebuggerPipeName()
        });
    }

    cleanConfigureWithDebuggerInternal(debuggerInformation: DebuggerInformation, folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("deleteCacheAndReconfigureWithDebugger");
        return this.runCMakeCommand(cmakeProject => cmakeProject.cleanConfigureWithDebugger(ConfigureTrigger.commandCleanConfigureWithDebugger, debuggerInformation), folder, undefined, true);
    }

    cleanConfigureAll() {
        telemetry.logEvent("deleteCacheAndReconfigure");
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.cleanConfigure(ConfigureTrigger.commandCleanConfigureAll), undefined, true);
    }

    cleanConfigureAllWithDebugger(trigger?: ConfigureTrigger) {
        return vscode.debug.startDebugging(undefined, {
            name: localize("cmake.debug.name", "CMake Debugger"),
            request: "launch",
            type: "cmake",
            cmakeDebugType: "configure",
            pipeName: getDebuggerPipeName(),
            trigger
        });
    }

    cleanConfigureAllWithDebuggerInternal(debuggerInformation: DebuggerInformation, trigger?: ConfigureTrigger) {
        telemetry.logEvent("deleteCacheAndReconfigureWithDebugger");
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.cleanConfigureWithDebugger(trigger ?? ConfigureTrigger.commandCleanConfigureAllWithDebugger, debuggerInformation), undefined, true);
    }

    configure(folder?: vscode.WorkspaceFolder, showCommandOnly?: boolean, sourceDir?: string) {
        return this.runCMakeCommand(
            async cmakeProject => (await cmakeProject.configureInternal(ConfigureTrigger.commandConfigure, [], showCommandOnly ? ConfigureType.ShowCommandOnly : ConfigureType.Normal)).result,
            folder, undefined, true, sourceDir);
    }

    configureWithDebugger(folder?: vscode.WorkspaceFolder, sourceDir?: string, trigger?: ConfigureTrigger) {
        return vscode.debug.startDebugging(undefined, {
            name: localize("cmake.debug.name", "CMake Debugger"),
            request: "launch",
            type: "cmake",
            cmakeDebugType: "configure",
            pipeName: getDebuggerPipeName(),
            folder,
            sourceDir,
            trigger
        });
    }

    configureWithDebuggerInternal(debuggerInformation: DebuggerInformation, folder?: vscode.WorkspaceFolder, showCommandOnly?: boolean, sourceDir?: string, trigger?: ConfigureTrigger) {
        return this.runCMakeCommand(
            async cmakeProject => (await cmakeProject.configureInternal(trigger ?? ConfigureTrigger.commandConfigureWithDebugger, [], showCommandOnly ? ConfigureType.ShowCommandOnly : ConfigureType.NormalWithDebugger, debuggerInformation)).result,
            folder, undefined, true, sourceDir);
    }

    showConfigureCommand(folder?: vscode.WorkspaceFolder) {
        return this.configure(folder, true, undefined);
    }

    configureAll() {
        return this.runCMakeCommandForAll(async cmakeProject => ((await cmakeProject.configureInternal(ConfigureTrigger.commandCleanConfigureAll, [], ConfigureType.Normal)).result), undefined, true);
    }

    configureAllWithDebugger(trigger?: ConfigureTrigger) {
        return vscode.debug.startDebugging(undefined, {
            name: localize("cmake.debug.name", "CMake Debugger"),
            request: "launch",
            type: "cmake",
            cmakeDebugType: "configure",
            pipeName: getDebuggerPipeName()
        });
    }

    configureAllWithDebuggerInternal(debuggerInformation: DebuggerInformation, trigger?: ConfigureTrigger) {
        // I need to add ConfigureTriggers that account for coming from the project status view or project outline.
        return this.runCMakeCommandForAll(async cmakeProject => (await cmakeProject.configureInternal(trigger ?? ConfigureTrigger.commandConfigureAllWithDebugger, [], ConfigureType.NormalWithDebugger, debuggerInformation)).result, undefined, true);
    }

    editCacheUI() {
        telemetry.logEvent("editCMakeCache", { command: "editCMakeCacheUI" });
        return this.runCMakeCommand(cmakeProject => cmakeProject.editCacheUI());
    }

    build(folder?: vscode.WorkspaceFolder, name?: string, sourceDir?: string, showCommandOnly?: boolean, isBuildCommand?: boolean) {
        telemetry.logEvent("build", { all: "false"});
        return this.runCMakeCommand(cmakeProject => {
            const targets = name ? [name] : undefined;
            return cmakeProject.build(targets, showCommandOnly, (isBuildCommand === undefined) ? true : isBuildCommand);
        },
        folder,
        this.ensureActiveBuildPreset,
        true,
        sourceDir);
    }

    showBuildCommand(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.build(folder, name, undefined, true, false);
    }

    buildAll(name?: string | string[]) {
        telemetry.logEvent("build", { all: "true"});
        return this.runCMakeCommandForAll(cmakeProject => {
            const targets = util.isArrayOfString(name) ? name : util.isString(name) ? [name] : undefined;
            return cmakeProject.build(targets);
        },
        this.ensureActiveBuildPreset,
        true);
    }

    setDefaultTarget(folder?: vscode.WorkspaceFolder, name?: string, sourceDir?: string) {
        return this.runCMakeCommand(cmakeProject => cmakeProject.setDefaultTarget(name), folder, undefined, undefined, sourceDir);
    }

    setVariant(folder?: vscode.WorkspaceFolder, name?: string) {
        return this.runCMakeCommand(cmakeProject => cmakeProject.setVariant(name), folder);
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
        telemetry.logEvent("install", { all: "false"});
        return this.runCMakeCommand(cmakeProject => cmakeProject.install(), folder, undefined, true);
    }

    installAll() {
        telemetry.logEvent("install", { all: "true"});
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.install(), undefined, true);
    }

    editCache(folder: vscode.WorkspaceFolder) {
        telemetry.logEvent("editCMakeCache", { command: "editCMakeCache" });
        return this.runCMakeCommand(cmakeProject => cmakeProject.editCache(), folder);
    }

    clean(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("clean", { all: "false"});
        return this.build(folder, 'clean', undefined, undefined, false);
    }

    cleanAll() {
        telemetry.logEvent("clean", { all: "true"});
        return this.buildAll(['clean']);
    }

    cleanRebuild(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("cleanRebuild", { all: "false"});
        return this.runCMakeCommand(cmakeProject => cmakeProject.cleanRebuild(), folder, this.ensureActiveBuildPreset, true);
    }

    cleanRebuildAll() {
        telemetry.logEvent("cleanRebuild", { all: "true"});
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.cleanRebuild(), this.ensureActiveBuildPreset, true);
    }

    async buildWithTarget() {
        telemetry.logEvent("build", { command: "buildWithTarget", all: "false"});
        this.cleanOutputChannel();
        let activeProject: CMakeProject | undefined = this.getActiveProject();
        if (!activeProject) {
            activeProject = await this.pickCMakeProject();
            if (!activeProject) {
                return; // Error or nothing is opened
            }
        } else {
            return activeProject.buildWithTarget();
        }
    }

    private async pickCMakeProject(): Promise<CMakeProject | undefined> {
        const projects: CMakeProject[] = this.projectController.getAllCMakeProjects();
        if (projects.length === 0) {
            return undefined;
        }
        interface ProjectItem extends vscode.QuickPickItem {
            cmakeProject: CMakeProject;
        }
        const items = projects.map(project => {
            const item: ProjectItem = {
                label: project.folderName,
                cmakeProject: project,
                description: project.folderPath
            };
            return item;
        });
        const selection = await vscode.window.showQuickPick(items, { placeHolder: localize('select.a.cmake.project', 'Select a cmake project') });
        if (selection) {
            console.assert(selection.cmakeProject.folderName, 'Project not found in project controller.');
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
        for (const project of this.projectController.getAllCMakeProjects()) {
            const term = await project.tryCompileFile(file);
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
        await this.updateActiveProject(folder);
    }

    ctest(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("runTests", { all: "false"});
        return this.runCMakeCommand(cmakeProject => cmakeProject.ctest(), folder, this.ensureActiveTestPreset);
    }

    ctestAll() {
        telemetry.logEvent("runTests", { all: "true"});
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.ctest(), this.ensureActiveTestPreset);
    }

    cpack(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("runCPack", { all: "false"});
        return this.runCMakeCommand(cmakeProject => cmakeProject.cpack(), folder, this.ensureActivePackagePreset);
    }

    cpackAll() {
        telemetry.logEvent("runCPack", { all: "true"});
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.cpack(), this.ensureActivePackagePreset);
    }

    workflow(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("runWorkflow", { all: "false"});
        return this.runCMakeCommand(cmakeProject => cmakeProject.workflow(), folder, this.ensureActiveWorkflowPreset);
    }

    workflowAll() {
        telemetry.logEvent("runWorkflow", { all: "true"});
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.workflow(), this.ensureActiveWorkflowPreset);
    }

    revealTestExplorer(folder?: vscode.WorkspaceFolder) {
        return this.runCMakeCommand(cmakeProject => cmakeProject.revealTestExplorer(), folder, this.ensureActiveTestPreset);
    }

    refreshTests(folder?: vscode.WorkspaceFolder) {
        return this.runCMakeCommand(cmakeProject => cmakeProject.refreshTests(), folder);
    }

    refreshTestsAll() {
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.refreshTests());
    }

    stop(folder?: vscode.WorkspaceFolder) {
        return this.runCMakeCommand(cmakeProject => cmakeProject.stop(), folder);
    }

    stopAll() {
        return this.runCMakeCommandForAll(cmakeProject => cmakeProject.stop());
    }

    quickStart(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("quickStart");
        return this.runCMakeCommandForProject(cmakeProject => cmakeProject.quickStart(folder));
    }

    resolveFolderTargetNameArgs(args?: FolderTargetNameArgsType): [ folder?: vscode.WorkspaceFolder | string, targetName?: string ] {
        let folder: vscode.WorkspaceFolder | string | undefined;
        let targetName: string | undefined;

        if (args === undefined) {
            folder = undefined;
            targetName = undefined;
        } else if (util.isString(args) || util.isWorkspaceFolder(args)) {
            folder = args;
            targetName = undefined;
        } else {
            folder = args.folder;
            targetName = args.targetName;
        }

        return [ folder, targetName ];
    }

    launchTargetPath(args?: FolderTargetNameArgsType) {
        const [folder, targetName] = this.resolveFolderTargetNameArgs(args);

        telemetry.logEvent("substitution", { command: "launchTargetPath" });
        return this.queryCMakeProject(async cmakeProject => {
            if (targetName !== undefined && targetName !== null) {
                await cmakeProject.setLaunchTargetByName(targetName);
            }
            const targetPath = await cmakeProject.launchTargetPath();
            return targetPath;
        }, folder);
    }

    launchTargetDirectory(args?: FolderTargetNameArgsType) {
        const [folder, targetName] = this.resolveFolderTargetNameArgs(args);

        telemetry.logEvent("substitution", { command: "launchTargetDirectory" });
        return this.queryCMakeProject(async cmakeProject => {
            if (targetName !== undefined && targetName !== null) {
                await cmakeProject.setLaunchTargetByName(targetName);
            }
            const targetDirectory = await cmakeProject.launchTargetDirectory();
            return targetDirectory;
        }, folder);
    }

    launchTargetFilename(args?: FolderTargetNameArgsType) {
        const [folder, targetName] = this.resolveFolderTargetNameArgs(args);

        telemetry.logEvent("substitution", { command: "launchTargetFilename" });
        return this.queryCMakeProject(async cmakeProject => {
            if (targetName !== undefined && targetName !== null) {
                await cmakeProject.setLaunchTargetByName(targetName);
            }
            const targetFilename = await cmakeProject.launchTargetFilename();
            return targetFilename;
        }, folder);
    }

    getLaunchTargetPath(args?: FolderTargetNameArgsType) {
        const [folder, targetName] = this.resolveFolderTargetNameArgs(args);

        telemetry.logEvent("substitution", { command: "getLaunchTargetPath" });
        return this.queryCMakeProject(async cmakeProject => {
            if (targetName !== undefined && targetName !== null) {
                await cmakeProject.setLaunchTargetByName(targetName);
            }
            const targetPath = await cmakeProject.getLaunchTargetPath();
            return targetPath;
        }, folder);
    }

    getLaunchTargetDirectory(args?: FolderTargetNameArgsType) {
        const [folder, targetName] = this.resolveFolderTargetNameArgs(args);

        telemetry.logEvent("substitution", { command: "getLaunchTargetDirectory" });
        return this.queryCMakeProject(async cmakeProject => {
            if (targetName !== undefined && targetName !== null) {
                await cmakeProject.setLaunchTargetByName(targetName);
            }
            const targetDirectory = await cmakeProject.getLaunchTargetDirectory();
            return targetDirectory;
        }, folder);
    }

    getLaunchTargetFilename(args?: FolderTargetNameArgsType) {
        const [folder, targetName] = this.resolveFolderTargetNameArgs(args);

        telemetry.logEvent("substitution", { command: "getLaunchTargetFilename" });
        return this.queryCMakeProject(async cmakeProject => {
            if (targetName !== undefined && targetName !== null) {
                await cmakeProject.setLaunchTargetByName(targetName);
            }
            const targetFilename = await cmakeProject.getLaunchTargetFilename();
            return targetFilename;
        }, folder);
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

    debugTarget(folder?: vscode.WorkspaceFolder, name?: string, sourceDir?: string): Promise<vscode.DebugSession | null> {
        telemetry.logEvent("debug", { all: "false" });
        return this.runCMakeCommand(cmakeProject => cmakeProject.debugTarget(name), folder, undefined, true, sourceDir);
    }

    async debugTargetAll(): Promise<(vscode.DebugSession | null)[]> {
        telemetry.logEvent("debug", { all: "true" });
        const debugSessions: (vscode.DebugSession | null)[] = [];
        for (const cmakeProject of this.projectController.getAllCMakeProjects()) {
            debugSessions.push(await this.runCMakeCommandForProject(cmakeProject => cmakeProject.debugTarget(), cmakeProject));
        }
        return debugSessions;
    }

    launchTarget(folder?: vscode.WorkspaceFolder, name?: string, sourceDir?: string): Promise<vscode.Terminal | null> {
        telemetry.logEvent("launch", { all: "false" });
        return this.runCMakeCommand(cmakeProject => cmakeProject.launchTarget(name), folder, undefined, true, sourceDir);
    }

    async launchTargetAll(): Promise<(vscode.Terminal | null)[]> {
        telemetry.logEvent("launch", { all: "true" });
        const terminals: (vscode.Terminal | null)[] = [];
        for (const cmakeProject of this.projectController.getAllCMakeProjects()) {
            terminals.push(await this.runCMakeCommandForProject(cmakeProject => cmakeProject.launchTarget(), cmakeProject));
        }
        return terminals;
    }

    selectLaunchTarget(folder?: vscode.WorkspaceFolder, name?: string, sourceDir?: string) {
        return this.runCMakeCommand(cmakeProject => cmakeProject.selectLaunchTarget(name), folder, undefined, undefined, sourceDir);
    }

    async resetState(folder?: vscode.WorkspaceFolder) {
        telemetry.logEvent("resetExtension");
        if (folder) {
            await this.runCMakeCommand(cmakeProject => cmakeProject.resetState(), folder);
        } else {
            await this.runCMakeCommandForAll(cmakeProject => cmakeProject.resetState());
        }

        void vscode.commands.executeCommand('workbench.action.reloadWindow');
    }

    openSettings() {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms-vscode.cmake-tools');
    }

    async viewLog() {
        telemetry.logEvent("openLogFile");
        await logging.showLogFile();
    }

    async logDiagnostics() {
        telemetry.logEvent("logDiagnostics");
        const configurations: DiagnosticsConfiguration[] = [];
        const settings: DiagnosticsSettings[] = [];
        for (const project of this.projectController.getAllCMakeProjects()) {
            configurations.push(await project.getDiagnostics());
            settings.push(await project.getSettingsDiagnostics());
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
        return this.getActiveProject()?.workspaceFolder;
    }

    activeFolderName(): string {
        return this.projectController.activeFolderName || '';
    }

    activeFolderPath(): string {
        return this.projectController.activeFolderPath || '';
    }

    public getActiveProject(): CMakeProject | undefined {
        return this.projectController.getActiveCMakeProject();
    }

    async hideLaunchCommand(shouldHide: boolean = true) {
        // Don't hide command selectLaunchTarget here since the target can still be useful, one example is ${command:cmake.launchTargetPath} in launch.json
        // await this.projectController.hideLaunchButton(shouldHide);
        this.statusBar.hideLaunchButton(shouldHide);
        await this.projectStatus.hideLaunchButton(shouldHide);
        await setContextAndStore(hideLaunchCommandKey, shouldHide);
    }

    async hideDebugCommand(shouldHide: boolean = true) {
        // Don't hide command selectLaunchTarget here since the target can still be useful, one example is ${command:cmake.launchTargetPath} in launch.json
        // await this.projectController.hideDebugButton(shouldHide);
        this.statusBar.hideDebugButton(shouldHide);
        await this.projectStatus.hideDebugButton(shouldHide);
        await setContextAndStore(hideDebugCommandKey, shouldHide);
    }

    async hideBuildCommand(shouldHide: boolean = true) {
        // await this.projectController.hideBuildButton(shouldHide);
        this.statusBar.hideBuildButton(shouldHide);
        await this.projectStatus.hideBuildButton(shouldHide);
        await setContextAndStore(hideBuildCommandKey, shouldHide);
    }

    // Answers whether the workspace contains at least one project folder that is CMake based,
    // without recalculating the valid states of CMakeLists.txt.
    workspaceHasAtLeastOneProject(): boolean {
        const projects: CMakeProject[] | undefined = this.projectController.getAllCMakeProjects();
        if (!projects || projects.length === 0) {
            return false;
        }
        return projects.some(project => project.hasCMakeLists());
    }

    activeConfigurePresetName(): string {
        telemetry.logEvent("substitution", { command: "activeConfigurePresetName" });
        return this.getActiveProject()?.configurePreset?.name || '';
    }

    activeBuildPresetName(): string {
        telemetry.logEvent("substitution", { command: "activeBuildPresetName" });
        return this.getActiveProject()?.buildPreset?.name || '';
    }

    activeTestPresetName(): string {
        telemetry.logEvent("substitution", { command: "activeTestPresetName" });
        return this.getActiveProject()?.testPreset?.name || '';
    }

    activePackagePresetName(): string {
        telemetry.logEvent("substitution", { command: "activePackagePresetName" });
        return this.getActiveProject()?.packagePreset?.name || '';
    }

    activeWorkflowPresetName(): string {
        telemetry.logEvent("substitution", { command: "activeWorkflowPresetName" });
        return this.getActiveProject()?.workflowPreset?.name || '';
    }

    /**
     * Opens CMakePresets.json at the root of the project. Creates one if it does not exist.
     */
    async openCMakePresets(): Promise<void> {
        await this.getActiveProject()?.presetsController.openCMakePresets();
    }

    /**
     * Appends the build directory of the active project to the current workspace
     */
    async appendBuildDirectoryToWorkspace() {
        await this.getActiveProject()?.appendBuildDirectoryToWorkspace();
    }

    /**
     * Show UI to allow the user to add an active configure preset
     */
    async addConfigurePreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.config.preset.in.test.mode', 'Running CMakeTools in test mode. addConfigurePreset is disabled.'));
            return false;
        }

        const cmakeProject = this.getProjectFromFolder(folder);
        if (!cmakeProject) {
            return false;
        }

        return cmakeProject.presetsController.addConfigurePreset();
    }

    /**
     * Show UI to allow the user to add an active build preset
     */
    async addBuildPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.build.preset.in.test.mode', 'Running CMakeTools in test mode. addBuildPreset is disabled.'));
            return false;
        }

        const cmakeProject = this.getProjectFromFolder(folder);
        if (!cmakeProject) {
            return false;
        }

        return cmakeProject.presetsController.addBuildPreset();
    }

    /**
     * Show UI to allow the user to add an active test preset
     */
    async addTestPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.test.preset.in.test.mode', 'Running CMakeTools in test mode. addTestPreset is disabled.'));
            return false;
        }

        const cmakeProject = this.getProjectFromFolder(folder);
        if (!cmakeProject) {
            return false;
        }

        return cmakeProject.presetsController.addTestPreset();
    }

    /**
     * Show UI to allow the user to add an active package preset
     */
    async addPackagePreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.package.preset.in.test.mode', 'Running CMakeTools in test mode. addPackagePreset is disabled.'));
            return false;
        }

        const cmakeProject = this.getProjectFromFolder(folder);
        if (!cmakeProject) {
            return false;
        }

        return cmakeProject.presetsController.addPackagePreset();
    }

    /**
     * Show UI to allow the user to add an active test preset
     */
    async addWorkflowPreset(folder: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('add.workflow.preset.in.test.mode', 'Running CMakeTools in test mode. addWorkflowPreset is disabled.'));
            return false;
        }

        const cmakeProject = this.getProjectFromFolder(folder);
        if (!cmakeProject) {
            return false;
        }

        return cmakeProject.presetsController.addWorkflowPreset();
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

        const project = this.getProjectFromFolder(folder);
        if (!project) {
            return false;
        }

        if (!project.useCMakePresets) {
            log.info(localize('skip.set.configure.preset', 'Using kits, skip selecting configure preset'));
            return false;
        }

        const presetSelected = await project.presetsController.selectConfigurePreset();
        const configurePreset = project.configurePreset;
        this.statusBar.setConfigurePresetName(configurePreset?.displayName || configurePreset?.name || '');

        // Reset build and test presets since they might not be used with the selected configure preset
        const buildPreset = project.buildPreset;
        this.statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');
        const testPreset = project.testPreset;
        this.statusBar.setTestPresetName(testPreset?.displayName || testPreset?.name || '');
        return presetSelected;
    }

    viewConfigureSettings(): void {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@id:cmake.configureArgs, @id:cmake.configureEnvironment, @id:cmake.environment');
    }

    /**
     * Show UI to allow the user to select an active build preset
     */
    async selectBuildPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.build.preset.in.test.mode', 'Running CMakeTools in test mode. selectBuildPreset is disabled.'));
            return false;
        }

        const project = this.getProjectFromFolder(folder);
        if (!project) {
            return false;
        }

        if (!project.useCMakePresets) {
            log.info(localize('skip.set.build.preset', 'Using kits, skip selecting build preset'));
            return false;
        }

        const presetSelected = await project.presetsController.selectBuildPreset();
        const buildPreset = project.buildPreset;
        this.statusBar.setBuildPresetName(buildPreset?.displayName || buildPreset?.name || '');
        return presetSelected;
    }

    viewBuildSettings(): void {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@id:cmake.buildArgs, @id:cmake.buildToolArgs @id:cmake.buildEnvironment @id:cmake.environment');
    }

    /**
     * Show UI to allow the user to select an active test preset
     */
    async selectTestPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.test.preset.in.test.mode', 'Running CMakeTools in test mode. selectTestPreset is disabled.'));
            return false;
        }

        const project = this.getProjectFromFolder(folder);
        if (!project) {
            return false;
        }

        if (!project.useCMakePresets) {
            log.info(localize('skip.set.test.preset', 'Using kits, skip selecting test preset'));
            return false;
        }

        const presetSelected = await project.presetsController.selectTestPreset();
        const testPreset = project.testPreset;
        this.statusBar.setTestPresetName(testPreset?.displayName || testPreset?.name || '');
        return presetSelected;
    }

    viewTestSettings(): void {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@id:cmake.ctestArgs, @id:cmake.testEnvironment, @id:cmake.environment');
    }

    /**
     * Show UI to allow the user to select an active package preset
     */
    async selectPackagePreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.package.preset.in.test.mode', 'Running CMakeTools in test mode. selectPackagePreset is disabled.'));
            return false;
        }

        const project = this.getProjectFromFolder(folder);
        if (!project) {
            return false;
        }

        if (!project.useCMakePresets) {
            log.info(localize('skip.set.package.preset', 'Using kits, skip selecting package preset'));
            return false;
        }

        const presetSelected = await project.presetsController.selectPackagePreset();
        const packagePreset = project.packagePreset;
        this.statusBar.setPackagePresetName(packagePreset?.displayName || packagePreset?.name || '');
        return presetSelected;
    }

    /**
     * Show UI to allow the user to select an active workflow preset
     */
    async selectWorkflowPreset(folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (util.isTestMode()) {
            log.trace(localize('selecting.workflow.preset.in.test.mode', 'Running CMakeTools in test mode. selectWorkflowPreset is disabled.'));
            return false;
        }

        const project = this.getProjectFromFolder(folder);
        if (!project) {
            return false;
        }

        if (!project.useCMakePresets) {
            log.info(localize('skip.set.workflow.preset', 'Using kits, skip selecting workflow preset'));
            return false;
        }

        const presetSelected = await project.presetsController.selectWorkflowPreset();
        const workflowPreset = project.workflowPreset;
        this.statusBar.setWorkflowPresetName(workflowPreset?.displayName || workflowPreset?.name || '');
        return presetSelected;
    }

    public api: CMakeToolsApiImpl;

    get onBuildTargetChanged() {
        return this.onBuildTargetChangedEmitter.event;
    }
    private readonly onBuildTargetChangedEmitter = new vscode.EventEmitter<string>();

    get onLaunchTargetChanged() {
        return this.onLaunchTargetChangedEmitter.event;
    }
    private readonly onLaunchTargetChangedEmitter = new vscode.EventEmitter<string>();

    get onActiveProjectChanged() {
        return this.onActiveProjectChangedEmitter.event;
    }
    private readonly onActiveProjectChangedEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();
}

async function setup(context: vscode.ExtensionContext, progress?: ProgressHandle): Promise<api.CMakeToolsExtensionExports> {
    reportProgress(localize('initial.setup', 'Initial setup'), progress);
    const ext = extensionManager!;
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

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            "cmake",
            new DebugAdapterNamedPipeServerDescriptorFactory()
        )
    );

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("cmake", new DebugConfigurationProvider()));
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(
            "cmake",
            new DynamicDebugConfigurationProvider(),
            vscode.DebugConfigurationProviderTriggerKind.Dynamic)
    );

    // List of functions that will be bound commands
    const funs: (keyof ExtensionManager)[] = [
        'activeFolderName',
        'activeFolderPath',
        'activeConfigurePresetName',
        'activeBuildPresetName',
        'activeTestPresetName',
        'activePackagePresetName',
        'activeWorkflowPresetName',
        "useCMakePresets",
        "openCMakePresets",
        "appendBuildDirectoryToWorkspace",
        'addConfigurePreset',
        'addBuildPreset',
        'addTestPreset',
        'addPackagePreset',
        'addWorkflowPreset',
        'selectConfigurePreset',
        'viewConfigureSettings',
        'selectBuildPreset',
        'viewBuildSettings',
        'selectTestPreset',
        'viewTestSettings',
        'selectPackagePreset',
        'viewPackageSettings',
        'selectWorkflowPreset',
        'selectActiveFolder',
        'editKits',
        'scanForKits',
        'scanForCompilers',
        'selectKit',
        'setKitByName',
        'setConfigurePreset',
        'setBuildPreset',
        'setTestPreset',
        'setPackagePreset',
        'setWorkflowPreset',
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
        'cleanConfigureWithDebugger',
        'cleanConfigureAll',
        'cleanConfigureAllWithDebugger',
        'cleanRebuild',
        'cleanRebuildAll',
        'configure',
        'configureWithDebugger',
        'showConfigureCommand',
        'configureAll',
        'configureAllWithDebugger',
        'editCacheUI',
        'ctest',
        'ctestAll',
        'cpack',
        'cpackAll',
        'workflow',
        'workflowAll',
        'revealTestExplorer',
        'refreshTests',
        'refreshTestsAll',
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
        'openSettings',
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

    context.subscriptions.push(...[
        // Special commands that don't require logging or separate error handling
        vscode.commands.registerCommand('cmake.outline.configureAll', () => runCommand('configureAll')),
        // add parameters that give a more specific configureTrigger
        vscode.commands.registerCommand('cmake.outline.configureAllWithDebugger', () => runCommand('configureAllWithDebugger', ConfigureTrigger.projectOutlineConfigureAllWithDebugger)),
        vscode.commands.registerCommand('cmake.outline.buildAll', () => runCommand('buildAll')),
        vscode.commands.registerCommand('cmake.outline.stopAll', () => runCommand('stopAll')),
        vscode.commands.registerCommand('cmake.outline.cleanAll', () => runCommand('cleanAll')),
        vscode.commands.registerCommand('cmake.outline.cleanConfigureAll', () => runCommand('cleanConfigureAll')),
        vscode.commands.registerCommand('cmake.outline.cleanConfigureAllWithDebugger', () => runCommand('cleanConfigureAllWithDebugger', ConfigureTrigger.projectOutlineCleanConfigureAllWithDebugger)),
        vscode.commands.registerCommand('cmake.outline.editCacheUI', () => runCommand('editCacheUI')),
        vscode.commands.registerCommand('cmake.outline.cleanRebuildAll', () => runCommand('cleanRebuildAll')),
        // Commands for outline items
        vscode.commands.registerCommand('cmake.outline.configure', async (what: ProjectNode|SourceFileNode) => {
            if (what instanceof ProjectNode) {
                await runCommand('configure', what.folder, false, what.sourceDirectory);
            } else if (what instanceof SourceFileNode) {
                await runCommand('configure', what.folder, false, what.sourcePath);
            }
        }),
        vscode.commands.registerCommand('cmake.outline.configureWithDebugger', async (what: SourceFileNode) => {
            await runCommand('configureWithDebugger', what.folder, what.sourcePath, ConfigureTrigger.projectOutlineConfigureWithDebugger);
        }),
        vscode.commands.registerCommand('cmake.outline.build', (what: ProjectNode) => runCommand('build', what.folder, "all", what.sourceDirectory)),
        vscode.commands.registerCommand('cmake.outline.clean', (what: ProjectNode) => runCommand('build', what.folder, "clean", what.sourceDirectory)),
        vscode.commands.registerCommand('cmake.outline.buildTarget', (what: TargetNode) => runCommand('build', what.folder, what.name, what.sourceDir)),
        vscode.commands.registerCommand('cmake.outline.runUtilityTarget', (what: TargetNode) => runCommand('build', what.folder, what.name, what.sourceDir)),
        vscode.commands.registerCommand('cmake.outline.debugTarget', (what: TargetNode) => runCommand('debugTarget', what.folder, what.name, what.sourceDir)),
        vscode.commands.registerCommand('cmake.outline.launchTarget', (what: TargetNode) => runCommand('launchTarget', what.folder, what.name, what.sourceDir)),
        vscode.commands.registerCommand('cmake.outline.setDefaultTarget', (what: TargetNode) => runCommand('setDefaultTarget', what.folder, what.name, what.sourceDir)),
        vscode.commands.registerCommand('cmake.outline.setLaunchTarget', (what: TargetNode) => runCommand('selectLaunchTarget', what.folder, what.name, what.sourceDir)),
        vscode.commands.registerCommand('cmake.outline.revealInCMakeLists', (what: TargetNode) => what.openInCMakeLists()),
        vscode.commands.registerCommand('cmake.outline.compileFile', (what: SourceFileNode) => runCommand('compileFile', what.filePath)),
        // vscode.commands.registerCommand('cmake.outline.selectWorkspace', (what: WorkspaceFolderNode) => runCommand('selectWorkspace', what.wsFolder))
        vscode.commands.registerCommand('cmake.outline.selectWorkspace', (what: WorkspaceFolderNode) => runCommand('selectWorkspace', what.wsFolder)),
        // Notification of active project change (e.g. when cmake.sourceDirectory changes)
        vscode.commands.registerCommand('cmake.statusbar.update', () => extensionManager?.updateStatusBarForActiveProjectChange())
    ]);

    return { getApi: (version: api.Version) => {
        // Since our API is backwards compatible, we can make our version number match that which was requested.
        if (version === api.Version.v1 || version === api.Version.v2) {
            ext.api.version = version;
        }
        return ext.api;
    }
    };
}

class SchemaProvider implements vscode.TextDocumentContentProvider {
    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        console.assert(uri.path[0] === '/', "A preceeding slash is expected on schema uri path");
        const fileName: string = uri.path.substr(1);
        const locale: string = util.getLocaleId();
        let localizedFilePath: string = path.join(util.thisExtensionPath(), "dist/schema/", locale, fileName);
        const fileExists: boolean = await util.checkFileExists(localizedFilePath);
        if (!fileExists) {
            localizedFilePath = path.join(util.thisExtensionPath(), "schemas", fileName);
        }
        return fs.readFile(localizedFilePath, "utf8");
    }
}

/**
 * Starts up the extension.
 * @param context The extension context
 * @returns A promise that will resolve when the extension is ready for use
 */
export async function activate(context: vscode.ExtensionContext): Promise<api.CMakeToolsExtensionExports> {
    // CMakeTools versions newer or equal to #1.2 should not coexist with older versions
    // because the publisher changed (from vector-of-bool into ms-vscode),
    // causing many undesired behaviors (duplicate operations, registrations for UI elements, etc...)
    const oldCMakeToolsExtension = vscode.extensions.getExtension('vector-of-bool.cmake-tools');
    if (oldCMakeToolsExtension) {
        await vscode.window.showWarningMessage(localize('uninstall.old.cmaketools', 'Please uninstall any older versions of the CMake Tools extension. It is now published by Microsoft starting with version 1.2.0.'));
    }

    const CMAKE_LANGUAGE = "cmake";

    vscode.languages.setLanguageConfiguration(CMAKE_LANGUAGE, {
        indentationRules: {
            // ^(.*\*/)?\s*\}.*$
            decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
            // ^.*\{[^}"']*$
            increaseIndentPattern: /^.*\{[^}"']*$/
        },
        wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
        comments: {
            lineComment: '#'
        },
        brackets: [
            ['{', '}'],
            ['(', ')']
        ],

        __electricCharacterSupport: {
            brackets: [
                { tokenType: 'delimiter.curly.ts', open: '{', close: '}', isElectric: true },
                { tokenType: 'delimiter.square.ts', open: '[', close: ']', isElectric: true },
                { tokenType: 'delimiter.paren.ts', open: '(', close: ')', isElectric: true }
            ]
        },

        __characterPairSupport: {
            autoClosingPairs: [
                { open: '{', close: '}' },
                { open: '(', close: ')' },
                { open: '"', close: '"', notIn: ['string'] }
            ]
        }
    });

    if (vscode.workspace.getConfiguration('cmake').get('showOptionsMovedNotification')) {
        void vscode.window.showInformationMessage(
            localize('options.moved.notification.body', "Some status bar options in CMake Tools have now moved to the Project Status View in the CMake Tools sidebar. You can customize your view with the 'cmake.options' property in settings."),
            localize('options.moved.notification.configure.cmake.options', 'Configure CMake Options Visibility'),
            localize('options.moved.notification.do.not.show', "Do Not Show Again")
        ).then(async (selection) => {
            if (selection !== undefined) {
                if (selection === localize('options.moved.notification.configure.cmake.options', 'Configure CMake Options Visibility')) {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'cmake.options');
                } else if (selection === localize('options.moved.notification.do.not.show', "Do Not Show Again")) {
                    await vscode.workspace.getConfiguration('cmake').update('showOptionsMovedNotification', false, vscode.ConfigurationTarget.Global);
                }
            }
        });
    }

    // Start with a partial feature set view. The first valid CMake project will cause a switch to full feature set.
    await enableFullFeatureSet(false);

    // Register a protocol handler to serve localized schemas
    vscode.workspace.registerTextDocumentContentProvider('cmake-tools-schema', new SchemaProvider());
    await setContextAndStore("inCMakeProject", true);

    taskProvider = vscode.tasks.registerTaskProvider(CMakeTaskProvider.CMakeScriptType, cmakeTaskProvider);
    // Load a new extension manager
    extensionManager = await ExtensionManager.create(context);
    await extensionManager.init();

    // need the extensionManager to be initialized for this.
    pinnedCommands = new PinnedCommands(extensionManager.getWorkspaceConfig(), extensionManager.extensionContext);

    return setup(context);
}

// Enable all or part of the CMake Tools palette commands
// and show or hide the buttons in the status bar, according to the boolean.
// The scope of this is the whole workspace.
export async function enableFullFeatureSet(fullFeatureSet: boolean) {
    await setContextAndStore("cmake:enableFullFeatureSet", fullFeatureSet);
    extensionManager?.showStatusBar(fullFeatureSet);
}

export function getActiveProject(): CMakeProject | undefined {
    return extensionManager?.getActiveProject();
}

export async function setContextAndStore(key: string, value: any) {
    await util.setContextValue(key, value);
    extensionManager?.updateContextValues(key, value);
}

export function getExtensionActiveCommands(): string[] {
    return extensionManager ? extensionManager.extensionActiveCommands : [];
}

export function getExtensionLocalizedStrings(): {[key: string]: string} {
    return extensionManager ? extensionManager.extensionLocalizedStrings : {};
}

export function onExtensionActiveCommandsChanged(listener: () => any, thisObject: any | null) {
    extensionManager?.onExtensionActiveCommandsChanged(listener, thisObject);
}

// This method updates the full/partial view state.
// (by analyzing the valid state of its CMakeLists.txt)
// and also calculates the impact on the whole workspace.
// It is called whenever a project folder goes through a relevant event:
// sourceDirectory change, CMakeLists.txt creation/move/deletion.
export async function updateFullFeatureSet() {
    if (extensionManager) {
        await enableFullFeatureSet(extensionManager.workspaceHasAtLeastOneProject());
    } else {
        // This shouldn't normally happen (not finding a cmake project or not having a valid extension manager)
        // but just in case, disable full feature set.
        log.info(`We don't have an extension manager created yet. ` +
            `Feature set including CMake Tools commands palette is disabled.`);
        await enableFullFeatureSet(false);
    }
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

export function getStatusBar(): StatusBar | undefined {
    if (extensionManager) {
        return extensionManager.getStatusBar();
    }
}
