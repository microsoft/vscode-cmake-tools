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

    private _get<T>(key: string): T | undefined {
        return this.extensionContext.globalState.get<T>(this.folder.uri.fsPath + key);
    }

    private _update(key: string, value: any): Thenable<void> {
        return this.extensionContext.globalState.update(this.folder.uri.fsPath + key, value);
    }

    setIsMultiProject(isMultiProject: boolean) {
        this.isMultiProject = isMultiProject;
    }

    /**
     * Whether the user chose to ignore the popup message about missing CMakeLists.txt
     * from the root folder, for a code base that is not fully activating CMake Tools.
     */
    getIgnoreCMakeListsMissing(folderName: string): boolean {
        return this.isMultiProject ? (this._get<boolean>(`${folderName} ignoreCMakeListsMissing`) || false) :
            (this._get<boolean>('ignoreCMakeListsMissing') || false);
    }

    async setIgnoreCMakeListsMissing(folderName: string, v: boolean) {
        if (this.isMultiProject) {
            await this._update(`${folderName} ignoreCMakeListsMissing`, v);
        } else {
            await this._update('ignoreCMakeListsMissing', v);
        }
    }

    /**
     * The name of the workspace-local active configure preset
     */
    getConfigurePresetName(folderName: string): string | null {
        const preset = this.isMultiProject ? this._get<string>(`${folderName} configurePresetName`) : this._get<string>('configurePresetName');
        return preset || null;
    }

    async setConfigurePresetName(folderName: string, v: string | null) {
        if (this.isMultiProject) {
            await this._update(`${folderName} configurePresetName`, v);
        } else {
            await this._update('configurePresetName', v);
        }
    }

    private getCachedConfigurePresets(folderName: string): string[] {
        return this.isMultiProject ? (this._get<string[]>(`${folderName} cachedConfigurePresets`) || []) :
            (this._get<string[]>('cachedConfigurePresets') || []);
    }

    private async addCachedConfigurePreset(folderName: string, preset: string) {
        const configurePresets = this.getCachedConfigurePresets(folderName);
        if (configurePresets.indexOf(preset) >= 0) {
            return;
        }
        configurePresets.push(preset);
        return this.isMultiProject ? this._update(`${folderName} cachedConfigurePresets`, configurePresets) :
            this._update('cachedConfigurePresets', configurePresets);
    }

    private async clearCachedConfigurePresets(folderName: string) {
        const configurePresets = this.getCachedConfigurePresets(folderName);
        for (const preset of configurePresets) {
            await this.setBuildPresetName(folderName, preset, null);
            await this.setTestPresetName(folderName, preset, null);
        }
        return this.isMultiProject ? this._update(`${folderName} cachedConfigurePresets`, null) :
            this._update('cachedConfigurePresets', null);
    }

    getBuildPresetName(folderName: string, configurePreset: string): string | null {
        return this.isMultiProject ? (this._get<string>(`${folderName} buildPreset for ${configurePreset}`) || null) :
            (this._get<string>(`buildPreset for ${configurePreset}`) || null);
    }

    async setBuildPresetName(folderName: string, configurePreset: string, v: string | null) {
        await this.addCachedConfigurePreset(folderName, configurePreset);
        if (this.isMultiProject) {
            await this._update(`${folderName} buildPreset for ${configurePreset}`, v);
        } else {
            await this._update(`buildPreset for ${configurePreset}`, v);
        }
    }

    getTestPresetName(folderName: string, configurePreset: string): string | null {
        return this.isMultiProject ? (this._get<string>(`${folderName} testPreset for ${configurePreset}`) || null) :
            (this._get<string>(`testPreset for ${configurePreset}`) || null);
    }

    async setTestPresetName(folderName: string, configurePreset: string, v: string | null) {
        await this.addCachedConfigurePreset(folderName, configurePreset);
        if (this.isMultiProject) {
            await this._update(`${folderName} testPreset for ${configurePreset}`, v);
        } else {
            await this._update(`testPreset for ${configurePreset}`, v);
        }
    }

    /**
     * The name of the workspace-local active kit.
     */
    getActiveKitName(folderName: string): string | null {
        const kit = this.isMultiProject ? this._get<string>(`${folderName} activeKitName`) : this._get<string>('activeKitName');
        return kit || null;
    }

    async setActiveKitName(folderName: string, v: string | null) {
        if (this.isMultiProject) {
            await this._update(`${folderName} activeKitName`, v);
        } else {
            await this._update('activeKitName', v);
        }
    }

    /**
     * The currently select build target
     */
    getDefaultBuildTarget(folderName: string): string | null {
        const target = this.isMultiProject ? this._get<string>(`${folderName} activeBuildTarget`) : this._get<string>('activeBuildTarget');
        return target || null;
    }

    async setDefaultBuildTarget(folderName: string, v: string | null) {
        if (this.isMultiProject) {
            await this._update(`${folderName} activeBuildTarget`, v);
        } else {
            await this._update('activeBuildTarget', v);
        }
    }

    getLaunchTargetName(folderName: string): string | null {
        const name = this.isMultiProject ? this._get<string>(`${folderName} launchTargetName`) : this._get<string>('launchTargetName');
        return name || null;
    }

    async setLaunchTargetName(folderName: string, t: string | null) {
        if (this.isMultiProject) {
            await this._update(`${folderName} launchTargetName`, t);
        } else {
            await this._update('launchTargetName', t);
        }
    }

    /**
     * The keyword settings for the build variant
     */
    getActiveVariantSettings(folderName: string): Map<string, string> | null {
        const pairs = this.isMultiProject ? this._get<[string, string][]>(`${folderName} activeVariantSettings`) :
            this._get<[string, string][]>('activeVariantSettings');
        if (pairs) {
            return new Map<string, string>(pairs);
        } else {
            return null;
        }
    }

    async setActiveVariantSettings(folderName: string, settings: Map<string, string> | null) {
        if (settings) {
            const pairs: [string, string][] = Array.from(settings.entries());
            if (this.isMultiProject) {
                await this._update(`${folderName} activeVariantSettings`, pairs);
            } else {
                await this._update('activeVariantSettings', pairs);
            }
        } else {
            if (this.isMultiProject) {
                await this._update(`${folderName} activeVariantSettings`, null);
            } else {
                await this._update('activeVariantSettings', null);
            }
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
