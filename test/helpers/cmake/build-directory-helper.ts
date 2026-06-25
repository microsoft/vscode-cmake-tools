import * as fs from 'fs';
import * as path from 'path';

export class BuildDirectoryHelper {
    public constructor(private readonly _location: string) {}

    public clear() {
        // Retry on Windows: lingering MSVC helper processes (e.g. mspdbsrv.exe / vctip.exe) can
        // briefly keep handles on .pdb files in the build directory, so a single rmSync can fail
        // with ENOTEMPTY/EBUSY. maxRetries/retryDelay lets the delete ride out those transient
        // locks instead of failing the test's build-directory cleanup hook.
        return fs.rmSync(this._location, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
