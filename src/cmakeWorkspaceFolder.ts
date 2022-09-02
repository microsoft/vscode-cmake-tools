/**
 * Class for managing workspace folders
 */ /** */
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as path from 'path';

import * as util from '@cmt/util';
import CMakeProject from '@cmt/cmakeProject';
import { KitsController } from '@cmt/kitsController';
import rollbar from '@cmt/rollbar';
import { disposeAll, setContextValue } from '@cmt/util';
import { PresetsController } from '@cmt/presetsController';
import { CMakeCommunicationMode, UseCMakePresets } from './config';

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

    private readonly onUseCMakePresetsChangedEmitter = new vscode.EventEmitter<boolean>();

    private constructor(readonly cmakeTools: CMakeProject,
        readonly kitsController: KitsController,
        readonly presetsController: PresetsController) {}

    static async init(cmakeTools: CMakeProject) {
        const kitsController = await KitsController.init(cmakeTools);
        const presetsController = await PresetsController.init(cmakeTools, kitsController);
        const cmakeWorkspaceFolder = new CMakeWorkspaceFolder(cmakeTools, kitsController, presetsController);

        const useCMakePresetsChangedListener = async () => {
            const usingCMakePresets = cmakeWorkspaceFolder.useCMakePresets;
            if (usingCMakePresets !== cmakeWorkspaceFolder.wasUsingCMakePresets) {
                cmakeWorkspaceFolder.wasUsingCMakePresets = usingCMakePresets;
                await setContextValue('useCMakePresets', usingCMakePresets);
                await cmakeTools.setUseCMakePresets(usingCMakePresets);
                await CMakeWorkspaceFolder.initializeKitOrPresetsInCmt(cmakeWorkspaceFolder);

                if (usingCMakePresets) {
                    const setPresetsFileLanguageMode = (document: vscode.TextDocument) => {
                        const config = cmakeWorkspaceFolder.cmakeTools.workspaceContext.config;
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

        cmakeWorkspaceFolder.disposables.push(cmakeTools.workspaceContext.config.onChange('useCMakePresets', useCMakePresetsChangedListener));
        cmakeWorkspaceFolder.disposables.push(presetsController.onPresetsChanged(useCMakePresetsChangedListener));
        cmakeWorkspaceFolder.disposables.push(presetsController.onUserPresetsChanged(useCMakePresetsChangedListener));

        return cmakeWorkspaceFolder;
    }

    get folder() {
        return this.cmakeTools.folder;
    }

    // Go through the decision tree here since there would be dependency issues if we do this in config.ts
    get useCMakePresets(): boolean {
        if (this.cmakeTools.workspaceContext.config.useCMakePresets === 'auto') {
            // TODO (P1): check if configured with kits + vars
            // // Always check if configured before since the state could be reset
            // const state = this.cmakeTools.workspaceContext.state;
            // const configuredWithKitsVars = !!(state.activeKitName || state.activeVariantSettings?.size);
            // return !configuredWithKitsVars || (configuredWithKitsVars && (this.presetsController.cmakePresetsExist || this.presetsController.cmakeUserPresetsExist));
            return this.presetsController.presetsFileExist;
        }
        return this.cmakeTools.workspaceContext.config.useCMakePresets === 'always';
    }

    async getDiagnostics(): Promise<DiagnosticsConfiguration> {
        try {
            const drv = await this.cmakeTools.getCMakeDriverInstance();
            if (drv) {
                return drv.getDiagnostics();
            }
        } catch {
        }
        return {
            folder: this.folder.name,
            cmakeVersion: "unknown",
            configured: false,
            generator: "unknown",
            usesPresets: false,
            compilers: {}
        };
    }

    async getSettingsDiagnostics(): Promise<DiagnosticsSettings> {
        try {
            const drv = await this.cmakeTools.getCMakeDriverInstance();
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
        this.cmakeTools.dispose();
        this.kitsController.dispose();
    }

    private static async initializeKitOrPresetsInCmt(folder: CMakeWorkspaceFolder) {
        if (folder.useCMakePresets) {
            const configurePreset = folder.cmakeTools.workspaceContext.state.configurePresetName;
            if (configurePreset) {
                await folder.presetsController.setConfigurePreset(configurePreset);
            }
        } else {
            // Check if the CMakeTools remembers what kit it was last using in this dir:
            const kitName = folder.cmakeTools.workspaceContext.state.activeKitName;
            if (kitName) {
                // It remembers a kit. Find it in the kits avail in this dir:
                const kit = folder.kitsController.availableKits.find(k => k.name === kitName) || null;
                // Set the kit: (May do nothing if no kit was found)
                await folder.cmakeTools.setKit(kit);
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
     * - Which CMakeTools backend receives commands from the user
     * - Where we search for variants
     * - Where we search for workspace-local kits
     */
    private _activeFolder?: CMakeWorkspaceFolder;
    get activeFolder() {
        return this._activeFolder;
    }
    setActiveFolder(ws: vscode.WorkspaceFolder | undefined) {
        if (ws) {
            this._activeFolder = this.get(ws);
        } else {
            this._activeFolder = undefined;
        }
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
     * Get the CMakeTools instance associated with the given workspace folder, or undefined
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
     * Load a new CMakeTools for the given workspace folder and remember it.
     * @param folder The workspace folder to load for
     */
    private loadCMakeToolsForWorkspaceFolder(folder: vscode.WorkspaceFolder) {
        // Create the backend:
        return CMakeProject.createForDirectory(folder, this.extensionContext);
    }

    /**
     * Create a new instance of the backend to support the given workspace folder.
     * The given folder *must not* already be loaded.
     * @param folder The workspace folder to load for
     * @returns The newly created CMakeTools backend for the given folder
     */
    private async _addFolder(folder: vscode.WorkspaceFolder) {
        const existing = this.get(folder);
        if (existing) {
            rollbar.error(localize('same.folder.loaded.twice', 'The same workspace folder was loaded twice'), { wsUri: folder.uri.toString() });
            return existing;
        }
        // Load for the workspace.
        const new_cmt = await this.loadCMakeToolsForWorkspaceFolder(folder);
        // Remember it
        const inst = await CMakeWorkspaceFolder.init(new_cmt);

        this.instances.set(folder.uri.fsPath, inst);

        // Return the newly created instance
        return inst;
    }

    /**
     * Remove knowledge of the given workspace folder. Disposes of the CMakeTools
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
