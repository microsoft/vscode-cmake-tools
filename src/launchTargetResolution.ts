/**
 * Pure helper for coalescing launch-target preparation across a single launch/debug resolution.
 *
 * When a `${command:cmake.launchTargetPath}` (or `...Directory`/`...Filename`/`...Name`) variable is
 * resolved inside a `launch.json`, VS Code passes the enclosing launch configuration object as the
 * command argument, and passes the SAME object to every command variable in that one resolution
 * pass (a fresh object is used for each launch). That object identity lets us build the target at
 * most once per launch even when several such substitutions appear in the same configuration.
 *
 * Kept free of the `vscode` API so it can be unit-tested directly
 * (see test/unit-tests/backend/launch-target-resolution.test.ts).
 */

/**
 * Whether the value looks like a VS Code launch configuration object (has string `type` and
 * `request` fields). Only such objects are used as a coalescing key, so ordinary programmatic
 * command arguments (a folder string, a `{ folder, targetName }` object, etc.) are never coalesced.
 */
export function isLaunchConfigLike(arg: unknown): arg is object {
    return typeof arg === 'object'
        && arg !== null
        && typeof (arg as { type?: unknown }).type === 'string'
        && typeof (arg as { request?: unknown }).request === 'string';
}

/**
 * Cache key for a prepared launch target within a single resolution. The active launch target
 * (`undefined` name) must not collide with a real target that happens to be named `__active__`, so a
 * sentinel that cannot be a valid CMake target name is used for it.
 */
export function launchTargetCacheKey(name?: string): string {
    return name !== undefined ? `named:${name}` : 'active-launch-target';
}
