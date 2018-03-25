import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';

export class BuildDirectoryHelper {
  public constructor(private readonly _location: string) {}

  public clear() {
    if (fs.existsSync(this._location)) {
      return rimraf.sync(this._location);
    }
  }

  public get location(): string { return this._location; }

  public get isCMakeCachePresent(): boolean { return fs.existsSync(path.join(this.location, 'CMakeCache.txt')); }
}