/**
 * Helper for deciding whether the project is built before running CTest, running CPack, or
 * refreshing the test list (`CMakeProject.preTest`).
 *
 * This module is intentionally free of any `vscode` dependency so the decision
 * logic can be unit tested directly.
 */

export type PreTestOperation = 'ctest' | 'cpack' | 'refreshTests';

/**
 * Running tests honors `cmake.buildBeforeRun`, the same setting the Test Explorer
 * already uses, so turning it off also stops `CMake: Run Tests` from building
 * first. The caller still configures the project when needed. Packaging needs
 * the build outputs and refreshing the test list is unchanged, so both keep
 * building first.
 *
 * @param operation The operation `preTest` is preparing for.
 * @param buildBeforeRun Value of `cmake.buildBeforeRun`.
 */
export function shouldBuildBeforeTestOperation(operation: PreTestOperation, buildBeforeRun: boolean): boolean {
    return operation !== 'ctest' || buildBeforeRun;
}
