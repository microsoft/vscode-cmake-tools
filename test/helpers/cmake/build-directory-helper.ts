import * as fs from 'fs';
import * as path from 'path';

// Error codes that, on Windows, usually indicate a *transient* file lock held by a lingering
// MSVC/AV helper process rather than a genuine problem with the test or the file system.
const transientWindowsLockCodes = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

export class BuildDirectoryHelper {
    public constructor(private readonly _location: string) {}

    public clear() {
        // Retry on Windows: lingering MSVC helper processes (e.g. mspdbsrv.exe / vctip.exe) and
        // on-access AV scanners can briefly keep handles on files (notably .pdb) in the build
        // directory, so a recursive delete can fail with EPERM/EBUSY/ENOTEMPTY. Node's rmSync
        // rides out those transient failures with a linear backoff between attempts; maxRetries: 20
        // / retryDelay: 200 budgets ~40s of backoff (200 * (1 + 2 + ... + 20)), far more forgiving
        // than the previous ~5.5s and long enough to outlast the handle even under heavy CI load.
        // POSIX platforms almost never reach this retry path, so the larger budget is inert there.
        try {
            return fs.rmSync(this._location, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
        } catch (e) {
            // Last-resort resilience for the *cleanup* path only: if the delete still fails after
            // exhausting retries with a known transient Windows lock code, don't let build-directory
            // cleanup fail the test — log a warning and continue, leaving the residual files for the
            // next run to overwrite. Any other error (a real bug, a permissions misconfiguration,
            // etc.) still propagates so genuine failures are never masked. Scoped to Windows so
            // macOS/Linux behavior is unchanged.
            const code = (e as NodeJS.ErrnoException).code;
            if (process.platform === 'win32' && code !== undefined && transientWindowsLockCodes.has(code)) {
                console.warn(
                    `Ignoring transient ${code} while clearing build directory '${this._location}'. ` +
                    'A helper process (e.g. mspdbsrv.exe / vctip.exe) or AV scanner likely still holds a ' +
                    'handle; leaving residual files for the next run to overwrite.');
                return undefined;
            }
            throw e;
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
