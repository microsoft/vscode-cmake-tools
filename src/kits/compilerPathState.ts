/**
 * Tri-state classification of whether a kit's compiler binary exists on disk.
 *
 * This is kept as a small, dependency-free module (no `vscode` import) so it can
 * be unit-tested directly, and so kit pruning is not coupled to any UI code.
 *
 * The distinction that matters is between a compiler that is *definitively*
 * absent and one whose existence we simply could not determine (for example
 * because the process ran out of file handles). Only the former should ever
 * cause CMake Tools to prompt the user to remove a kit.
 */
export type CompilerPathState = 'present' | 'absent' | 'unknown';

/**
 * Classify the result of probing for a compiler binary from the error (if any)
 * produced by an `fs.stat` lookup.
 *
 * - No error -> the binary is `present`.
 * - `ENOENT`/`ENOTDIR` -> the binary is definitively `absent`.
 * - Any other error (e.g. `EMFILE`, `ENFILE`, `EACCES`, `EPERM`, or an error
 *   with no `code`) -> `unknown`; the probe failed transiently and we must not
 *   treat the compiler as missing.
 */
export function classifyCompilerPathProbe(error: NodeJS.ErrnoException | null | undefined): CompilerPathState {
    if (!error) {
        return 'present';
    }
    return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'absent' : 'unknown';
}

/**
 * Classify the result of resolving a *relative* compiler name via the `which`
 * package.
 *
 * Unlike a direct `fs.stat`, the `which` package cannot distinguish a binary that
 * is genuinely not on `PATH` from one whose existence check failed transiently: it
 * swallows the underlying `isexe` error (e.g. `EMFILE`/`EACCES`) and rejects every
 * failure with a synthesized `ENOENT`. Its error `code` is therefore unreliable, so
 * we must NOT treat a `which` failure as proof of absence. Only a successful
 * resolution counts as `present`; any failure (or an empty resolution) is `unknown`,
 * so a transient error can never prompt removal of a valid kit. The trade-off is
 * that a genuinely-missing bare compiler name is not auto-pruned (kits normally
 * store absolute compiler paths, which use the reliable `fs.stat` path instead).
 *
 * @param error The error passed to the `which` callback, if any.
 * @param resolvedPath The path `which` resolved to, if it succeeded.
 */
export function classifyWhichResult(error: Error | null | undefined, resolvedPath: string | undefined): CompilerPathState {
    if (error) {
        return 'unknown';
    }
    return resolvedPath ? 'present' : 'unknown';
}
