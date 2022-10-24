/**
 * Class for managing workspace folders
 */ /** */
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import * as util from '@cmt/util';
import CMakeProject from '@cmt/cmakeProject';
import rollbar from '@cmt/rollbar';
import { disposeAll } from '@cmt/util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/*// Go through the decision tree here since there would be dependency issues if we do this in config.ts
get useCMakePresets(): boolean {
    if (this.config.useCMakePresets === 'auto') {
        // TODO (P1): check if configured with kits + vars
        // // Always check if configured before since the state could be reset
        // const state = this.activeCMakeProject.workspaceContext.state;
        // const configuredWithKitsVars = !!(state.activeKitName || state.activeVariantSettings?.size);
        // return !configuredWithKitsVars || (configuredWithKitsVars && (this.presetsController.cmakePresetsExist || this.presetsController.cmakeUserPresetsExist));
        return getActiveCMakeProject()?.presetsController.presetsFileExist || false;
    }
    return this.config.useCMakePresets === 'always';
}*/
export type FolderProjectMap = {folder: vscode.WorkspaceFolder; projects: CMakeProject[]};
export class CMakeProjectController implements vscode.Disposable {
    private readonly cmakeProjectsMap = new Map<string, CMakeProject[]>();

    private readonly beforeAddFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
    private readonly afterAddFolderEmitter = new vscode.EventEmitter<FolderProjectMap>();
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
     * The active workspace folder. This controls several aspects of the extension,
     * including:
     *
     * - Which CMakeProject backend receives commands from the user
     * - Where we search for variants
     * - Where we search for workspace-local kits
     */

    get activeFolderPath(): string | undefined {
        return this.activeCMakeProject?.folderPath;
    }
    /**
     * The name of the folder for this CMakeProject instance
     */
    get activeFolderName(): string | undefined {
        return this.activeCMakeProject?.folderName;
    }

    private activeCMakeProject: CMakeProject | undefined;
    setActiveCMakeProject(workspaceFolder?: vscode.WorkspaceFolder, openEditor?: vscode.TextEditor, folderName?: string): string | undefined {
        if (folderName) {
            const cmakeProjects: CMakeProject[] | undefined = this.getAllCMakeProjects();
            for (const project of cmakeProjects) {
                if (project.folderName === folderName) {
                    this.activeCMakeProject = project;
                    return folderName;
                }
            }
        }
        const cmakeProjects: CMakeProject[] | undefined = this.getCMakeProjectsForFolder(workspaceFolder);
        if (cmakeProjects && cmakeProjects.length === 1) {
            if (openEditor) {
                for (const project of cmakeProjects) {
                    if (util.isFileInsideFolder(openEditor, project.folderPath)) {
                        this.activeCMakeProject = project;
                        break;
                    }
                }
            }
            if (!this.activeCMakeProject) {
                this.activeCMakeProject = cmakeProjects[0];
            }
            return this.activeCMakeProject?.folderName;
        } else {
            this.activeCMakeProject = undefined;
            return undefined;
        }
    }

    public getActiveCMakeProject(workspaceFolder?: vscode.WorkspaceFolder, openEditor?: vscode.TextEditor, setActive?: boolean): CMakeProject | undefined {
        if (!this.activeCMakeProject && setActive) {
            this.setActiveCMakeProject(workspaceFolder, openEditor);
        }
        return this.activeCMakeProject;
    }

    get numOfRoots(): number {
        return this.cmakeProjectsMap.size;
    }

    get numOfProjects(): number {
        return this.getAllCMakeProjects().length;
    }

    get isMultiRoot(): boolean {
        return this.numOfRoots > 1;
    }

    constructor(readonly extensionContext: vscode.ExtensionContext) {
        this.subscriptions = [
            vscode.workspace.onDidChangeWorkspaceFolders(
                e => rollbar.invokeAsync(localize('update.workspace.folders', 'Update workspace folders'), () => this.onChange(e)))
        ];
    }

