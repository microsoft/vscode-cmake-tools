/**
 * Class for managing CMake projects
 */
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import * as util from '@cmt/util';
import CMakeProject from '@cmt/cmakeProject';
import rollbar from '@cmt/rollbar';
import { disposeAll } from '@cmt/util';
import { ConfigurationReader } from './config';
import { CMakeDriver } from './drivers/drivers';
import { DirectoryContext } from './workspace';
import { StateManager } from './state';
import { getStatusBar } from './extension';
import * as telemetry from './telemetry';
import { StatusBar } from './status';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export type FolderProjectType = { folder: vscode.WorkspaceFolder; projects: CMakeProject[] };
export class ProjectController implements vscode.Disposable {
    private readonly folderToProjectsMap = new Map<string, CMakeProject[]>();
    private readonly sourceDirectorySub = new Map<vscode.WorkspaceFolder, vscode.Disposable>();
    private readonly useCMakePresetsSub = new Map<vscode.WorkspaceFolder, vscode.Disposable>();

    private readonly beforeAddFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
    private readonly afterAddFolderEmitter = new vscode.EventEmitter<FolderProjectType>();
    private readonly beforeRemoveFolderEmitter = new vscode.EventEmitter<CMakeProject[]>();
    private readonly afterRemoveFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
    private readonly subscriptions: vscode.Disposable[] = [
        this.beforeAddFolderEmitter,
        this.afterAddFolderEmitter,
        this.beforeRemoveFolderEmitter,
        this.afterRemoveFolderEmitter
    ];

    get onBeforeAddFolder() {
        return this.beforeAddFolderEmitter.event;
    }
    get onAfterAddFolder() {
        return this.afterAddFolderEmitter.event;
    }
    get onBeforeRemoveFolder() {
        return this.beforeRemoveFolderEmitter.event;
    }
    get onAfterRemoveFolder() {
        return this.afterRemoveFolderEmitter.event;
    }

    /**
     * The path of the folder of the active CMakeProject instance
     */
    get activeFolderPath(): string | undefined {
        return this.activeProject?.folderPath;
    }
    /**
     * The name of the folder of the active CMakeProject instance
     */
    get activeFolderName(): string | undefined {
        return this.activeProject?.folderName;
    }

    private activeProject: CMakeProject | undefined;
    updateActiveProject(workspaceFolder?: vscode.WorkspaceFolder, openEditor?: vscode.TextEditor): void {
        const projects: CMakeProject[] | undefined = this.getProjectsForWorkspaceFolder(workspaceFolder);
        if (projects && projects.length > 0) {
            if (openEditor) {
                for (const project of projects) {
                    if (util.isFileInsideFolder(openEditor.document, project.folderPath)) {
                        this.activeProject = project;
                        break;
                    }
                }
                if (!this.activeProject) {
                    if (util.isFileInsideFolder(openEditor.document, projects[0].workspaceFolder.uri.fsPath)) {
                        this.activeProject = projects[0];
                    }
                }
                // If active project is found, return.
                if (this.activeProject) {
                    return;
                }
            } else {
                // Set a default active project.
                this.activeProject = projects[0];
                return;
            }
        }
    }

    setActiveProject(project: CMakeProject): void {
        this.activeProject = project;
    }

    public getActiveCMakeProject(): CMakeProject | undefined {
        return this.activeProject;
    }

    // Number of workspace folders
    get numOfWorkspaceFolders(): number {
        return this.folderToProjectsMap.size;
    }

    get numOfProjects(): number {
        return this.getAllCMakeProjects().length;
    }

    get hasMultipleProjects(): boolean {
        return this.numOfProjects > 1;
    }

    get hasMultipleProjectsInOneFolder(): boolean {
        for (const projects of this.folderToProjectsMap.values()) {
            if (projects && projects.length > 1) {
                return true;
            }
        }
        return false;
    }

    get hasMultipleRoots(): boolean {
        return this.numOfWorkspaceFolders > 1;
    }

    constructor(readonly extensionContext: vscode.ExtensionContext) {
        this.subscriptions = [
            vscode.workspace.onDidChangeWorkspaceFolders(
                e => rollbar.invokeAsync(localize('update.workspace.folders', 'Update workspace folders'), () => this.doWorkspaceFolderChange(e))),
            vscode.workspace.onDidOpenTextDocument((textDocument: vscode.TextDocument) => this.doOpenTextDocument(textDocument)),
            vscode.workspace.onDidSaveTextDocument((textDocument: vscode.TextDocument) => this.doSaveTextDocument(textDocument))
        ];
    }

    async dispose() {
        disposeAll(this.subscriptions);
        // Dispose of each CMakeProject we have loaded.
        for (const project of this.getAllCMakeProjects()) {
            await project.asyncDispose();
        }
    }

