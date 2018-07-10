import * as vscode from 'vscode';

/**
 * Key strings for the various state objects we maintain
 */
enum StateKey {
  ActiveKitName = 'activeKitName',
  ActiveBuildTarget = 'activeBuildTarget',
  LaunchTargetName = 'launchTargetName',
  ActiveVariantSettings = 'activeVariantSettings',
}

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
  constructor(
      /**
       * The extension context
       */
      readonly extensionContext: vscode.ExtensionContext,
      /**
       * A qualifier string, to ensure that multiple StateManager instances in the
       * same workspace can write and maintain different state keys.
       */
      readonly qualifierString: string = '__default__',
  ) {}

  private _get<T>(key: string): T|undefined;
  private _get<T, U>(key: string, default_: U): T|U;
  private _get<T, U>(key: string, default_?: U): T|U|undefined {
    const qual_key = `${this.qualifierString}/${key}`;
    const value = this.extensionContext.workspaceState.get<T>(qual_key);
    if (value === undefined) {
      return default_;
    }
    return value;
  }

  private _set<T>(key: string, value: T): Thenable<void> {
    const qual_key = `${this.qualifierString}/${key}`;
    return this.extensionContext.workspaceState.update(qual_key, value);
  }

  /**
   * The name of the workspace-local active kit.
   */
  get activeKitName(): string|null { return this._get<string, null>(StateKey.ActiveKitName, null); }
  setActiveKitName(v: string|null) { return this._set(StateKey.ActiveKitName, v); }

  /**
   * The currently select build target
   */
  get defaultBuildTarget(): string|null { return this._get<string, null>(StateKey.ActiveBuildTarget, null); }
  setDefaultBuildTarget(s: string|null) { return this._set(StateKey.ActiveBuildTarget, s); }

  get launchTargetName(): string|null { return this._get<string, null>(StateKey.LaunchTargetName, null); }
  setLaunchTargetName(t: string|null) { return this._set(StateKey.LaunchTargetName, t); }

  /**
   * The keyword settings for the build variant
   */
  get activeVariantSettings(): Map<string, string>|null {
    const pairs = this._get<[string, string][]>(StateKey.ActiveVariantSettings);
    if (pairs) {
      return new Map<string, string>(pairs);
    } else {
      return null;
    }
  }
  setActiveVariantSettings(settings: Map<string, string>|null) {
    if (settings) {
      const pairs: [string, string][] = Array.from(settings.entries());
      return this._set(StateKey.ActiveVariantSettings, pairs);
    } else {
      return this._set(StateKey.ActiveVariantSettings, null);
    }
  }

  /**
   * Rest all current workspace state. Mostly for troubleshooting
   */
  async reset() {
    await this.setActiveVariantSettings(null);
    await this.setLaunchTargetName(null);
    await this.setDefaultBuildTarget(null);
    await this.setActiveKitName(null);
  }
}
