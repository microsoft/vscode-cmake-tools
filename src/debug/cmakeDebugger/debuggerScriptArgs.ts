/**
 * Helpers for composing the `cmake -P` command line used to debug a CMake script.
 *
 * This module is intentionally free of any `vscode` dependency so the argument
 * ordering can be unit tested directly.
 */

/**
 * Build the argument list for running a CMake script with the debugger attached.
 *
 * CMake only honors options such as `-D` in script mode when they come before
 * `-P <script>`, so `cmakeArgs` are placed first. `scriptArgs` follow the script
 * path and are available to the script via `CMAKE_ARGV<n>`.
 *
 * @param scriptPath The path to the CMake script to execute.
 * @param cmakeArgs Arguments for CMake itself, placed before `-P`.
 * @param scriptArgs Arguments for the script, placed after the script path.
 * @param pipeName The pipe or domain socket used for debugger communication.
 * @param dapLog Optional path where the debugger DAP log should be written.
 * @returns The argument list to pass to the CMake executable.
 */
export function buildScriptDebuggerArgs(scriptPath: string, cmakeArgs: string[], scriptArgs: string[], pipeName: string, dapLog?: string): string[] {
    const args = [...cmakeArgs, "-P", scriptPath, ...scriptArgs, "--debugger", "--debugger-pipe", pipeName];
    if (dapLog) {
        args.push("--debugger-dap-log", dapLog);
    }
    return args;
}
