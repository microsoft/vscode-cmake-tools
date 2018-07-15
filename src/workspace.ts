/**
 * Module for dealing with multiple workspace directories
 */ /** */

import {ConfigurationReader} from '@cmt/config';
import paths from '@cmt/paths';
import {StateManager} from '@cmt/state';
import * as vscode from 'vscode';

/**
 * State attached to a directory in a workspace. Contains a config object and
 * a state management object.
 */
export class DirectoryContext {
  constructor(
      /**
       * Absolute path to the directory associated with this context
       */
      public readonly folder: vscode.WorkspaceFolder,
      /**
       * The configuration for the associated directory.
       */
      public readonly config: ConfigurationReader,
      /**
       * The state management object associated with the directory.
       */
      public readonly state: StateManager,
  ) {}

  /**
   * Create a context object for the given path to a directory.
   * @param dir The directory for which to create a context
   * @param state The state that will be associated with the returned context
   */
  static createForDirectory(folder: vscode.WorkspaceFolder, state: StateManager): DirectoryContext {
    const config = ConfigurationReader.createForDirectory(folder);
    return new DirectoryContext(folder, config, state);
  }

  /**
   * The path to a CMake executable associated with this directory. This should
   * be used over `ConfigurationReader.cmakePath` because it will do additional
   * path expansion and searching.
   */
  get cmakePath(): Promise<string|null> { return paths.getCMakePath(this); }
  /**
   * The CTest executable for the directory. See `cmakePath` for more
   * information.
   */
  get ctestPath(): Promise<string|null> { return paths.getCTestPath(this); }
}