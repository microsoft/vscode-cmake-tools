import * as vscode from 'vscode';

/**
 * This class keeps track of all state that needs to persist between sessions
 * within a single workspace. Objects that wish to persist state should store
 * it here to ensure that we keep state consistent.
 *
 * This uses VSCode's Memento objects to ensure consistency. The user cannot
 * easily modify the contents of a Memento, so we can be sure that the contents
 * won't be torn or invalid, unless we make them that way. This class prevents
 * invalid states.
 */
export class StateManager {
    constructor(readonly extensionContext: vscode.ExtensionContext, readonly folder: vscode.WorkspaceFolder, private isMultiProject: boolean = false) {}

    private _get<T>(key: string, folderName: string, _isMultiProject?: boolean): T | undefined {
        return this.isMultiProject ? this.extensionContext.globalState.get<T>(this.folder.uri.fsPath + `${folderName} ` + key) : this.extensionContext.globalState.get<T>(this.folder.uri.fsPath + key);
    }

    private _update(key: string, value: any, folderName: string, _isMultiProject?: boolean): Thenable<void> {
        return  this.isMultiProject ? this.extensionContext.globalState.update(this.folder.uri.fsPath + `${folderName} `  + key, value) : this.extensionContext.globalState.update(this.folder.uri.fsPath + key, value);
    }

    setIsMultiProject(isMultiProject: boolean) {
        this.isMultiProject = isMultiProject;
    }

    /**
     * Whether the user chose to ignore the popup message about missing CMakeLists.txt
     * from the root folder, for a code base that is not fully activating CMake Tools.
     */
    getIgnoreCMakeListsMissing(folderName: string): boolean {
        return this._get<boolean>('ignoreCMakeListsMissing', folderName) || false;
    }

    async setIgnoreCMakeListsMissing(folderName: string, v: boolean) {
        await this._update('ignoreCMakeListsMissing', v, folderName);
    }

    /**
     * The name of the workspace-local active configure preset
     */
    getConfigurePresetName(folderName: string): string | null {
        return this._get<string>('configurePresetName', folderName) || null;
    }

    async setConfigurePresetName(folderName: string, v: string | null) {
        await this._update('configurePresetName', v, folderName);
    }

    private getCachedConfigurePresets(folderName: string): string[] {
        return this._get<string[]>('cachedConfigurePresets', folderName) || [];
    }

    private async addCachedConfigurePreset(folderName: string, preset: string) {
        const configurePresets = this.getCachedConfigurePresets(folderName);
        if (configurePresets.indexOf(preset) >= 0) {
            return;
        }
        configurePresets.push(preset);
        return this._update('cachedConfigurePresets', configurePresets, folderName);
    }

    private async clearCachedConfigurePresets(folderName: string) {
        const configurePresets = this.getCachedConfigurePresets(folderName);
        for (const preset of configurePresets) {
            await this.setBuildPresetName(folderName, preset, null);
            await this.setTestPresetName(folderName, preset, null);
        }
        return this._update('cachedConfigurePresets', null, folderName);
    }

    getBuildPresetName(folderName: string, configurePreset: string): string | null {
        return this._get<string>(`buildPreset for ${configurePreset}`, folderName) || null;
    }

    async setBuildPresetName(folderName: string, configurePreset: string, v: string | null) {
        await this.addCachedConfigurePreset(folderName, configurePreset);
        await this._update(`buildPreset for ${configurePreset}`, v, folderName);
    }

    getTestPresetName(folderName: string, configurePreset: string): string | null {
        return this._get<string>(`testPreset for ${configurePreset}`, folderName) || null;
    }

    async setTestPresetName(folderName: string, configurePreset: string, v: string | null) {
        await this.addCachedConfigurePreset(folderName, configurePreset);
        await this._update(`testPreset for ${configurePreset}`, v, folderName);
    }

    /**
     * The name of the workspace-local active kit.
     */
    getActiveKitName(folderName: string): string | null {
        return this._get<string>('activeKitName', folderName) || null;
    }

    async setActiveKitName(folderName: string, v: string | null) {
        await this._update('activeKitName', v, folderName);
    }

    /**
     * The currently select build target
     */
    getDefaultBuildTarget(folderName: string): string | null {
        return this._get<string>('activeBuildTarget', folderName) || null;
    }

    async setDefaultBuildTarget(folderName: string, v: string | null) {
        await this._update('activeBuildTarget', v, folderName);
    }

    getLaunchTargetName(folderName: string): string | null {
        return this._get<string>('launchTargetName', folderName) || null;
    }

    async setLaunchTargetName(folderName: string, t: string | null) {
        await this._update('launchTargetName', t, folderName);
    }

    /**
     * The keyword settings for the build variant
     */
    getActiveVariantSettings(folderName: string): Map<string, string> | null {
        const pairs = this._get<[string, string][]>('activeVariantSettings', folderName);
        if (pairs) {
            return new Map<string, string>(pairs);
        } else {
            return null;
        }
    }

    async setActiveVariantSettings(folderName: string, settings: Map<string, string> | null) {
        if (settings) {
            const pairs: [string, string][] = Array.from(settings.entries());
            await this._update('activeVariantSettings', pairs, folderName);
        } else {
            await this._update('activeVariantSettings', null, folderName);
        }
    }

    /**
     * Rest all current workspace state. Mostly for troubleshooting
     */
    async reset(folderName: string) {
        await this.setConfigurePresetName(folderName, null);
        await this.clearCachedConfigurePresets(folderName);
        await this.setActiveVariantSettings(folderName, null);
        await this.setLaunchTargetName(folderName, null);
        await this.setDefaultBuildTarget(folderName, null);
        await this.setActiveKitName(folderName, null);
        await this.setIgnoreCMakeListsMissing(folderName, false);
    }
}
