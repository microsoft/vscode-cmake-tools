/**
 * Safety checks for the destructive build directory deletions performed by the
 * CMake drivers (clean configure and full clean configure).
 *
 * This module is intentionally pure and dependency free (no `vscode`, no extension
 * state) so that it can be unit tested directly and reused from any layer.
 */

import * as path from 'path';

/**
 * Why a build directory deletion was refused. These are stable, non-localized codes;
 * the caller is responsible for turning them into user facing (localized) messages.
 */
export enum BuildDirectoryRefusalReason {
    /** The build directory is empty or is not a string we can reason about. */
    EmptyPath = 'empty-path',
    /** The build directory is not an absolute path, so it cannot be validated. */
    NotAbsolute = 'not-absolute',
    /** The build directory resolves to a filesystem root (`C:\`, `/`, a UNC share root, ...). */
    FilesystemRoot = 'filesystem-root',
    /** The source directory is unknown, so the build directory cannot be validated. */
    UnknownSourceDirectory = 'unknown-source-directory',
    /** The build directory is the source directory. */
    SourceDirectory = 'source-directory',
    /** The build directory contains the source directory. */
    SourceDirectoryAncestor = 'source-directory-ancestor',
    /** The build directory is a workspace folder. */
    WorkspaceRoot = 'workspace-root',
    /** The build directory contains a workspace folder. */
    WorkspaceRootAncestor = 'workspace-root-ancestor'
}

export interface BuildDirectorySafetyResult {
    /** True when the build directory may be recursively deleted. */
    safe: boolean;
    /** Set when `safe` is false. */
    reason?: BuildDirectoryRefusalReason;
    /** The build directory after resolution and normalization. */
    resolvedBinaryDir?: string;
    /** The source or workspace folder that the deletion would have destroyed, when applicable. */
    conflictingPath?: string;
}

function isUsablePath(value: string | undefined | null): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Rewrites the Windows extended-length (`\\?\C:\...`) and device (`\\.\C:\...`) prefixes,
 * including their UNC form (`\\?\UNC\server\share`), into their ordinary spelling so that
 * the root and ancestor math below sees the same path shape in either notation.
 */
function stripExtendedLengthPrefix(value: string, pathApi: path.PlatformPath): string {
    if (pathApi.sep !== '\\') {
        return value;
    }
    if (/^\\\\[?.]\\UNC\\/i.test(value)) {
        return `\\\\${value.slice(8)}`;
    }
    if (/^\\\\[?.]\\/.test(value)) {
        const withoutPrefix = value.slice(4);
        // `\\?\C:` denotes the drive root; without the separator it would look drive relative.
        return /^[a-zA-Z]:$/.test(withoutPrefix) ? `${withoutPrefix}\\` : withoutPrefix;
    }
    return value;
}

/**
 * Resolves a path with the given path implementation, dropping trailing separators and
 * collapsing `.`/`..` segments. Returns undefined when the path is unusable or relative,
 * since resolving a relative path would silently pull in the current working directory.
 *
 * The value is deliberately *not* trimmed: whitespace is legal in a path on some platforms,
 * and validating a trimmed path while deleting the untrimmed one would validate a different
 * directory than the one that gets removed.
 */
function resolveAbsolute(value: string | undefined | null, pathApi: path.PlatformPath): string | undefined {
    if (!isUsablePath(value)) {
        return undefined;
    }
    const normalized = stripExtendedLengthPrefix(value, pathApi);
    if (!pathApi.isAbsolute(normalized)) {
        return undefined;
    }
    return pathApi.resolve(normalized);
}

function isFilesystemRoot(resolved: string, pathApi: path.PlatformPath): boolean {
    return pathApi.dirname(resolved) === resolved || pathApi.parse(resolved).root === resolved;
}

/**
 * Windows paths are case insensitive, so comparisons are done on a case folded copy there.
 */
function relativeFromNormalizedCase(from: string, to: string, pathApi: path.PlatformPath): string {
    const caseInsensitive = pathApi.sep === '\\';
    return pathApi.relative(caseInsensitive ? from.toLowerCase() : from, caseInsensitive ? to.toLowerCase() : to);
}

/**
 * True when both paths refer to the same directory.
 */
export function isSamePath(first: string, second: string, pathApi: path.PlatformPath = path): boolean {
    return relativeFromNormalizedCase(first, second, pathApi) === '';
}

/**
 * True when `ancestor` is the same directory as `target` or contains it. Uses
 * `path.relative` rather than string prefix comparison so that `C:\build2` is not
 * treated as living inside `C:\build`.
 */
export function isAncestorOrSame(ancestor: string, target: string, pathApi: path.PlatformPath = path): boolean {
    const relative = relativeFromNormalizedCase(ancestor, target, pathApi);
    if (relative === '') {
        return true;
    }
    if (pathApi.isAbsolute(relative)) {
        return false;
    }
    return relative !== '..' && !relative.startsWith(`..${pathApi.sep}`);
}

/**
 * Decides whether `binaryDir` can be recursively deleted without destroying user data.
 *
 * The deletion is refused when the resolved build directory is a filesystem root, is the
 * source directory or a workspace folder, contains the source directory or a workspace
 * folder, or cannot be validated at all (empty/relative path, unknown source directory).
 *
 * @param binaryDir The build directory that is about to be deleted.
 * @param sourceDir The directory containing the root CMakeLists.txt.
 * @param workspaceRoots Every known workspace folder path.
 * @param pathApi Path implementation to use; overridable so both platforms can be tested.
 */
