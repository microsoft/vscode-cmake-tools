/**
 * Helper for deciding at which log level a build output line should be logged,
 * based on `cmake.logBuildOutputBySeverity` and any diagnostic severity parsed
 * from the line.
 *
 * This module is intentionally free of any `vscode` dependency so the decision
 * logic can be unit tested directly.
 */

export type BuildLogMethod = 'info' | 'error' | 'warning' | 'debug';

/**
 * Resolve the logger method to use for a build output line.
 *
 * When `logBySeverity` is false (the default), standard output is logged as
 * `info` and standard error as `error` (the historical behavior). When it is
 * true, a line that parsed as an error/warning diagnostic is logged at the
 * matching level, unclassified standard error stays at `error` so genuine
 * failures remain visible, and routine standard output is demoted to `debug`
 * so it can be filtered out via `cmake.loggingLevel`.
 *
 * @param severity The diagnostic severity parsed from the line, if any.
 * @param isStdErr Whether the line came from standard error.
 * @param logBySeverity Value of `cmake.logBuildOutputBySeverity`.
 */
export function resolveBuildLogMethod(severity: string | undefined, isStdErr: boolean, logBySeverity: boolean): BuildLogMethod {
    if (!logBySeverity) {
        return isStdErr ? 'error' : 'info';
    }
    switch (severity) {
        case 'warning':
            return 'warning';
        case 'error':
        case 'fatal error':
        case 'catastrophic error':
            return 'error';
        default:
            return isStdErr ? 'error' : 'debug';
    }
}
