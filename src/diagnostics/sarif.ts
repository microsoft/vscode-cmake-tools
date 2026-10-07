/**
 * Ingestion of CMake configure diagnostics from a SARIF log
 */ /** */

import * as path from 'path';
import type * as Sarif from 'sarif';
import * as vscode from 'vscode';

import { diagnosticSeverity, FileDiagnostic, oneLess } from '@cmt/diagnostics/util';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as util from '@cmt/util';

const log = logging.createLogger('sarif');

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
 * attached (`-DVAR=value`) or separate (`-D VAR=value`) form.
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
 * Find whether the configure arguments put SARIF logging in the user's hands,
 * either by naming a log with `--sarif-output` or by deciding
 * `CMAKE_EXPORT_SARIF` themselves. When they do, the extension leaves
 * `CMAKE_EXPORT_SARIF` alone.
 */
export function argsControlSarif(args: string[]): boolean {
    return sarifOutputPathFromArgs(args) !== undefined || argsSpecifyExportSarif(args);
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
 * `CMakeSarifConsumer` for why that distinction matters.
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

/**
 * Resolve a SARIF artifact location to a path on disk. CMake writes plain
 * absolute paths, but the SARIF specification also permits `file:` URIs and
 * paths relative to the project.
 */
function artifactFilePath(artifact: Sarif.ArtifactLocation | undefined, sourceDir: string): string | undefined {
    const uri = artifact?.uri;
    if (!uri) {
        return undefined;
    }
    return util.resolvePath(uri.startsWith('file:') ? vscode.Uri.parse(uri).fsPath : uri, sourceDir);
}

/**
 * Convert a SARIF region into a range. CMake reports only the line that raised
 * the diagnostic, so whatever the region leaves out spans the whole line, just
 * as it does when the same diagnostic is parsed out of CMake's output.
 *
 * Returns `undefined` when the region does not place the diagnostic on a line.
 * CMake omits the region whenever it has no line to report — a diagnostic
 * raised while a list file was being read rather than by a command in it (the
 * ones CMake prints as `CMake Error in CMakeLists.txt:` rather than `at
 * CMakeLists.txt:12`), a deferred call, or a `variable_watch` dispatch. The
 * file is known; the line genuinely is not. See `parseSarifLog` for what
 * becomes of those.
 */
function sarifRange(region: Sarif.Region | undefined): vscode.Range | undefined {
    // SARIF line numbers are one-based, so anything below 1 is not a line
    // either.
    if (region?.startLine === undefined || region.startLine < 1) {
        return undefined;
    }
    const startLine = oneLess(region.startLine);
    const startColumn = region.startColumn === undefined ? 0 : oneLess(region.startColumn);
    const endLine = region.endLine === undefined ? startLine : oneLess(region.endLine);
    // SARIF's `endColumn` names the column *after* the region, so making it
    // zero-based also makes it the exclusive end that `Range` wants.
    const endColumn = region.endColumn === undefined ? 9999 : oneLess(region.endColumn);
    return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function sarifSeverity(level: Sarif.Result.level | undefined): vscode.DiagnosticSeverity {
    switch (level) {
        case undefined:
            // A result that carries no level is a warning, per the SARIF spec.
            return vscode.DiagnosticSeverity.Warning;
        case 'none':
            return vscode.DiagnosticSeverity.Information;
        default:
            return diagnosticSeverity(level) ?? vscode.DiagnosticSeverity.Warning;
    }
}

/**
 * Collect the locations that surround a result: the call stack that reached it,
 * which is how CMake's "Call Stack (most recent call first):" output is
 * recorded in SARIF, followed by any other locations the result points at.
 */
function relatedInformation(result: Sarif.Result, sourceDir: string): vscode.DiagnosticRelatedInformation[] {
    const locations: Sarif.Location[] = [];
    for (const stack of result.stacks ?? []) {
        for (const frame of stack.frames) {
            if (frame.location) {
                locations.push(frame.location);
            }
        }
    }
    locations.push(...(result.relatedLocations ?? []));

    const related: vscode.DiagnosticRelatedInformation[] = [];
    for (const location of locations) {
        const filepath = artifactFilePath(location.physicalLocation?.artifactLocation, sourceDir);
        // A frame with no line of its own — a deferred call, say — is dropped
        // for the same reason `parseSarifLog` drops such a result: there is
        // nowhere truthful to point it at. CMake's output is read the same
        // way, its call-stack parser matching only `<file>:<line> (<command>)`.
        const range = sarifRange(location.physicalLocation?.region);
        if (filepath && range) {
            related.push(new vscode.DiagnosticRelatedInformation(
                new vscode.Location(vscode.Uri.file(filepath), range),
                location.message?.text ?? ''));
        }
    }
    return related;
}

/**
 * Convert the results recorded in a SARIF log into diagnostics.
 *
 * A result is skipped unless it names both a file and a line within it.
 *
 * Skipping the ones with no file at all is obvious enough — VS Code has
 * nowhere to put them. Skipping the ones that name a file but no line is the
 * less obvious half, and it is deliberate. Nothing in the VS Code API or in
 * the LSP can say "this problem belongs to the file, not to a position in
 * it": `vscode.Diagnostic` requires a `Range`, the Problems panel renders
 * `[Ln, Col]` for every entry unconditionally, and the editor expands an empty
 * range so that a squiggle always appears somewhere. Keeping such a result
 * therefore cannot mean anything but line 1 — inventing a location CMake never
 * reported, and squiggling whatever happens to sit at the top of the file.
 * Leaving it out says less, but nothing untrue.
 *
 * This also matches what the same diagnostic does when it is read from CMake's
 * output instead: `CMakeOutputConsumer` only recognises the `CMake Error at
 * <file>:<line>` form, so the `CMake Error in <file>` form never becomes a
 * problem there either. Either way the message still reaches the user in full
 * through CMake's output channel.
 *
 * @param sarifLog The parsed SARIF log
 * @param sourceDir The source directory, used to resolve relative artifact paths
 */
export function parseSarifLog(sarifLog: Sarif.Log, sourceDir: string): FileDiagnostic[] {
    const diagnostics: FileDiagnostic[] = [];
    for (const run of sarifLog.runs ?? []) {
        for (const result of run.results ?? []) {
            const physicalLocation = result.locations?.[0]?.physicalLocation;
            const filepath = artifactFilePath(physicalLocation?.artifactLocation, sourceDir);
            const range = sarifRange(physicalLocation?.region);
            const message = result.message.text ?? result.message.markdown;
            if (!filepath || !range || !message) {
                continue;
            }
            const diag = new vscode.Diagnostic(range, message, sarifSeverity(result.level));
            diag.source = 'cmake';
            diag.code = result.ruleId;
            diag.relatedInformation = relatedInformation(result, sourceDir);
            diagnostics.push({ filepath, diag });
        }
    }
    return diagnostics;
}

/**
 * Read the diagnostics that CMake recorded for a configure run.
 *
 * @param sarifPath Path to the SARIF log CMake was asked to write
 * @param sourceDir The source directory, used to resolve relative artifact paths
 * @returns The diagnostics from the log, or `null` when no usable log was
 * written — in which case the caller should fall back to the diagnostics parsed
 * from CMake's output
 */
export async function readSarifDiagnostics(sarifPath: string, sourceDir: string): Promise<FileDiagnostic[] | null> {
    if (!await fs.exists(sarifPath)) {
        return null;
    }
    try {
        return parseSarifLog(JSON.parse(await fs.readFile(sarifPath)) as Sarif.Log, sourceDir);
    } catch (e: any) {
        log.debug(`Failed to read CMake SARIF diagnostics from ${sarifPath}: ${e.message}`);
        return null;
    }
}

/**
 * How much older than this consumer's construction a log's modification time
 * may be and still count as written by the run this consumer is watching.
 *
 * A file that CMake actually rewrote this run has an mtime at or after the
 * moment its consumer was constructed — construction always happens just
 * before CMake runs (see `CMakeSarifConsumer`). The margin exists only to
 * absorb coarse filesystem clock resolution (whole-second granularity on some
 * setups); a CMake configure takes far longer than this to run, so it cannot
 * make a genuinely stale file look fresh.
 */
const mtimeSafetyMarginMs = 2000;

/**
 * Collects the diagnostics that CMake records in its SARIF log during a
 * configure.
 *
 * Where `CMakeOutputConsumer` recovers diagnostics from CMake's console output
 * as it arrives, the SARIF log states each diagnostic's file, line and
 * severity outright — but only once CMake has finished writing it. So rather
 * than being fed output line by line, this consumer reads the log back in one
 * pass once the configure it is watching has finished.
 *
 * Nothing about whether a log *should* exist is predicted or inferred here —
 * not from the configure arguments, and deliberately not from
 * `CMAKE_EXPORT_SARIF` in the cache either. Every such prediction is wrong in
 * some real case:
 *
 * - Arguments are incomplete. Cache variables persist across configures, so
 *   `CMAKE_EXPORT_SARIF` can already be on in a build directory even though
 *   nothing in this run's arguments mentions it — turning `cmake.exportSarifFile`
 *   off doesn't force it back off, exactly how `cmake.exportCompileCommandsFile`
 *   already behaves for `CMAKE_EXPORT_COMPILE_COMMANDS`.
 * - The cache is incomplete too. A project can turn SARIF logging on from
 *   inside its own CMake code (a plain `set(CMAKE_EXPORT_SARIF ON)` is a normal
 *   variable, which never reaches `CMakeCache.txt`), from a `-C` initial-cache
 *   script, or from a toolchain file. CMake writes the log; the cache never
 *   mentions it.
 * - The cache is unreliable exactly when it matters most. On a fatally failed
 *   configure — especially the first one in a clean build directory — there may
 *   be no `CMakeCache.txt` at all, or only a partial one, while CMake has still
 *   written the log recording why it failed.
 *
 * So the log file on disk is treated as the evidence, rather than something to
 * be corroborated: if a log is sitting where this run would have written one,
 * and its modification time says this run wrote it, those are this run's
 * diagnostics. A log older than that is left over from an earlier configure —
 * because SARIF logging is off now, or because this run died before rewriting
 * it — and is ignored. A run that genuinely wrote no log leaves nothing fresh
 * to find, which is the same answer arrived at honestly.
 *
 * Create one for each configure, and only when the CMake in use can write a
 * SARIF log and the user wants diagnostics loaded from it.
 */
export class CMakeSarifConsumer {
    /**
     * @param sourceDir The source directory, used to resolve relative artifact paths
     */
    constructor(readonly sourceDir: string) {
        this._notBefore = Date.now() - mtimeSafetyMarginMs;
    }

    /**
     * The oldest modification time a log may have and still be trusted as
     * belonging to the run this consumer is watching, captured at
     * construction time — which happens just before that run starts.
     */
    private readonly _notBefore: number;

    /**
     * The diagnostics read from the SARIF log, or `null` when there were none
     * to read — because CMake was never run, was not asked to write a log,
     * failed before writing one, or left only a log from an earlier run in
     * place. Callers fall back to the diagnostics that `CMakeOutputConsumer`
     * parsed out of CMake's output when this is `null`.
     */
    get diagnostics(): FileDiagnostic[] | null {
        return this._diagnostics;
    }
    private _diagnostics: FileDiagnostic[] | null = null;

    /**
     * Call once the configure this consumer is watching has finished, however
     * it went, to look for the SARIF log it may have written.
     *
     * @param binaryDir The build directory the configure used
     * @param configureArgs The configure arguments for the run. Only a
     * `--sarif-output` among them matters, to know where to look; whether a log
     * was written is answered by the file, not by the arguments.
     */
    async afterConfigure(binaryDir: string, configureArgs: string[]): Promise<void> {
        const logPath = sarifLogPath(configureArgs, binaryDir, binaryDir);
        this._diagnostics = await this.wasWrittenByThisRun(logPath)
            ? await readSarifDiagnostics(logPath, this.sourceDir)
            : null;
    }

    private async wasWrittenByThisRun(logPath: string): Promise<boolean> {
        try {
            return (await fs.stat(logPath)).mtimeMs >= this._notBefore;
        } catch {
            // Doesn't exist, or couldn't be stat'd for some other reason —
            // either way, there is nothing to read.
            return false;
        }
    }
}
