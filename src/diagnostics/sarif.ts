/**
 * Diagnostics from a CMake SARIF log: converting its results into
 * `FileDiagnostic`s, and deciding whether a log on disk belongs to the
 * configure being watched. Where the log is and what CMake is asked to do
 * about it is `@cmt/sarifExport`'s concern.
 */ /** */

import type * as Sarif from 'sarif';
import * as vscode from 'vscode';

import { diagnosticSeverity, FileDiagnostic, oneLess } from '@cmt/diagnostics/util';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as util from '@cmt/util';

const log = logging.createLogger('sarif');

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
 * The parts of a log's `stat()` that any rewrite of it changes.
 *
 * CMake writes its log in place, so a rewrite always moves the modification and
 * change times; size and inode cover a rewrite landing within one tick of a
 * coarse filesystem clock, or a log replaced by another file.
 */
interface LogSnapshot {
    mtimeMs: number;
    ctimeMs: number;
    size: number;
    ino: number;
}

/**
 * Take a {@link LogSnapshot} of the log at `logPath`, or `null` when there is
 * no log there — or it couldn't be stat'd for some other reason, which amounts
 * to the same thing: there is nothing to read.
 */
async function snapshotLog(logPath: string): Promise<LogSnapshot | null> {
    const stat = await fs.tryStat(logPath);
    return stat && { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size, ino: stat.ino };
}

/**
 * Whether two {@link LogSnapshot}s of the same path describe the same file,
 * unrewritten. `null` (no file) matches only `null`.
 */
function sameSnapshot(a: LogSnapshot | null, b: LogSnapshot | null): boolean {
    return a === b || (a !== null && b !== null
        && a.mtimeMs === b.mtimeMs
        && a.ctimeMs === b.ctimeMs
        && a.size === b.size
        && a.ino === b.ino);
}

/**
 * Start watching for the SARIF log of a configure that is about to run, and
 * get back a function that reads this run's diagnostics from it once the
 * configure has finished.
 *
 * Where `CMakeOutputConsumer` recovers diagnostics from CMake's console output
 * as it arrives, the SARIF log states each diagnostic's file, line and
 * severity outright — but only once CMake has finished writing it. So rather
 * than being fed output line by line, the log is read back in one pass once
 * the configure has finished.
 *
 * The caller says *where* to look (see `sarifLogPath` in `@cmt/sarifExport`);
 * this decides whether what is there belongs to this run. Nothing about
 * whether a log *should* exist is predicted or inferred — not from the
 * configure arguments, and deliberately not from `CMAKE_EXPORT_SARIF` in the
 * cache either. Every such prediction is wrong in some real case:
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
 * and it has changed since just before this run started, those are this run's
 * diagnostics. A log that is unchanged is left over from an earlier configure —
 * because SARIF logging is off now, or because this run died before rewriting
 * it — and is ignored. A run that genuinely wrote no log leaves nothing changed
 * to find, which is the same answer arrived at honestly.
 *
 * "Changed" compares the file with itself, before and after, rather than its
 * modification time with the clock: the filesystem's clock need not agree with
 * this one (a network share, a WSL or container mount), and a stale log from a
 * configure that finished only moments ago would be indistinguishable by time
 * from one this run wrote.
 *
 * @param logPath Where the configure would write its log, from `sarifLogPath`.
 * Only where to look; whether a log was written is answered by the file.
 * @param sourceDir The source directory, used to resolve relative artifact paths
 * @returns A function to call once the configure has finished, however it
 * went. It resolves to the diagnostics read from the log, or `null` when there
 * were none to read — because CMake was not asked to write a log, failed before
 * writing one, or left only a log from an earlier run in place. Callers fall
 * back to the diagnostics that `CMakeOutputConsumer` parsed out of CMake's
 * output when it is `null`.
 */
export async function watchSarifLog(logPath: string, sourceDir: string): Promise<() => Promise<FileDiagnostic[] | null>> {
    const before = await snapshotLog(logPath);
    return async () => {
        const after = await snapshotLog(logPath);
        return after && !sameSnapshot(before, after)
            ? readSarifDiagnostics(logPath, sourceDir)
            : null;
    };
}
