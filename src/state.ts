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

    private _get<T>(key: string): T | undefined {
        return this.extensionContext.globalState.get<T>(this.folder.uri.fsPath + key);
    }

    private _update(key: string, value: any): Thenable<void> {
        return this.extensionContext.globalState.update(this.folder.uri.fsPath + key, value);
    }

    /**
     * Whether the user chose to ignore the popup message about missing CMakeLists.txt
     * from the root folder, for a code base that is not fully activating CMake Tools.
     */
    get ignoreCMakeListsMissing(): boolean {
        return this._get<boolean>('ignoreCMakeListsMissing') || false;
    }

    async setIgnoreCMakeListsMissing(v: boolean) {
        await this._update('ignoreCMakeListsMissing', v);
    }

    /**
     * The name of the workspace-local active configure preset
     */
    get configurePresetName(): string | null {
        const preset = this._get<string>('configurePresetName');
        return preset || null;
    }

    async setConfigurePresetName(v: string | null) {
        await this._update('configurePresetName', v);
    }

    private get cachedConfigurePresets(): string[] {
        return this._get<string[]>('cachedConfigurePresets') || [];
    }

    private async addCachedConfigurePreset(preset: string) {
        const configurePresets = this.cachedConfigurePresets;
        if (configurePresets.indexOf(preset) >= 0) {
            return;
        }
        configurePresets.push(preset);
        return this._update('cachedConfigurePresets', configurePresets);
    }

    private async clearCachedConfigurePresets() {
        const configurePresets = this.cachedConfigurePresets;
        for (const preset of configurePresets) {
            await this.setBuildPresetName(preset, null);
            await this.setTestPresetName(preset, null);
        }
        return this._update('cachedConfigurePresets', null);
    }

    getBuildPresetName(configurePreset: string): string | null {
        return this._get<string>(`buildPreset for ${configurePreset}`) || null;
    }

    async setBuildPresetName(configurePreset: string, v: string | null) {
        await this.addCachedConfigurePreset(configurePreset);
        await this._update(`buildPreset for ${configurePreset}`, v);
    }

    getTestPresetName(configurePreset: string): string | null {
        return this._get<string>(`testPreset for ${configurePreset}`) || null;
    }

    async setTestPresetName(configurePreset: string, v: string | null) {
        await this.addCachedConfigurePreset(configurePreset);
        await this._update(`testPreset for ${configurePreset}`, v);
    }

    /**
     * The name of the workspace-local active kit.
     */
    get activeKitName(): string | null {
        const kit = this._get<string>('activeKitName');
        return kit || null;
    }

    async setActiveKitName(v: string | null) {
        await this._update('activeKitName', v);
    }

    /**
     * The currently select build target
     */
    get defaultBuildTarget(): string | null {
        const target = this._get<string>('activeBuildTarget');
        return target || null;
    }

    async setDefaultBuildTarget(s: string | null) {
        await this._update('activeBuildTarget', s);
    }

    get launchTargetName(): string | null {
        const name = this._get<string>('launchTargetName');
        return name || null;
    }

    async setLaunchTargetName(t: string | null) {
        await this._update('launchTargetName', t);
    }

    /**
     * The keyword settings for the build variant
     */
    get activeVariantSettings(): Map<string, string> | null {
        const pairs = this._get<[string, string][]>('activeVariantSettings');
        if (pairs) {
            return new Map<string, string>(pairs);
        } else {
            return null;
        }
    }

    async setActiveVariantSettings(settings: Map<string, string> | null) {
        if (settings) {
            const pairs: [string, string][] = Array.from(settings.entries());
            await this._update('activeVariantSettings', pairs);
        } else {
            await this._update('activeVariantSettings', null);
        }
    }

    /**
     * Rest all current workspace state. Mostly for troubleshooting
     */
    async reset() {
        await this.setConfigurePresetName(null);
        await this.clearCachedConfigurePresets();
        await this.setActiveVariantSettings(null);
        await this.setLaunchTargetName(null);
        await this.setDefaultBuildTarget(null);
        await this.setActiveKitName(null);
        await this.setIgnoreCMakeListsMissing(false);
    }
}
