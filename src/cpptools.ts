/**
 * Module for vscode-cpptools integration.
 *
 * This module uses the [vscode-cpptools API](https://www.npmjs.com/package/vscode-cpptools)
 * to provide that extension with per-file configuration information.
 */ /** */

import {CMakeCache} from '@cmt/cache';
import * as cms from '@cmt/cms-client';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';
import rollbar from './rollbar';

/**
 * Type given when updating the configuration data stored in the file index.
 */
export interface CodeModelParams {
  /**
   * The CMake Server codemodel message content. This is the important one.
   */
  codeModel: cms.CodeModelContent;
  /**
   * The contents of the CMakeCache.txt, which also provides supplementary
   * configuration information.
   */
  cache: CMakeCache;
  /**
   * The path to `cl.exe`, if necessary. VS generators will need this property
   * because the compiler path is not available via the `kit` nor `cache`
   * property.
   */
  clCompilerPath?: string|null;
}

/**
 * The actual class that provides information to the cpptools extension. See
 * the `CustomConfigurationProvider` interface for information on how this class
 * should be used.
 */
export class CppConfigurationProvider implements cpt.CustomConfigurationProvider {
  /** Our name visible to cpptools */
  readonly name = 'CMake Tools';
  /** Our extension ID, visible to cpptools */
  readonly extensionId = 'vector-of-bool.cmake-tools';

  /**
   * Get the SourceFileConfigurationItem from the index for the given URI
   * @param uri The configuration to get from the index
   */
  private _getConfiguration(uri: vscode.Uri): cpt.SourceFileConfigurationItem|undefined {
    const norm_path = util.normalizePath(uri.fsPath);
    return this._fileIndex.get(norm_path);
  }

  /**
   * Test if we are able to provide a configuration for the given URI
   * @param uri The URI to look up
   */
  async canProvideConfiguration(uri: vscode.Uri) { return !!this._getConfiguration(uri); }

  /**
   * Get the configurations for the given URIs. URIs for which we have no
   * configuration are simply ignored.
   * @param uris The file URIs to look up
   */
  async provideConfigurations(uris: vscode.Uri[]) { return util.dropNulls(uris.map(u => this._getConfiguration(u))); }

  /** No-op */
  dispose() {}

  /**
   * Index of files to configurations, using the normalized path to the file
   * as the key.
   */
  private readonly _fileIndex = new Map<string, cpt.SourceFileConfigurationItem>();

  /**
   * Create a source file configuration for the given file group.
   * @param grp The file group from the code model to create config data for
   * @param opts Index update options
   */
  private _buildConfigurationData(grp: cms.CodeModelFileGroup, opts: CodeModelParams): cpt.SourceFileConfiguration {
    // If the file didn't have a language, default to C++
    const lang = grp.language || 'CXX';
    // Try the group's language's compiler, then the C++ compiler, then the C compiler.
    const comp_cache = opts.cache.get(`CMAKE_${lang}_COMPILER`) || opts.cache.get('CMAKE_CXX_COMPILER')
        || opts.cache.get('CMAKE_C_COMPILER');
    // Try to get the path to the compiler we want to use
    const comp_path = comp_cache ? comp_cache.as<string>() : opts.clCompilerPath;
    if (!comp_path) {
      rollbar.error('Unable to automatically determine compiler', {lang, fileGroup: grp});
    }
    const is_msvc = comp_path && (path.basename(comp_path).toLocaleLowerCase() === 'cl.exe');
    return {
      defines: grp.defines || [],
      includePath: (grp.includePath || []).map(p => p.path),
      intelliSenseMode: is_msvc ? 'msvc-x64' : 'clang-x64',
      standard: 'c++17',  // TODO: Switch on correct standard
      compilerPath: comp_path || undefined,
    };
  }

  /**
   * Update the configuration index for the files in the given file group
   * @param sourceDir The source directory where the file group was defined. Used to resolve
   * relative paths
   * @param grp The file group
   * @param opts Index update options
   */
  private _updateFileGroup(sourceDir: string, grp: cms.CodeModelFileGroup, opts: CodeModelParams) {
    const configuration = this._buildConfigurationData(grp, opts);
    for (const src of grp.sources) {
      const abs = path.isAbsolute(src) ? src : path.join(sourceDir, src);
      const abs_norm = util.normalizePath(abs);
      this._fileIndex.set(abs_norm, {
        uri: vscode.Uri.file(abs).toString(),
        configuration,
      });
    }
  }

  /**
   * Update the file index and code model
   * @param opts Update parameters
   */
  updateConfigurationData(opts: CodeModelParams) {
    for (const config of opts.codeModel.configurations) {
      for (const project of config.projects) {
        for (const target of project.targets) {
          for (const grp of target.fileGroups || []) {
            this._updateFileGroup(target.sourceDirectory || '', grp, opts);
          }
        }
      }
    }
  }
}