/**
 * Detect and control CMake's SARIF logging behavior.
 */ /** */

import * as path from 'path';

import * as util from '@cmt/util';

/**
 * CMake's command line option to specify a log path.
 */
const sarifOutputOption = '--sarif-output';

/**
 * CMake's default SARIF log path used when `CMAKE_EXPORT_SARIF` is enabled and
 * no path is specified via `--sarif-output`.
 */
export const defaultSarifRelativePath = path.join('.cmake', 'sarif', 'cmake.sarif');

/**
 * Get the SARIF output path specified by configure arguments, if any.
 */
export function sarifOutputPathFromArgs(args: string[]): string | undefined {
    let result: string | undefined;
    args.forEach((arg, index) => {
        if (arg.startsWith(`${sarifOutputOption}=`)) {
            result = arg.substring(sarifOutputOption.length + 1);
        } else if (arg === sarifOutputOption && index + 1 < args.length) {
            result = args[index + 1];
        }
    });
    return result;
}

/**
 * The cache variable that controls CMake's SARIF logging.
 */
export const exportSarifVariable = 'CMAKE_EXPORT_SARIF';

/**
 * Whether a `-U` glob expression unsets `CMAKE_EXPORT_SARIF`.
 */
function unsetPatternMatches(pattern: string): boolean {
    const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(exportSarifVariable);
}

/**
 * Whether the configure arguments explicitly set `CMAKE_EXPORT_SARIF` or not.
 */
export function argsSpecifyExportSarif(args: string[]): boolean {
    const definition = new RegExp(`^${exportSarifVariable}(:[^=]*)?=`);
    return args.some((arg, index) => {
        for (const flag of ['-D', '-U']) {
            if (!arg.startsWith(flag)) {
                continue;
            }
            const operand = arg === flag ? args[index + 1] : arg.substring(flag.length);
            if (operand === undefined) {
                continue;
            }
            if (flag === '-D' ? definition.test(operand) : unsetPatternMatches(operand)) {
                return true;
            }
        }
        return false;
    });
}

/**
 * Determine the location where CMake will write its SARIF log.
 *
 * @param args The configure arguments for the run
 * @param binaryDir The build directory for the run
 * @param cwd The directory CMake ran in, which `--sarif-output` may be relative to
 */
export function sarifLogPath(args: string[], binaryDir: string, cwd: string): string {
    const requestedPath = sarifOutputPathFromArgs(args);
    return requestedPath !== undefined
        ? util.resolvePath(requestedPath, cwd)
        : path.join(binaryDir, defaultSarifRelativePath);
}
