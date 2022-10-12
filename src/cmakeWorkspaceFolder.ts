/**
 * Class for managing workspace folders
 */ /** */
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as path from 'path';

import * as util from '@cmt/util';
import CMakeProject from '@cmt/cmakeProject';
import rollbar from '@cmt/rollbar';
import { disposeAll, setContextValue } from '@cmt/util';
import { CMakeCommunicationMode, ConfigurationReader, UseCMakePresets } from './config';
import { DirectoryContext } from './workspace';
import { getCMakeProjectForActiveFolder } from './extension';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface DiagnosticsConfiguration {
    folder: string;
    cmakeVersion: string;
    compilers: { C?: string; CXX?: string };
    usesPresets: boolean;
    generator: string;
    configured: boolean;
}

export interface DiagnosticsSettings {
    communicationMode: CMakeCommunicationMode;
    useCMakePresets: UseCMakePresets;
    configureOnOpen: boolean | null;
}

export class CMakeWorkspaceFolder {
    private wasUsingCMakePresets: boolean | undefined;
    private onDidOpenTextDocumentListener: vscode.Disposable | undefined;
    private disposables: vscode.Disposable[] = [];
    private sourceDirectoryMap = new Map<vscode.WorkspaceFolder, CMakeProject>();

    private readonly onUseCMakePresetsChangedEmitter = new vscode.EventEmitter<boolean>();

    private constructor(cmakeProjects: CMakeProject[]) {
        for (const project of cmakeProjects) {
            this.sourceDirectoryMap.set(project.folder, project);
        }
    }

    static async init(cmakeProjects: CMakeProject[]) {
        const cmakeWorkspaceFolder = new CMakeWorkspaceFolder(cmakeProjects);

        const useCMakePresetsChangedListener = async () => {
            const usingCMakePresets = cmakeWorkspaceFolder.useCMakePresets;
            if (usingCMakePresets !== cmakeWorkspaceFolder.wasUsingCMakePresets) {
                cmakeWorkspaceFolder.wasUsingCMakePresets = usingCMakePresets;
                await setContextValue('useCMakePresets', usingCMakePresets);
                for (const project of cmakeWorkspaceFolder.cmakeProjects) {
                    await project.setUseCMakePresets(usingCMakePresets);
                }
                await CMakeWorkspaceFolder.initializeKitOrPresetsInProject(cmakeWorkspaceFolder);

                if (usingCMakePresets) {
                    const setPresetsFileLanguageMode = (document: vscode.TextDocument) => {
                        const config = cmakeWorkspaceFolder.config;
                        const fileName = path.basename(document.uri.fsPath);
                        if (fileName === 'CMakePresets.json' || fileName === 'CMakeUserPresets.json') {
                            if (config.allowCommentsInPresetsFile && document.languageId !== 'jsonc') {
                                // setTextDocumentLanguage will trigger onDidOpenTextDocument
                                void vscode.languages.setTextDocumentLanguage(document, 'jsonc');
                            } else if (!config.allowCommentsInPresetsFile && document.languageId !== 'json') {
                                void vscode.languages.setTextDocumentLanguage(document, 'json');
                            }
                        }
                    };

                    cmakeWorkspaceFolder.onDidOpenTextDocumentListener = vscode.workspace.onDidOpenTextDocument(document =>
                        setPresetsFileLanguageMode(document)
                    );

                    vscode.workspace.textDocuments.forEach(document => setPresetsFileLanguageMode(document));
                } else {
                    if (cmakeWorkspaceFolder.onDidOpenTextDocumentListener) {
                        cmakeWorkspaceFolder.onDidOpenTextDocumentListener.dispose();
                        cmakeWorkspaceFolder.onDidOpenTextDocumentListener = undefined;
                    }
                }

                cmakeWorkspaceFolder.onUseCMakePresetsChangedEmitter.fire(usingCMakePresets);
            }
        };

        await useCMakePresetsChangedListener();

        cmakeWorkspaceFolder.disposables.push(cmakeWorkspaceFolder.config.onChange('useCMakePresets', useCMakePresetsChangedListener));
        for (const project of cmakeWorkspaceFolder.cmakeProjects) {
            cmakeWorkspaceFolder.disposables.push(project.onPresetsChanged(useCMakePresetsChangedListener));
            cmakeWorkspaceFolder.disposables.push(project.onUserPresetsChanged(useCMakePresetsChangedListener));
        }

        return cmakeWorkspaceFolder;
    }

    get activeFolder(): vscode.WorkspaceFolder {
        return getCMakeProjectForActiveFolder()?.folder! ;
    }

