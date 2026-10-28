/**
 * Read diagnostics in the SARIF format and convert them into file diagnostics.
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
 * Resolve a SARIF artifact location using the provided base URIs.
 *
 * If the location is not absolute nor relative to a known base URI, returns
 * `undefined`.
 */
function artifactFilePath(artifact: Sarif.ArtifactLocation | undefined, baseUris: Sarif.Run['originalUriBaseIds']): string | undefined {
    const uri = artifact?.uri;
    if (!uri) {
        return undefined;
    }
    const filepath = uri.startsWith('file:') ? vscode.Uri.parse(uri).fsPath : uri;
    if (path.isAbsolute(filepath)) {
        return util.lightNormalizePath(filepath);
    }
    const baseUri = artifact.uriBaseId ? baseUris?.[artifact.uriBaseId]?.uri : undefined;
    return baseUri?.startsWith('file://') ? util.resolvePath(filepath, baseUri.substring('file://'.length)) : undefined;
}

/**
 * Convert a SARIF region into a range. Returns `undefined` when the region
 * does not include a specific line.
 */
function sarifRange(region: Sarif.Region | undefined): vscode.Range | undefined {
    // SARIF line numbers are one-based, so anything below 1 is not a line.
    if (region?.startLine === undefined || region.startLine < 1) {
        return undefined;
    }
    const startLine = oneLess(region.startLine);
    const startColumn = region.startColumn === undefined ? 0 : oneLess(region.startColumn);
    const endLine = region.endLine === undefined ? startLine : oneLess(region.endLine);
    // The column span is not currently reported by CMake, so default to a large number.
    const endColumn = region.endColumn === undefined ? 9999 : oneLess(region.endColumn);
    return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function physicalLocationOf(location: Sarif.Location | undefined): Sarif.PhysicalLocation | undefined {
    const physical = location?.physicalLocation;
    const evalCall = physical?.artifactLocation?.uri?.match(/^(.*?):(\d+):EVAL(?::\d+:EVAL)*$/);
    return evalCall
        ? { artifactLocation: { ...physical?.artifactLocation, uri: evalCall[1] }, region: { startLine: parseInt(evalCall[2]) } }
        : physical;
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
 * Collect related diagnostic locations for a SARIF result.
 */
function relatedInformation(result: Sarif.Result, baseUris: Sarif.Run['originalUriBaseIds']): vscode.DiagnosticRelatedInformation[] {
    const locate = (location: Sarif.Location | undefined): vscode.Location | undefined => {
        const physicalLocation = physicalLocationOf(location);
        const filepath = artifactFilePath(physicalLocation?.artifactLocation, baseUris);
        const range = sarifRange(physicalLocation?.region);
        return filepath && range ? new vscode.Location(vscode.Uri.file(filepath), range) : undefined;
    };

    const related: vscode.DiagnosticRelatedInformation[] = [];
    for (const stack of result.stacks ?? []) {
        const frames = stack.frames.map(frame => frame.location);
        // If a region is reported, skip the first reported frame as it is the
        // result's own location (reported separately)
        const firstFrame = result.locations?.[0]?.physicalLocation?.region ? 1 : 0;
        for (let i = firstFrame; i < frames.length; i++) {
            const location = frames[i];
            const command = location?.logicalLocations?.[0]?.name;
            let at = locate(location);
            let message = command ? `In call to '${command}' here` : '';
            if (!at && location?.message?.text === 'DEFERRED') {
                const deferredIn = location.physicalLocation?.artifactLocation;
                const deferredPath = artifactFilePath(deferredIn, baseUris);
                if (deferredPath) {
                    at = locate(frames[i - 1]);
                    // Name relative to the source directory when the file is within.
                    const shown = deferredIn?.uriBaseId === 'CMAKE_SOURCE_DIR' ? deferredIn.uri : deferredPath;
                    message = `Deferred to the end of ${shown}`;
                }
            }
            if (at) {
                related.push(new vscode.DiagnosticRelatedInformation(at, message));
            }
        }
    }
    for (const location of result.relatedLocations ?? []) {
        const at = locate(location);
        if (at) {
            related.push(new vscode.DiagnosticRelatedInformation(at, location.message?.text ?? ''));
        }
    }
    return related;
}

/**
 * The primary location to report for a SARIF result.
 *
 * A result may have its own location or be reported at the location of its
 * nearest caller.
 */
function reportedLocation(result: Sarif.Result, baseUris: Sarif.Run['originalUriBaseIds']): Sarif.PhysicalLocation | undefined {
    const frames = result.stacks?.[0]?.frames.map(frame => frame.location) ?? [];
    return [result.locations?.[0], ...frames].map(location => physicalLocationOf(location)).find(physicalLocation =>
        artifactFilePath(physicalLocation?.artifactLocation, baseUris) && sarifRange(physicalLocation?.region));
}

/**
 * Create `FileDiagnostic` objects for the diagnostics in a SARIF log.
 */
export function fileDiagnostics(sarifLog: Sarif.Log): FileDiagnostic[] {
    const diagnostics: FileDiagnostic[] = [];
    for (const run of sarifLog.runs ?? []) {
        for (const result of run.results ?? []) {
            const physicalLocation = reportedLocation(result, run.originalUriBaseIds);
            const filepath = artifactFilePath(physicalLocation?.artifactLocation, run.originalUriBaseIds);
            const range = sarifRange(physicalLocation?.region);
            // CMake allows an empty message, but a VS Code diagnostic does not.
            const message = result.message.text || result.message.markdown || result.ruleId;
            if (!filepath || !range || !message) {
                continue;
            }
            const diag = new vscode.Diagnostic(range, message, sarifSeverity(result.level));
            diag.source = 'cmake';
            diag.code = result.ruleId;
            diag.relatedInformation = relatedInformation(result, run.originalUriBaseIds);
            diagnostics.push({ filepath, diag });
        }
    }
    return diagnostics;
}

/**
 * Read diagnostics from a SARIF log file.
 *
 * @returns The diagnostics from the log, or `null` when no usable log was found.
 */
export async function readSarifDiagnostics(sarifPath: string): Promise<FileDiagnostic[] | null> {
    if (!await fs.exists(sarifPath)) {
        return null;
    }
    try {
        return fileDiagnostics(JSON.parse(await fs.readFile(sarifPath)) as Sarif.Log);
    } catch (e: any) {
        log.debug(`Failed to read CMake SARIF diagnostics from ${sarifPath}: ${e.message}`);
        return null;
    }
}

/**
 * File metadata to compare to determining if a SARIF log is current.
 */
interface LogSnapshot {
    mtimeMs: number;
    ctimeMs: number;
    size: number;
    ino: number;
}

/**
 * Create a {@link LogSnapshot} from file metadata at `logPath`, or `null` if the file does not exist.
 */
async function snapshotLog(logPath: string): Promise<LogSnapshot | null> {
    const stat = await fs.tryStat(logPath);
    return stat && { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size, ino: stat.ino };
}

/**
 * Whether two {@link LogSnapshot}s of the same path have identical stat information.
 */
function logSnapshotsEq(a: LogSnapshot | null, b: LogSnapshot | null): boolean {
    return a === b || (a !== null && b !== null
        && a.mtimeMs === b.mtimeMs
        && a.ctimeMs === b.ctimeMs
        && a.size === b.size
        && a.ino === b.ino);
}

/**
 * Read diagnostics from the SARIF log at the given path if it has changed.
 *
 * A snapshot of any existing SARIF log is taken when this function is called.
 * The returned function checks for modifications against the snapshot,
 * returning updated diagnostics if the log was rewritten and null if it is
 * stale.
 *
 * @returns A function to call once the configure has finished that returns
 * diagnostics from the SARIF log if it changed, or `null` otherwise.
 */
export async function watchSarifLog(logPath: string): Promise<() => Promise<FileDiagnostic[] | null>> {
    const before = await snapshotLog(logPath);
    return async () => {
        const after = await snapshotLog(logPath);
        return after && !logSnapshotsEq(before, after)
            ? readSarifDiagnostics(logPath)
            : null;
    };
}
