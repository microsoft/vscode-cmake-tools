import * as path from 'path';
import {BuildDirectoryHelper} from './builddirectoryhelper';


export class ProjectRootHelper {
  private readonly locationOfThisClassFile: string = __dirname;
  private readonly buildFolder: BuildDirectoryHelper;
  private readonly projectRoot: string;
  constructor(relativeRoot: string, buildDir: string = 'build') {
    this.projectRoot = path.join(this.ExtensionSourceRoot, relativeRoot);
    this.buildFolder = new BuildDirectoryHelper(path.join(this.projectRoot, buildDir));
  }

  private get ExtensionSourceRoot(): string {
    return path.normalize(path.join(this.locationOfThisClassFile, '../../../../'));
  }

  public get BuildDirectory(): BuildDirectoryHelper { return this.buildFolder; }

  public get Location(): string { return this.projectRoot; }
}