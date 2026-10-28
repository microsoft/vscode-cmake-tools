/**
 * What CMake is asked to do about its SARIF log, and where it will write it.
 * Nothing here reads the log or decides whether one exists — see
 * `watchSarifLog` in `@cmt/diagnostics/sarif` for that.
 */ /** */

import * as path from 'path';

import * as util from '@cmt/util';

/**
 * The option CMake accepts to name the SARIF log it writes.
 */
const sarifOutputOption = '--sarif-output';

/**
 * Where CMake writes its SARIF log, relative to the build directory, when
 * `CMAKE_EXPORT_SARIF` is on and no path of its own was named. CMake creates
 * the directory for it.
 */
export const defaultSarifRelativePath = path.join('.cmake', 'sarif', 'cmake.sarif');

/**
 * Find the path that the configure arguments already ask CMake to write its
 * SARIF log to.
 *
 * CMake accepts the option written either as `--sarif-output=<path>` or as
 * `--sarif-output <path>`, and when it is given more than once the last one
 * wins.
 *
 * @param args The configure arguments assembled so far
 * @returns The path as written — which may be relative to the directory CMake
 * runs in — or `undefined` when the option is absent
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
 * The cache variable that turns on CMake's SARIF log at its default location.
 */
export const exportSarifVariable = 'CMAKE_EXPORT_SARIF';

/**
 * Whether a `-U` glob expression, which CMake matches against cache variable
 * names with `*` and `?` wildcards, removes `CMAKE_EXPORT_SARIF`.
 */
function unsetPatternMatches(pattern: string): boolean {
    const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(exportSarifVariable);
}

/**
 * Find whether the configure arguments already decide `CMAKE_EXPORT_SARIF` —
 * setting it with `-D`, or removing it from the cache with `-U`, in either the
 * attached (`-DVAR=value`) or separate (`-D VAR=value`) form. When they do, the
 * extension leaves `CMAKE_EXPORT_SARIF` alone.
 *
 * `--sarif-output` deliberately does not count. It is a command line option,
 * not a cache variable: it only names where this one run writes its log, and
 * neither reads nor changes `CMAKE_EXPORT_SARIF` in the cache.
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
 * Work out where a configure run would leave its SARIF log.
 *
 * CMake writes the log wherever `--sarif-output` names; without that option it
 * writes to `<binaryDir>/.cmake/sarif/cmake.sarif`.
 *
 * This names the place to *look*. It is not a claim that a log is there —
 * whether CMake actually wrote one is settled by looking at the file itself,
 * never by predicting it from arguments or cache state. See
 * `watchSarifLog` for why that distinction matters.
 *
 * @param args The configure arguments for the run
 * @param binaryDir The build directory for the run
 * @param cwd The directory CMake ran in, which a relative `--sarif-output` is relative to
 */
export function sarifLogPath(args: string[], binaryDir: string, cwd: string): string {
    const requestedPath = sarifOutputPathFromArgs(args);
    return requestedPath !== undefined
        ? util.resolvePath(requestedPath, cwd)
        : path.join(binaryDir, defaultSarifRelativePath);
}
