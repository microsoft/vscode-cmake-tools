import * as fs from 'fs';
import * as path from 'path';

export class BuildDirectoryHelper {
    public constructor(private readonly _location: string) {}

    public clear() {
        return fs.rmSync(this._location, {recursive: true, force: true});
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
