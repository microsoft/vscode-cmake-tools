/** Pure activation-policy helpers, kept `vscode`-free so they run under `yarn backendTests`. */

/** Show the "initializing" placeholder only when there is a CMake project and the project UI is not disabled. */
export function shouldShowInitializingView(hasCMakeProject: boolean, languageServerOnlyMode: boolean): boolean {
    return hasCMakeProject && !languageServerOnlyMode;
}

/**
 * Whether a filesystem error while probing for `CMakeLists.txt` means the file is definitively absent.
 * Only `ENOENT`/`ENOTDIR` qualify; transient errors (e.g. `EMFILE`) must fail open so the placeholder
 * still shows under file-handle exhaustion.
 */
export function isDefinitivelyAbsentError(code: string | undefined): boolean {
    return code === 'ENOENT' || code === 'ENOTDIR';
}
