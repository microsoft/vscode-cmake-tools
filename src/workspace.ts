/**
 * Module for dealing with multiple workspaces
 */ /** */

import {ConfigurationReader} from '@cmt/config';
import {StateManager} from '@cmt/state';
import paths from '@cmt/paths';


export class WorkspaceContext {
  // Currently only contains the config object, but will later have the
  // directory-local state
  private constructor(readonly config: ConfigurationReader, readonly state: StateManager) {}

  static createForDirectory(dir: string, state: StateManager): WorkspaceContext {
    const config = ConfigurationReader.createForDirectory(dir);
    return new WorkspaceContext(config, state);
  }

  get cmakePath(): Promise<string|null> { return paths.getCMakePath(this); }
  get ctestPath(): Promise<string|null> { return paths.getCTestPath(this); }
}