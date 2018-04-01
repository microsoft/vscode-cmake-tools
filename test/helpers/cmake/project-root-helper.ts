
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import {BuildDirectoryHelper} from './build-directory-helper';


export class ProjectRootHelper {
  private readonly _locationOfThisClassFile: string = __dirname;
  private readonly _buildFolder: BuildDirectoryHelper;
  private readonly _projectRoot: string;

  constructor(relativeRoot: string, buildDir: string = 'build') {
    this._projectRoot = path.join(this.extensionSourceRoot, relativeRoot);
    this._buildFolder = new BuildDirectoryHelper(path.join(this._projectRoot, buildDir));
  }

  private get extensionSourceRoot(): string {
    return path.normalize(path.join(this._locationOfThisClassFile, '../../../../'));
  }

  public get buildDirectory(): BuildDirectoryHelper { return this._buildFolder; }

  public get location(): string { return this._projectRoot; }

  public clear() {
    return rimraf.sync(path.join(this.location, '*'));
  }

  public get cmakeListContent(): string {
    const cmakeFilePath = path.join(this.location, 'CMakeLists.txt');
    if (fs.existsSync(cmakeFilePath)) {
      return fs.readFileSync(cmakeFilePath).toString();
    } else {
      return '';
    }
  }
}