    // Go through the decision tree here since there would be dependency issues if we do this in config.ts
    get useCMakePresets(): boolean {
        if (this.config.useCMakePresets === 'auto') {
            // TODO (P1): check if configured with kits + vars
            // // Always check if configured before since the state could be reset
            // const state = this.activeCMakeProject.workspaceContext.state;
            // const configuredWithKitsVars = !!(state.activeKitName || state.activeVariantSettings?.size);
            // return !configuredWithKitsVars || (configuredWithKitsVars && (this.presetsController.cmakePresetsExist || this.presetsController.cmakeUserPresetsExist));
            return getCMakeProjectForActiveFolder()?.presetsController.presetsFileExist || false;
        }
        return this.config.useCMakePresets === 'always';
    }

    get config(): ConfigurationReader {
        return this.cmakeProjects[0].workspaceContext.config;
    }

    get workspaceContext(): DirectoryContext {
        // There is one directory context associated to all CMakeProjects in the same root.
        return this.cmakeProjects[0].workspaceContext;
    }

    get cmakeProjects(): CMakeProject[] {
        return Array.from(this.sourceDirectoryMap.values());
    }

    async getDiagnostics(): Promise<DiagnosticsConfiguration> {
        try {
            const drv = await getCMakeProjectForActiveFolder()?.getCMakeDriverInstance();
            if (drv) {
                return drv.getDiagnostics();
            }
        } catch {
        }
        return {
            folder: this.activeFolder?.name || "",
            cmakeVersion: "unknown",
            configured: false,
            generator: "unknown",
            usesPresets: false,
            compilers: {}
        };
    }

    async getSettingsDiagnostics(): Promise<DiagnosticsSettings> {
        try {
            const drv = await getCMakeProjectForActiveFolder()?.getCMakeDriverInstance();
            if (drv) {
                return {
                    communicationMode: drv.config.cmakeCommunicationMode,
                    useCMakePresets: drv.config.useCMakePresets,
                    configureOnOpen: drv.config.configureOnOpen
                };
            }
        } catch {
        }
        return {
            communicationMode: 'automatic',
            useCMakePresets: 'auto',
            configureOnOpen: null
        };
    }

    get onUseCMakePresetsChanged() {
        return this.onUseCMakePresetsChangedEmitter.event;
    }

    dispose() {
        if (this.onDidOpenTextDocumentListener) {
            this.onDidOpenTextDocumentListener.dispose();
        }
        getCMakeProjectForActiveFolder()?.dispose();
    }

    private static async initializeKitOrPresetsInProject(folder: CMakeWorkspaceFolder) {
        const activeCMakeProject = getCMakeProjectForActiveFolder();
        if (activeCMakeProject) {
            if (folder.useCMakePresets) {
                const configurePreset = activeCMakeProject.workspaceContext.state.configurePresetName;
                if (configurePreset) {
                    await activeCMakeProject.presetsController.setConfigurePreset(configurePreset);
                }
            } else {
                // Check if the CMakeProject remembers what kit it was last using in this dir:
                const kitName = activeCMakeProject.workspaceContext.state.activeKitName;
                if (kitName) {
                    // It remembers a kit. Find it in the kits avail in this dir:
                    const kit = activeCMakeProject.kitsController.availableKits.find(k => k.name === kitName) || null;
                    // Set the kit: (May do nothing if no kit was found)
                    await activeCMakeProject.setKit(kit);
                }
            }
        }
    }
}

export class CMakeWorkspaceFolderController implements vscode.Disposable {
    private readonly instances = new Map<string, CMakeWorkspaceFolder>();

    private readonly beforeAddFolderEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
    private readonly afterAddFolderEmitter = new vscode.EventEmitter<CMakeWorkspaceFolder>();
    private readonly beforeRemoveFolderEmitter = new vscode.EventEmitter<CMakeWorkspaceFolder>();
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
    private _activeFolder?: CMakeWorkspaceFolder;
    get activeFolder() {
        return this._activeFolder;
    }

    setActiveFolder(ws: vscode.WorkspaceFolder | undefined, openEditor?: vscode.TextEditor) {
        if (ws) {
            this._activeFolder = this.get(ws);
            this.setActiveCMakeProject(openEditor);
        } else {
            this._activeFolder = undefined;
        }
    }

    private activeCMakeProject: CMakeProject | undefined;
    public setActiveCMakeProject(openEditor?: vscode.TextEditor) {
        if (this._activeFolder) {
            const cmakeProjects = this._activeFolder.cmakeProjects;
            if (cmakeProjects.length === 1) {
                this.activeCMakeProject = cmakeProjects[0];
            }
            if (openEditor) {
                for (const project of cmakeProjects) {
                    if (util.isFileInsideFolder(openEditor, project.folder)) {
                        this.activeCMakeProject = project;
                    }
                }
            }
        }
    }

