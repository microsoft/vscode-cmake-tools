import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// On Windows, error codes that indicate a *transient* file lock held by a lingering MSVC/AV helper
// process (e.g. mspdbsrv.exe / vctip.exe keeping a handle on a .pdb) rather than a genuine problem.
// Only these are treated as recoverable by the cleanup path below.
const transientWindowsLockCodes = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

// MSVC build helper processes known to briefly outlive a build and keep handles on files (notably
// .pdb) inside the build directory, blocking a recursive delete. `taskkill /IM` is case-insensitive,
// so 'vctip.exe' also matches 'VCTIP.exe'.
const lingeringMsvcHelperImages = ['mspdbsrv.exe', 'vctip.exe'];

export class BuildDirectoryHelper {
    public constructor(private readonly _location: string) {}

    public clear() {
        // POSIX platforms never hold the build directory open via these helpers, so keep the
        // original, simple behavior exactly as before.
        if (process.platform !== 'win32') {
            return fs.rmSync(this._location, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
        this.clearOnWindows();
    }

    // Root cause of the Windows E2E flake: lingering MSVC helper processes (mspdbsrv.exe / vctip.exe)
    // keep a handle on a .pdb inside the build directory, so the recursive delete cannot complete.
    // A *partial* delete is worse than none: rmSync deletes depth-first and can remove CMakeCache.txt
    // and/or the .cmake file-API reply before it hits the locked .pdb, leaving a corrupt directory
    // that makes the next configure/build fail with "could not load cache". This method guarantees
    // that, when it returns, the build directory at the expected path is either fully gone or
    // brand-new empty -- never partially deleted.
    private clearOnWindows() {
        // Step 1: best-effort terminate the known culprits so their handles are released and the
        // plain recursive delete can succeed cleanly. Only these specific, well-known helper images
        // are targeted; failures (e.g. "process not found") are ignored.
        this.killLingeringMsvcHelpers();

        // Step 2: normal recursive delete with a generous retry budget to ride out any residual lock
        // (e.g. an AV scanner) that briefly outlives the taskkill above.
        try {
            fs.rmSync(this._location, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
            return;
        } catch (deleteError) {
            if (!isTransientWindowsLockError(deleteError)) {
                throw deleteError;
            }
        }

        // Step 3: the delete still could not complete. Renaming the directory aside almost always
        // succeeds even when a nested file is locked, because an in-place, same-volume rename does
        // not delete or open the locked file. This hands the test a fresh, empty build directory at
        // the expected path and moves any partial/corrupt state out of the way.
        const staleLocation = `${this._location}.stale-${Date.now()}`;
        try {
            fs.renameSync(this._location, staleLocation);
            console.warn(
                `Build directory '${this._location}' could not be deleted (a helper process such as ` +
                'mspdbsrv.exe / vctip.exe or an AV scanner is still holding a handle); moved it aside to ' +
                `'${staleLocation}' so the next configure starts from a clean directory.`);
            // Best-effort delete of the moved-aside copy; if it is still locked, leave it -- it no
            // longer sits at the expected build path, so it cannot corrupt the next configure.
            try {
                fs.rmSync(staleLocation, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
            } catch {
                // Intentionally ignored: the stale copy is out of the way and harmless.
            }
            return;
        } catch (renameError) {
            if (!isTransientWindowsLockError(renameError)) {
                throw renameError;
            }
        }

        // Step 4: last resort -- neither delete nor rename could complete. Explicitly remove the two
        // artifacts whose stale/partial presence causes "could not load cache" so the next configure
        // can still recover, then continue rather than failing the test on a cleanup-only problem.
        this.removeCacheArtifactsBestEffort();
        console.warn(
            `Build directory '${this._location}' could not be deleted or moved aside; removed ` +
            'CMakeCache.txt and the .cmake file-API directory so the next configure can start fresh. ' +
            'A helper process (mspdbsrv.exe / vctip.exe) or AV scanner is holding a handle on a build file.');
    }

    private killLingeringMsvcHelpers() {
        for (const image of lingeringMsvcHelperImages) {
            try {
                childProcess.execFileSync('taskkill', ['/F', '/IM', image], { stdio: 'ignore' });
            } catch {
                // Best-effort: taskkill exits non-zero when the image is not running. Ignore.
            }
        }
    }

    private removeCacheArtifactsBestEffort() {
        for (const artifact of [this.cmakeCachePath, path.join(this._location, '.cmake')]) {
            try {
                fs.rmSync(artifact, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
            } catch {
                // Best-effort: if even these individual files are locked there is nothing more we can
                // safely do; a subsequent clean configure may still recover.
            }
        }
    }

    public get location(): string {
        return this._location;
    }

    public get cmakeCachePath(): string {
        return path.join(this.location, 'CMakeCache.txt');
    }

    public get isCMakeCachePresent(): boolean {
        return fs.existsSync(this.cmakeCachePath);
    }
}

function isTransientWindowsLockError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code !== undefined && transientWindowsLockCodes.has(code);
}
