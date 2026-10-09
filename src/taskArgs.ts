/**
 * Helpers for composing `cmake --build` argument lists for the task provider.
 *
 * This module is intentionally free of any `vscode` dependency so the merge
 * logic can be unit tested directly.
 */

/**
 * Merge user-provided task `args` into a generated `cmake --build` argument
 * list.
 *
 * The extra args are inserted as `cmake --build` arguments, i.e. before the
 * `--` build-tool-args separator when one is present, so flags such as `-j` or
 * `--clean-first` reach CMake rather than the underlying build tool. When there
 * is no `--` separator, the extra args are appended at the end.
 *
 * @param args The generated build argument list.
 * @param extraArgs Additional arguments from the task definition.
 * @returns A new argument list with the extra args merged in.
 */
export function mergeBuildArgs(args: string[], extraArgs: string[]): string[] {
    if (!extraArgs || extraArgs.length === 0) {
        return args;
    }
    const separatorIndex: number = args.indexOf('--');
    if (separatorIndex === -1) {
        return args.concat(extraArgs);
    }
    return [...args.slice(0, separatorIndex), ...extraArgs, ...args.slice(separatorIndex)];
}
