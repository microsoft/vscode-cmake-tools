/**
 * Pure, dependency-free decision helpers that classify whether an on-open / automatic CMake
 * Tools startup prompt should surface as an interrupting quick pick, a non-modal notification,
 * or nothing at all.
 *
 * These are factored out of `extension.ts` / `cmakeProject.ts` (which transitively import
 * `vscode`) so they can be unit-tested without a VS Code instance. See
 * `test/unit-tests/backend/startupPromptDecisions.test.ts`.
 *
 * Background (issue #4988's sibling, issue #5000): VS Code's quick input is a single shared
 * "last-caller-wins" widget with no queuing, so opening a quick pick during activation cancels
 * whatever quick pick the user currently has on screen (e.g. the F1 command palette). The rule
 * these helpers encode is: an *automatic* (no user gesture) startup path must never open a quick
 * pick — it defers to a non-modal notification instead — while explicit, user-initiated paths
 * keep their existing quick-pick behavior.
 */

/** What to do when the workspace root has no CMakeLists.txt but a nested one exists. */
export type MissingCMakeListsAction = 'none' | 'quickpick' | 'notification';

/** What to do when ensuring an active configure preset (presets mode) or kit (kits mode). */
export type PresetOrKitAction =
    | 'ok'                          // A preset/kit is already selected; nothing to prompt.
    | 'setUnspecified'             // Kits mode: silently adopt the Unspecified kit (no prompt).
    | 'quickpickConfigurePreset'   // Explicit gesture: open the configure-preset quick pick.
    | 'quickpickKit'               // Explicit gesture: open the kit quick pick.
    | 'notificationConfigurePreset'// Automatic: defer to a non-modal "select a configure preset" notification.
    | 'notificationKit';           // Automatic: defer to a non-modal "select a kit" notification.

/**
 * Decide how to surface a missing-root-CMakeLists.txt selection.
 *
 * @param isAutomatic Whether this was reached from an automatic on-open path (no user gesture).
 * @param isConfiguring Whether an explicit configure is in progress (a user gesture).
 * @param configureOnOpen The `cmake.configureOnOpen` setting value.
 */
export function decideMissingCMakeListsAction(isAutomatic: boolean, isConfiguring: boolean, configureOnOpen: boolean): MissingCMakeListsAction {
    if (isAutomatic) {
        // On-open with no user gesture: never steal the shared quick input. Only surface a
        // non-modal notification when the user actually wants configure-on-open behavior.
        return configureOnOpen ? 'notification' : 'none';
    }
    // Explicit configure / user gesture: preserve the existing direct quick pick.
    return (isConfiguring || configureOnOpen) ? 'quickpick' : 'none';
}

/**
 * Decide how to surface a missing configure-preset (presets mode) or kit (kits mode).
 *
 * @param isAutomatic Whether this was reached from an automatic on-open configure (no user gesture).
 * @param useCMakePresets Whether the project is in presets mode.
 * @param hasSelection Whether a configure preset (presets mode) or active kit (kits mode) is already set.
 * @param enableAutomaticKitScan The `cmake.enableAutomaticKitScan` setting value (kits mode only).
 * @param hasCMakeLists Whether a CMakeLists.txt exists for the project (kits mode only).
 */
export function decideEnsurePresetOrKitAction(isAutomatic: boolean, useCMakePresets: boolean, hasSelection: boolean, enableAutomaticKitScan: boolean, hasCMakeLists: boolean): PresetOrKitAction {
    if (useCMakePresets) {
        if (hasSelection) {
            return 'ok';
        }
        return isAutomatic ? 'notificationConfigurePreset' : 'quickpickConfigurePreset';
    }

    // Kits mode.
    if (hasSelection) {
        return 'ok';
    }
    // No kit selected, but either automatic kit scanning is off or there is no CMakeLists.txt
    // (e.g. an empty workspace from Quick Start): silently opt out via the Unspecified kit,
    // exactly as before — no prompt of any kind.
    if (!enableAutomaticKitScan || !hasCMakeLists) {
        return 'setUnspecified';
    }
    return isAutomatic ? 'notificationKit' : 'quickpickKit';
}