    /**
     * Get the all CMakeWorkspaceFolder instance associated with the given workspace folder, or undefined
     * @param ws The workspace folder to search, or array of command and workspace path
     */
    getProjectsForWorkspaceFolder(ws: vscode.WorkspaceFolder | string[] | undefined): CMakeProject[] | undefined {
        if (ws) {
            if (util.isArrayOfString(ws)) {
                return this.folderToProjectsMap.get(ws[ws.length - 1]);
            } else if (util.isWorkspaceFolder(ws)) {
                const folder = ws as vscode.WorkspaceFolder;
                return this.folderToProjectsMap.get(folder.uri.fsPath);
            }
        }
        return undefined;
    }

    async getProjectForFolder(folder: string): Promise<CMakeProject | undefined> {
        const sourceDir = await util.normalizeAndVerifySourceDir(folder, CMakeDriver.sourceDirExpansionOptions(folder));
        const allCMakeProjects: CMakeProject[] = this.getAllCMakeProjects();
        for (const project of allCMakeProjects) {
            if (project.sourceDir === sourceDir || project.workspaceFolder.uri.fsPath === sourceDir) {
                return project;
            }
        }
        return undefined;
    }

    getAllCMakeProjects(): CMakeProject[] {
        let allCMakeProjects: CMakeProject[] = [];
        allCMakeProjects = allCMakeProjects.concat(...this.folderToProjectsMap.values());
        return allCMakeProjects;
    }

