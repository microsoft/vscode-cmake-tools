/**
 * Module for dealing with multiple workspace directories
 */ /** */

import * as vscode from 'vscode';

import { ConfigurationReader } from '@cmt/config';
import paths from '@cmt/paths';
import { StateManager } from '@cmt/state';

/**
 * State attached to a directory in a workspace. Contains a config object and
 * a state management object.
 */
export class DirectoryContext {
    constructor(
        /**
         * Workspace folder associated with this context
         */
        public readonly folder: vscode.WorkspaceFolder,
        /**
         * The configuration for the associated directory.
         */
        public readonly config: ConfigurationReader,
        /**
         * The state management object associated with the directory.
         */
        public readonly state: StateManager
    ) {}

    /**
     * Create a context object for the given a workspace folder.
     * @param folder The workspace folder for which to create a context
     * @param state The state that will be associated with the returned context
     */
    static createForDirectory(folder: vscode.WorkspaceFolder, state: StateManager): DirectoryContext {
        const config = ConfigurationReader.create(folder);
        return new DirectoryContext(folder, config, state);
    }

    /**
     * The path to a CMake executable associated with this directory. This should
     * be used over `ConfigurationReader.cmakePath` because it will do additional
     * path expansion and searching.
     */
    getCMakePath(overWriteCMakePathSetting?: string): Promise<string | null> {
        return paths.getCMakePath(this, overWriteCMakePathSetting);
    }
    /**
     * The CTest executable for the directory. See `cmakePath` for more
     * information.
     */
    getCTestPath(overWriteCMakePathSetting?: string): Promise<string | null> {
        return paths.getCTestPath(this, overWriteCMakePathSetting);
    }
    /**
     * The CPack executable for the directory. See `cmakePath` for more
     * information.
     */
    getCPackPath(overWriteCMakePathSetting?: string): Promise<string | null> {
        return paths.getCPackPath(this, overWriteCMakePathSetting);
    }
}
