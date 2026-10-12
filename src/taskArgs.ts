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
 * Extra args before their first `--` are inserted as `cmake --build`
 * arguments, i.e. before the generated build-tool-args separator. Extra args
 * after that separator are inserted after the generated separator and before
 * generated build-tool args. This ensures the merged command contains only one
 * CMake/build-tool boundary.
 *
 * @param args The generated build argument list.
 * @param extraArgs Additional arguments from the task definition.
 * @returns The argument list with the extra args merged in.
 */
export function mergeBuildArgs(args: string[], extraArgs: string[]): string[] {
    if (!extraArgs || extraArgs.length === 0) {
        return args;
    }

    const generatedSeparatorIndex = args.indexOf('--');
    const extraSeparatorIndex = extraArgs.indexOf('--');
    if (extraSeparatorIndex === -1) {
        if (generatedSeparatorIndex === -1) {
            return args.concat(extraArgs);
        }
        return [...args.slice(0, generatedSeparatorIndex), ...extraArgs, ...args.slice(generatedSeparatorIndex)];
    }

    const cmakeArgs = generatedSeparatorIndex === -1 ? args : args.slice(0, generatedSeparatorIndex);
    const generatedBuildToolArgs = generatedSeparatorIndex === -1 ? [] : args.slice(generatedSeparatorIndex + 1);
    const extraCMakeArgs = extraArgs.slice(0, extraSeparatorIndex);
    const extraBuildToolArgs = extraArgs.slice(extraSeparatorIndex + 1);
    return [...cmakeArgs, ...extraCMakeArgs, '--', ...extraBuildToolArgs, ...generatedBuildToolArgs];
}
