import * as path from 'path';
import { BuildDirectoryHelper } from './builddirectoryhelper';


export class ProjectRootHelper {
  private readonly locationOfThisClassFile: string = __dirname;
  private readonly buildFolder : BuildDirectoryHelper;
  constructor(relativeRoot: string = 'test/extension_tests/successful_build/project_folder', buildDir : string = 'build') {
    this.buildFolder = new BuildDirectoryHelper(path.join(this.ExtensionSourceRoot, relativeRoot, buildDir));
  }

  private get ExtensionSourceRoot(): string {
    return path.normalize(
        path.join(this.locationOfThisClassFile, '../../../../../'));
  }

  public get BuildDirectory() : BuildDirectoryHelper  { return this.buildFolder; }

  public get Location(): string { return this.ExtensionSourceRoot; }
}