    /**
     * Load all the folders currently open in VSCode
     */
    async loadAllProjects() {
        this.getAllCMakeProjects().forEach(project => project.dispose());
        this.folderToProjectsMap.clear();
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                await this.addFolder(folder);
            }
        }
    }

    /**
     * Load a new CMakeProject for the given workspace folder and remember it.
     * @param folder The workspace folder to load for
     */
    public static async createCMakeProjectsForWorkspaceFolder(folder: vscode.WorkspaceFolder, extensionContext: vscode.ExtensionContext): Promise<CMakeProject[]> {
        // Create a context for the directory
        const workspaceContext = DirectoryContext.createForDirectory(folder, new StateManager(extensionContext, folder));
        const sourceDirectory: string[] = workspaceContext.config.sourceDirectory;
        const isMultiProjectFolder: boolean = (sourceDirectory.length > 1);
        const projects: CMakeProject[] = [];
        for (const source of sourceDirectory) {
            projects.push(await CMakeProject.create(extensionContext, workspaceContext, source, isMultiProjectFolder));
        }
        return projects;
    }

    public useCMakePresetsForFolder(folder: vscode.WorkspaceFolder): boolean {
        const cmakeProjects: CMakeProject[] | undefined = this.getProjectsForWorkspaceFolder(folder);
        if (cmakeProjects && cmakeProjects.length > 0) {
            return cmakeProjects[0].useCMakePresets;
        }
        return false;
    }
    /**
     * Create a new instance of the backend to support the given workspace folder.
     * The given folder *must not* already be loaded.
     * @param folder The workspace folder to load for
     * @returns The newly created CMakeProject backend for the given folder
     */
    private async addFolder(folder: vscode.WorkspaceFolder): Promise<CMakeProject[]> {
        const existing = this.getProjectsForWorkspaceFolder(folder);
        if (existing) {
            rollbar.error(localize('same.folder.loaded.twice', 'The same workspace folder was loaded twice'), { wsUri: folder.uri.toString() });
            return existing;
        }
        // Load for the workspace.
        const newProjects: CMakeProject[] = await ProjectController.createCMakeProjectsForWorkspaceFolder(folder, this.extensionContext);
        this.folderToProjectsMap.set(folder.uri.fsPath, newProjects);
        const config: ConfigurationReader | undefined = this.getConfigurationReader(folder);
        if (config) {
            this.sourceDirectorySub.set(folder, config.onChange('sourceDirectory', async (sourceDirectories: string | string[]) => this.doSourceDirectoryChange(folder, sourceDirectories)));
            this.useCMakePresetsSub.set(folder, config.onChange('useCMakePresets', async (useCMakePresets: string) => this.doUseCMakePresetsChange(folder, useCMakePresets)));
        }
        return newProjects;
    }

    /**
     * Remove knowledge of the given workspace folder. Disposes of the CMakeProject
     * instance associated with the workspace.
     * @param folder The workspace to remove for
     */
    private async removeFolder(folder: vscode.WorkspaceFolder) {
        const cmakeProjects = this.getProjectsForWorkspaceFolder(folder);
        if (!cmakeProjects) {
            // CMake Tools should always be aware of all workspace folders. If we
            // somehow missed one, that's a bug
            rollbar.error(localize('removed.folder.not.on.record', 'Workspace folder removed, but not associated with an extension instance'), { wsUri: folder.uri.toString() });
            // Keep the UI running, just don't remove this instance.
            return;
        }
        // Drop the instance from our table. Forget about it.
        this.folderToProjectsMap.delete(folder.uri.fsPath);
        // Finally, dispose of the CMake Tools now that the workspace is gone.
        for (const project of cmakeProjects) {
            project.dispose();
        }
        // eslint-disable-next-line no-unused-expressions
        this.sourceDirectorySub.get(folder)?.dispose();
        this.sourceDirectorySub.delete(folder);
        // eslint-disable-next-line no-unused-expressions
        this.useCMakePresetsSub.get(folder)?.dispose();
        this.useCMakePresetsSub.delete(folder);
    }

    private getConfigurationReader(folder: vscode.WorkspaceFolder): ConfigurationReader | undefined {
        const cmakeProjects = this.getProjectsForWorkspaceFolder(folder);
        if (!cmakeProjects || cmakeProjects.length === 0) {
            return undefined;
        }
        return cmakeProjects[0].getConfigurationReader();
    }

    private async doSourceDirectoryChange(folder: vscode.WorkspaceFolder, value: string | string[]) {
        let sourceDirectories: string[] = [];
        if (typeof (value) === 'string') {
            sourceDirectories = [value];
        } else if (value instanceof Array) {
            sourceDirectories = value;
        }
        // Normalize the paths.
        for (let i = 0; i < sourceDirectories.length; i++) {
            sourceDirectories[i] = await util.normalizeAndVerifySourceDir(sourceDirectories[i], CMakeDriver.sourceDirExpansionOptions(folder.uri.fsPath));
        }
        const projects: CMakeProject[] | undefined = this.getProjectsForWorkspaceFolder(folder);

        if (projects) {
            // Remove projects.
            for (let i = projects.length - 1; i >= 0; i--) {
                if (sourceDirectories.indexOf(projects[i].sourceDir) !== -1) {
                    sourceDirectories.splice(sourceDirectories.indexOf(projects[i].sourceDir), 1);
                } else {
                    projects[i].dispose();
                    projects.splice(i, 1);
                }
            }

            // Add projects.
            const workspaceContext = DirectoryContext.createForDirectory(folder, new StateManager(this.extensionContext, folder));
            for (let i = 0; i < sourceDirectories.length; i++) {
                const cmakeProject: CMakeProject = await CMakeProject.create(this.extensionContext, workspaceContext, sourceDirectories[i]);
                projects.push(cmakeProject);
            }
            // Update the map.
            this.folderToProjectsMap.set(folder.uri.fsPath, projects);
        }
    }

    private async doUseCMakePresetsChange(folder: vscode.WorkspaceFolder, useCMakePresets: string): Promise<void> {
        const projects: CMakeProject[] | undefined = this.getProjectsForWorkspaceFolder(folder);
        if (projects) {
            for (const project of projects) {
                let use: boolean = false;
                switch (useCMakePresets) {
                    case 'always':
                        use = true;
                        break;
                    case 'never':
                        use = false;
                        break;
                    default:
                        use = await project.hasPresetsFiles();
                }
                await project.doUseCMakePresetsChange(use);
            }
        }
        if (this.activeProject) {
            const use: boolean = this.activeProject.useCMakePresets;
            await util.setContextValue('useCMakePresets', use);
            const statusBar: StatusBar | undefined = getStatusBar();
            if (statusBar) {
                statusBar.useCMakePresets(use);
            }
        }
    }

    /**
     * Handle workspace change event.
     * @param event Workspace change event
     */
    private async doWorkspaceFolderChange(event: vscode.WorkspaceFoldersChangeEvent) {
        // Un-register each CMake Tools we have loaded for each removed workspace
        for (const folder of event.removed) {
            const cmakeProjects: CMakeProject[] | undefined = this.getProjectsForWorkspaceFolder(folder);
            if (cmakeProjects) {
                this.beforeRemoveFolderEmitter.fire(cmakeProjects);
            }
            await this.removeFolder(folder);
            this.afterRemoveFolderEmitter.fire(folder);
        }
        // Load a new CMake Tools instance for each folder that has been added.
        for (const folder of event.added) {
            this.beforeAddFolderEmitter.fire(folder);
            const cmakeProjects = await this.addFolder(folder);
            this.afterAddFolderEmitter.fire({ folder: folder, projects: cmakeProjects });
        }
    }

    private async doOpenTextDocument(textDocument: vscode.TextDocument) {
        const filePath = textDocument.uri.fsPath.toLowerCase();
        if (filePath.endsWith("cmakelists.txt") || filePath.endsWith(".cmake")) {
            telemetry.logEvent("cmakeFileOpen");
        }
    }

    private async doSaveTextDocument(textDocument: vscode.TextDocument): Promise<void> {
        const activeProject: CMakeProject | undefined = this.getActiveCMakeProject();
        if (activeProject) {
            const isFileInsideActiveProject: boolean = util.isFileInsideFolder(textDocument, activeProject.isMultiProjectFolder ? activeProject.folderPath : activeProject.workspaceFolder.uri.fsPath);
            if (isFileInsideActiveProject) {
                await activeProject.doCMakeFileSaveReconfigure(textDocument);
            }
            await activeProject.sendFileTypeTelemetry(textDocument);
        }
    }

    [Symbol.iterator]() {
        return this.folderToProjectsMap.values();
    }
}
