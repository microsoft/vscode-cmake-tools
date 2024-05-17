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
    constructor(readonly extensionContext: vscode.ExtensionContext, readonly folder: vscode.WorkspaceFolder) {}

    private _get<T>(key: string, folderName: string, isMultiProject: boolean): T | undefined {
        return isMultiProject ? this.extensionContext.globalState.get<T>(this.folder.uri.fsPath + `${folderName} ` + key) : this.extensionContext.globalState.get<T>(this.folder.uri.fsPath + key);
    }

    private _update(key: string, value: any, folderName: string, isMultiProject: boolean): Thenable<void> {
        return  isMultiProject ? this.extensionContext.globalState.update(this.folder.uri.fsPath + `${folderName} `  + key, value) : this.extensionContext.globalState.update(this.folder.uri.fsPath + key, value);
    }

    /**
     * Whether the user chose to ignore the popup message about missing CMakeLists.txt
     * from the root folder, for a code base that is not fully activating CMake Tools.
     */
    getIgnoreCMakeListsMissing(folderName: string, isMultiProject: boolean): boolean {
        return this._get<boolean>('ignoreCMakeListsMissing', folderName, isMultiProject) || false;
    }

    async setIgnoreCMakeListsMissing(folderName: string, v: boolean, isMultiProject: boolean) {
        await this._update('ignoreCMakeListsMissing', v, folderName, isMultiProject);
    }

    /**
     * The name of the workspace-local active configure preset
     */
    getConfigurePresetName(folderName: string, isMultiProject: boolean): string | null {
        return this._get<string>('configurePresetName', folderName, isMultiProject) || null;
    }

    async setConfigurePresetName(folderName: string, v: string | null, isMultiProject: boolean) {
        await this._update('configurePresetName', v, folderName, isMultiProject);
    }

    private getCachedConfigurePresets(folderName: string, isMultiProject: boolean): string[] {
        return this._get<string[]>('cachedConfigurePresets', folderName, isMultiProject) || [];
    }

    private async addCachedConfigurePreset(folderName: string, preset: string, isMultiProject: boolean) {
        const configurePresets = this.getCachedConfigurePresets(folderName, isMultiProject);
        if (configurePresets.indexOf(preset) >= 0) {
            return;
        }
        configurePresets.push(preset);
        return this._update('cachedConfigurePresets', configurePresets, folderName, isMultiProject);
    }

    private async clearCachedConfigurePresets(folderName: string, isMultiProject: boolean) {
        const configurePresets = this.getCachedConfigurePresets(folderName, isMultiProject);
        for (const preset of configurePresets) {
            await this.setBuildPresetName(folderName, preset, null, isMultiProject);
            await this.setTestPresetName(folderName, preset, null, isMultiProject);
            await this.setPackagePresetName(folderName, preset, null, isMultiProject);
            await this.setWorkflowPresetName(folderName, preset, null, isMultiProject);
        }
        return this._update('cachedConfigurePresets', null, folderName, isMultiProject);
    }

    getBuildPresetName(folderName: string, configurePreset: string, isMultiProject: boolean): string | null {
        return this._get<string>(`buildPreset for ${configurePreset}`, folderName, isMultiProject) || null;
    }

    async setBuildPresetName(folderName: string, configurePreset: string, v: string | null, isMultiProject: boolean) {
        await this.addCachedConfigurePreset(folderName, configurePreset, isMultiProject);
        await this._update(`buildPreset for ${configurePreset}`, v, folderName, isMultiProject);
    }

    getTestPresetName(folderName: string, configurePreset: string, isMultiProject: boolean): string | null {
        return this._get<string>(`testPreset for ${configurePreset}`, folderName, isMultiProject) || null;
    }

    async setTestPresetName(folderName: string, configurePreset: string, v: string | null, isMultiProject: boolean) {
        await this.addCachedConfigurePreset(folderName, configurePreset, isMultiProject);
        await this._update(`testPreset for ${configurePreset}`, v, folderName, isMultiProject);
    }

    getPackagePresetName(folderName: string, configurePreset: string, isMultiProject: boolean): string | null {
        return this._get<string>(`packagePreset for ${configurePreset}`, folderName, isMultiProject) || null;
    }

    async setPackagePresetName(folderName: string, configurePreset: string, v: string | null, isMultiProject: boolean) {
        await this.addCachedConfigurePreset(folderName, configurePreset, isMultiProject);
        await this._update(`packagePreset for ${configurePreset}`, v, folderName, isMultiProject);
    }

    getWorkflowPresetName(folderName: string, configurePreset: string, isMultiProject: boolean): string | null {
        return this._get<string>(`workflowPreset for ${configurePreset}`, folderName, isMultiProject) || null;
    }

    async setWorkflowPresetName(folderName: string, configurePreset: string, v: string | null, isMultiProject: boolean) {
        await this.addCachedConfigurePreset(folderName, configurePreset, isMultiProject);
        await this._update(`workflowPreset for ${configurePreset}`, v, folderName, isMultiProject);
    }

    /**
     * The name of the workspace-local active kit.
     */
    getActiveKitName(folderName: string, isMultiProject: boolean): string | null {
        return this._get<string>('activeKitName', folderName, isMultiProject) || null;
    }

    async setActiveKitName(folderName: string, v: string | null, isMultiProject: boolean) {
        await this._update('activeKitName', v, folderName, isMultiProject);
    }

    /**
     * The currently select build target
     */
    getDefaultBuildTarget(folderName: string, isMultiProject: boolean): string | null {
        return this._get<string>('activeBuildTarget', folderName, isMultiProject) || null;
    }

    async setDefaultBuildTarget(folderName: string, v: string | null, isMultiProject: boolean) {
        await this._update('activeBuildTarget', v, folderName, isMultiProject);
    }

    getLaunchTargetName(folderName: string, isMultiProject: boolean): string | null {
        return this._get<string>('launchTargetName', folderName, isMultiProject) || null;
    }

    async setLaunchTargetName(folderName: string, t: string | null, isMultiProject: boolean) {
        await this._update('launchTargetName', t, folderName, isMultiProject);
    }

    /**
     * The keyword settings for the build variant
     */
    getActiveVariantSettings(folderName: string, isMultiProject: boolean): Map<string, string> | null {
        const pairs = this._get<[string, string][]>('activeVariantSettings', folderName, isMultiProject);
        if (pairs) {
            return new Map<string, string>(pairs);
        } else {
            return null;
        }
    }

    async setActiveVariantSettings(folderName: string, settings: Map<string, string> | null, isMultiProject: boolean) {
        if (settings) {
            const pairs: [string, string][] = Array.from(settings.entries());
            await this._update('activeVariantSettings', pairs, folderName, isMultiProject);
        } else {
            await this._update('activeVariantSettings', null, folderName, isMultiProject);
        }
    }

    /**
     * Rest all current workspace state. Mostly for troubleshooting
     */
    async reset(folderName: string, isMultiProject: boolean) {
        await this.setConfigurePresetName(folderName, null, isMultiProject);
        await this.clearCachedConfigurePresets(folderName, isMultiProject);
        await this.setActiveVariantSettings(folderName, null, isMultiProject);
        await this.setLaunchTargetName(folderName, null, isMultiProject);
        await this.setDefaultBuildTarget(folderName, null, isMultiProject);
        await this.setActiveKitName(folderName, null, isMultiProject);
        await this.setIgnoreCMakeListsMissing(folderName, false, isMultiProject);
    }
}
