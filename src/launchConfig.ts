/**
 * Type definitions for the `cmake.launchConfig` setting.
 *
 * Kept free of `vscode` imports so it can be consumed from backend unit
 * tests as well as from `src/config.ts` and `src/cmakeProject.ts`.
 */

export type LaunchConfigTaskRef = string | { name: string; type?: string };

export interface LaunchConfigEnvironmentEntry {
    name: string;
    value: string;
}

export interface LaunchConfig {
    task?: LaunchConfigTaskRef;
    program?: string;
    args?: string[];
    cwd?: string;
    environment?: LaunchConfigEnvironmentEntry[];
}

/**
 * Pure predicate: which mode the launch path should take given a
 * `LaunchConfig` value.  Lives here (not in `cmakeProject.ts`) so it can be
 * exercised by backend unit tests with no `vscode` dependency.
 *
 * - `'task'`    if `cfg.task` is set (task wins if both are set).
 * - `'program'` if only `cfg.program` is set.
 * - `'none'`    otherwise (including `undefined` and `{}`).
 */
export function selectMode(cfg: LaunchConfig | undefined): 'task' | 'program' | 'none' {
    if (cfg?.task) {
        return 'task';
    }
    if (cfg?.program) {
        return 'program';
    }
    return 'none';
}
