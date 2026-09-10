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
 * Resolves a path with the given path implementation, dropping trailing separators and
 * collapsing `.`/`..` segments. Returns undefined when the path is unusable or relative,
 * since resolving a relative path would silently pull in the current working directory.
 */
function resolveAbsolute(value: string | undefined | null, pathApi: path.PlatformPath): string | undefined {
    if (!isUsablePath(value)) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!pathApi.isAbsolute(trimmed)) {
        return undefined;
    }
    return pathApi.resolve(trimmed);
}

function isFilesystemRoot(resolved: string, pathApi: path.PlatformPath): boolean {
    return pathApi.dirname(resolved) === resolved;
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