export function isSafeToDeleteBuildDirectory(binaryDir: string, sourceDir: string, workspaceRoots: string[] = [], pathApi: path.PlatformPath = path): BuildDirectorySafetyResult {
    if (!isUsablePath(binaryDir)) {
        return { safe: false, reason: BuildDirectoryRefusalReason.EmptyPath };
    }

    const resolvedBinaryDir = resolveAbsolute(binaryDir, pathApi);
    if (!resolvedBinaryDir) {
        return { safe: false, reason: BuildDirectoryRefusalReason.NotAbsolute };
    }

    if (isFilesystemRoot(resolvedBinaryDir, pathApi)) {
        return { safe: false, reason: BuildDirectoryRefusalReason.FilesystemRoot, resolvedBinaryDir };
    }

    const resolvedSourceDir = resolveAbsolute(sourceDir, pathApi);
    if (!resolvedSourceDir) {
        return { safe: false, reason: BuildDirectoryRefusalReason.UnknownSourceDirectory, resolvedBinaryDir };
    }

    if (isAncestorOrSame(resolvedBinaryDir, resolvedSourceDir, pathApi)) {
        return {
            safe: false,
            reason: isSamePath(resolvedBinaryDir, resolvedSourceDir, pathApi)
                ? BuildDirectoryRefusalReason.SourceDirectory
                : BuildDirectoryRefusalReason.SourceDirectoryAncestor,
            resolvedBinaryDir,
            conflictingPath: resolvedSourceDir
        };
    }

    for (const workspaceRoot of workspaceRoots) {
        const resolvedWorkspaceRoot = resolveAbsolute(workspaceRoot, pathApi);
        if (!resolvedWorkspaceRoot) {
            continue;
        }
        if (isAncestorOrSame(resolvedBinaryDir, resolvedWorkspaceRoot, pathApi)) {
            return {
                safe: false,
                reason: isSamePath(resolvedBinaryDir, resolvedWorkspaceRoot, pathApi)
                    ? BuildDirectoryRefusalReason.WorkspaceRoot
                    : BuildDirectoryRefusalReason.WorkspaceRootAncestor,
                resolvedBinaryDir,
                conflictingPath: resolvedWorkspaceRoot
            };
        }
    }

    return { safe: true, resolvedBinaryDir };
}

/**
 * Resolves a path to its canonical form on disk. On Windows this collapses 8.3 short names,
 * junctions/symbolic links and casing; on macOS it returns the canonical casing.
 */
export type RealpathFunction = (candidate: string) => Promise<string> | string;

export interface ResolvedBuildDirectoryGuardOptions {
    /** Native realpath implementation, e.g. `fs.realpathSync.native`. */
    realpath: RealpathFunction;
    /** Path implementation to use; overridable so both platforms can be tested. */
    pathApi?: path.PlatformPath;
}

/**
 * Resolves a path to its canonical filesystem identity. Any failure (missing path,
 * permission error, ...) falls back to the value as given, so the lexical guard still runs.
 */
async function canonicalize(value: string, realpath: RealpathFunction): Promise<string> {
    if (!isUsablePath(value)) {
        return value;
    }
    try {
        const canonical = await realpath(value);
        return isUsablePath(canonical) ? canonical : value;
    } catch {
        return value;
    }
}

/**
 * Canonical-identity version of {@link isSafeToDeleteBuildDirectory}.
 *
 * Comparing path strings alone is not sufficient: on Windows the very same directory can be
 * spelled as an 8.3 short name (`C:\Users\HANNIA~1\...`), reached through a junction or
 * symbolic link, or written with different casing or an extended-length prefix, and on macOS
 * volumes are usually case insensitive. Each operand is therefore canonicalized through the
 * native realpath before the lexical rules are applied.
 */
export async function isSafeToDeleteBuildDirectoryResolved(binaryDir: string, sourceDir: string, workspaceRoots: string[] = [], options: ResolvedBuildDirectoryGuardOptions): Promise<BuildDirectorySafetyResult> {
    const canonicalBinaryDir = await canonicalize(binaryDir, options.realpath);
    const canonicalSourceDir = await canonicalize(sourceDir, options.realpath);
    const canonicalWorkspaceRoots: string[] = [];
    for (const workspaceRoot of workspaceRoots) {
        canonicalWorkspaceRoots.push(await canonicalize(workspaceRoot, options.realpath));
    }
    return isSafeToDeleteBuildDirectory(canonicalBinaryDir, canonicalSourceDir, canonicalWorkspaceRoots, options.pathApi ?? path);
}

/**
 * Runs `action` with an "in progress" flag set, guaranteeing that the flag is cleared
 * again even when the action throws. Used by the clean configure paths so that a failed
 * build directory deletion cannot leave the driver permanently marked as configuring.
 */
export async function withInProgressFlag<T>(setInProgress: (inProgress: boolean) => void, action: () => Promise<T>): Promise<T> {
    setInProgress(true);
    try {
        return await action();
    } finally {
        setInProgress(false);
    }
}
