/**
 * Module for dealing with multiple workspaces
 */ /** */

import {ConfigurationReader} from '@cmt/config';
import paths from '@cmt/paths';
import {StateManager} from '@cmt/state';

/**
 * State attached to a directory in a workspace. Contains a config object and
 * a state management object.
 */
export class DirectoryContext {
  // Currently only contains the config object, but will later have the
  // directory-local state
  constructor(
      /**
       * The configuration for the associated directory.
       */
      public readonly config: ConfigurationReader,
      /**
       * The state management object associated with the directory.
       */
      public readonly state: StateManager,
  ) {}

  static createForDirectory(dir: string, state: StateManager): DirectoryContext {
    const config = ConfigurationReader.createForDirectory(dir);
    return new DirectoryContext(config, state);
  }

  get cmakePath(): Promise<string|null> { return paths.getCMakePath(this); }
  get ctestPath(): Promise<string|null> { return paths.getCTestPath(this); }
}