    public getActiveCMakeProject(openEditor?: vscode.TextEditor): CMakeProject {
        if (!this.activeCMakeProject) {
            this.setActiveCMakeProject(openEditor);
        }
        return this.activeCMakeProject!;
    }

    get size() {
        return this.instances.size;
    }

    get isMultiRoot() {
        return this.size > 1;
    }

    constructor(readonly extensionContext: vscode.ExtensionContext) {
        this.subscriptions = [
            vscode.workspace.onDidChangeWorkspaceFolders(
                e => rollbar.invokeAsync(localize('update.workspace.folders', 'Update workspace folders'), () => this._onChange(e)))
        ];
    }

    dispose() {
        disposeAll(this.subscriptions);
    }

    /**
     * Get the CMakeWorkspaceFolder instance associated with the given workspace folder, or undefined
     * @param ws The workspace folder to search, or array of command and workspace path
     */
    get(ws: vscode.WorkspaceFolder | string[] | undefined): CMakeWorkspaceFolder | undefined {
        if (ws) {
            if (util.isArrayOfString(ws)) {
                return this.instances.get(ws[ws.length - 1]);
            } else if (util.isWorkspaceFolder(ws)) {
                const folder = ws as vscode.WorkspaceFolder;
                return this.instances.get(folder.uri.fsPath);
            }
        }
        return undefined;
    }

    getAll(): CMakeWorkspaceFolder[] {
        return [...this.instances.values()];
    }

    /**
     * Load all the folders currently open in VSCode
     */
    async loadAllCurrent() {
        this.instances.forEach(folder => folder.dispose());
        this.instances.clear();
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                await this._addFolder(folder);
            }
        }
    }

    /**
     * Handle workspace change event.
     * @param e Workspace change event
     */
    private async _onChange(e: vscode.WorkspaceFoldersChangeEvent) {
        // Un-register each CMake Tools we have loaded for each removed workspace
        for (const folder of e.removed) {
            const cmtf = this.get(folder);
            if (cmtf) {
                this.beforeRemoveFolderEmitter.fire(cmtf);
            }
            await this._removeFolder(folder);
            this.afterRemoveFolderEmitter.fire(folder);
        }
        // Load a new CMake Tools instance for each folder that has been added.
        for (const folder of e.added) {
            this.beforeAddFolderEmitter.fire(folder);
            const cmtf = await this._addFolder(folder);
            this.afterAddFolderEmitter.fire(cmtf);
        }
    }

    /**
     * Load a new CMakeProject for the given workspace folder and remember it.
     * @param folder The workspace folder to load for
     */
    private loadCMakeProjectForWorkspaceFolder(folder: vscode.WorkspaceFolder): Promise<CMakeProject|CMakeProject[]> {
        // Create the backend:
        return CMakeProject.createForDirectory(folder, this.extensionContext);
    }

    /**
     * Create a new instance of the backend to support the given workspace folder.
     * The given folder *must not* already be loaded.
     * @param folder The workspace folder to load for
     * @returns The newly created CMakeProject backend for the given folder
     */
    private async _addFolder(folder: vscode.WorkspaceFolder) {
        const existing = this.get(folder);
        if (existing) {
            rollbar.error(localize('same.folder.loaded.twice', 'The same workspace folder was loaded twice'), { wsUri: folder.uri.toString() });
            return existing;
        }
        // Load for the workspace.
        const newProject: CMakeProject|CMakeProject[] = await this.loadCMakeProjectForWorkspaceFolder(folder);
        // Remember it
        const inst = await CMakeWorkspaceFolder.init(Array.isArray(newProject) ? newProject : [newProject]);

        this.instances.set(folder.uri.fsPath, inst);

        // Return the newly created instance
        return inst;
    }

    /**
     * Remove knowledge of the given workspace folder. Disposes of the CMakeProject
     * instance associated with the workspace.
     * @param folder The workspace to remove for
     */
    private async _removeFolder(folder: vscode.WorkspaceFolder) {
        const inst = this.get(folder);
        if (!inst) {
            // CMake Tools should always be aware of all workspace folders. If we
            // somehow missed one, that's a bug
            rollbar.error(localize('removed.folder.not.on.record', 'Workspace folder removed, but not associated with an extension instance'), { wsUri: folder.uri.toString() });
            // Keep the UI running, just don't remove this instance.
            return;
        }
        // Drop the instance from our table. Forget about it.
        this.instances.delete(folder.uri.fsPath);
        // Finally, dispose of the CMake Tools now that the workspace is gone.
        inst.dispose();
    }

    [Symbol.iterator]() {
        return this.instances.values();
    }
}
