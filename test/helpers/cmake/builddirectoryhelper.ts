import * as path from 'path';
import * as fs from 'fs';
import * as rimraf from 'rimraf';

export class BuildDirectoryHelper {

    private readonly location: string;

    public constructor(location : string) {
      this.location = location;
    }

    public Clear() {
      if (fs.existsSync(this.location)) {
        return rimraf.sync(this.location);
      }
    }

    public get Location(): string { return this.location; }

    public get IsCMakeCachePresent(): boolean { return fs.existsSync(path.join(this.Location, 'CMakeCache.txt')); }
  }