    dispose() {
        disposeAll(this.subscriptions);
    }

    /**
     * Get the CMakeWorkspaceFolder instance associated with the given workspace folder, or undefined
     * @param ws The workspace folder to search, or array of command and workspace path
     */
    getCMakeProjectsForFolder(ws: vscode.WorkspaceFolder | string[] | undefined): CMakeProject[] | undefined {
        if (ws) {
            if (util.isArrayOfString(ws)) {
                return this.cmakeProjectsMap.get(ws[ws.length - 1]);
            } else if (util.isWorkspaceFolder(ws)) {
                const folder = ws as vscode.WorkspaceFolder;
                return this.cmakeProjectsMap.get(folder.uri.fsPath);
            }
        }
        return undefined;
    }

    getAllCMakeProjects(): CMakeProject[] {
        let allCMakeProjects: CMakeProject[] = [];
        allCMakeProjects = allCMakeProjects.concat(...this.cmakeProjectsMap.values());
        return allCMakeProjects;
    }

    /**
     * Load all the folders currently open in VSCode
     */
    async loadAllProjects() {
        this.getAllCMakeProjects().forEach(project => project.dispose());
        this.cmakeProjectsMap.clear();
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                await this.addFolder(folder);
            }
        }
    }

    /**
     * Handle workspace change event.
     * @param event Workspace change event
     */
    private async onChange(event: vscode.WorkspaceFoldersChangeEvent) {
        // Un-register each CMake Tools we have loaded for each removed workspace
        for (const folder of event.removed) {
            const cmakeProjects: CMakeProject[] | undefined = this.getCMakeProjectsForFolder(folder);
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
            this.afterAddFolderEmitter.fire({folder: folder, projects: cmakeProjects});
        }
    }

    /**
     * Load a new CMakeProject for the given workspace folder and remember it.
     * @param folder The workspace folder to load for
     */
    private createCMakeProjectForWorkspaceFolder(folder: vscode.WorkspaceFolder): Promise<CMakeProject|CMakeProject[]> {
        // Create the backend:
        return CMakeProject.createForDirectory(folder, this.extensionContext);
    }

    public useCMakePresetsForFolder(folder: vscode.WorkspaceFolder): boolean {
        const cmakeProjects: CMakeProject[] | undefined = this.getCMakeProjectsForFolder(folder);
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
        const existing = this.getCMakeProjectsForFolder(folder);
        if (existing) {
            rollbar.error(localize('same.folder.loaded.twice', 'The same workspace folder was loaded twice'), { wsUri: folder.uri.toString() });
            return existing;
        }
        // Load for the workspace.
        let newProjects: CMakeProject|CMakeProject[] = await this.createCMakeProjectForWorkspaceFolder(folder);
        newProjects = Array.isArray(newProjects) ? newProjects : [newProjects];
        this.cmakeProjectsMap.set(folder.uri.fsPath, newProjects);
        return newProjects;
    }

    /**
     * Remove knowledge of the given workspace folder. Disposes of the CMakeProject
     * instance associated with the workspace.
     * @param folder The workspace to remove for
     */
    private async removeFolder(folder: vscode.WorkspaceFolder) {
        const cmakeProjects = this.getCMakeProjectsForFolder(folder);
        if (!cmakeProjects) {
            // CMake Tools should always be aware of all workspace folders. If we
            // somehow missed one, that's a bug
            rollbar.error(localize('removed.folder.not.on.record', 'Workspace folder removed, but not associated with an extension instance'), { wsUri: folder.uri.toString() });
            // Keep the UI running, just don't remove this instance.
            return;
        }
        // Drop the instance from our table. Forget about it.
        this.cmakeProjectsMap.delete(folder.uri.fsPath);
        // Finally, dispose of the CMake Tools now that the workspace is gone.
        for (const project of cmakeProjects) {
            project.dispose();
        }

    }

    [Symbol.iterator]() {
        return this.cmakeProjectsMap.values();
    }
}
