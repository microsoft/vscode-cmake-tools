/**
 * Pure activation policy helpers.
 *
 * This module is intentionally free of any `vscode` (or other heavy transitive)
 * dependency so it can be exercised directly by backend unit tests
 * (`yarn backendTests`).
 */

/**
 * Decide whether the transient "initializing" placeholder view should be shown in
 * the CMake activity-bar container during extension activation.
 *
 * The placeholder makes the CMake sidebar visible immediately instead of staying
 * hidden for the entire (potentially slow) activation. It is only meaningful when
 * there is a CMake project to initialize and the project UI is not intentionally
 * hidden.
 *
 * @param hasCMakeProject Whether the workspace has at least one CMake project — a
 *        non-excluded workspace folder whose configured source directory contains a
 *        `CMakeLists.txt`.
 * @param languageServerOnlyMode Whether the extension is running in
 *        language-server-only mode, where the project UI (activity-bar views,
 *        commands, status bar) is intentionally absent.
 * @returns `true` when the placeholder should be shown.
 */
export function shouldShowInitializingView(hasCMakeProject: boolean, languageServerOnlyMode: boolean): boolean {
    return hasCMakeProject && !languageServerOnlyMode;
}

/**
 * Classify a filesystem error encountered while probing for a project's
 * `CMakeLists.txt` during the activation preflight.
 *
 * Only `ENOENT` (no such file or directory) and `ENOTDIR` (a path component is not a
 * directory) definitively mean the file is absent. Every other error — notably
 * `EMFILE`/`ENFILE` (file-handle exhaustion) and `EACCES` — is transient or ambiguous.
 * The preflight must treat those as "unknown" and fail open (show the inert
 * placeholder), because they occur in exactly the resource-starved environments where
 * the sidebar would otherwise stay hidden for minutes.
 *
 * @param code The `code` of a Node.js filesystem error (e.g. `NodeJS.ErrnoException.code`).
 * @returns `true` only when the error definitively means the file is absent.
 */
export function isDefinitivelyAbsentError(code: string | undefined): boolean {
    return code === 'ENOENT' || code === 'ENOTDIR';
}
