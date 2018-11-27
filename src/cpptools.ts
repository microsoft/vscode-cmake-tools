/**
 * Module for vscode-cpptools integration.
 *
 * This module uses the [vscode-cpptools API](https://www.npmjs.com/package/vscode-cpptools)
 * to provide that extension with per-file configuration information.
 */ /** */

import {CMakeCache} from '@cmt/cache';
import * as cms from '@cmt/cms-client';
import {createLogger} from '@cmt/logging';
import rollbar from '@cmt/rollbar';
import * as shlex from '@cmt/shlex';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';

const log = createLogger('cpptools');

type StandardVersion = 'c89'|'c99'|'c11'|'c++98'|'c++03'|'c++11'|'c++14'|'c++17';

export interface CompileFlagInformation {
  extraDefinitions: string[];
  standard: StandardVersion;
}

class MissingCompilerException extends Error {}

interface TargetDefaults {
  includePath: string[];
  compileFlags: string[];
  defines: string[];
}

export function parseCompileFlags(args: string[]): CompileFlagInformation {
  const iter = args[Symbol.iterator]();
  const extraDefinitions: string[] = [];
  let standard: StandardVersion = 'c++17';
  while (1) {
    const {done, value} = iter.next();
    if (done) {
      break;
    }
    const lower = value.toLowerCase();
    if (value === '-D' || value === '/D') {
      // tslint:disable-next-line:no-shadowed-variable
      const {done, value} = iter.next();
      if (done) {
        rollbar.error('Unexpected end of parsing command line arguments');
        continue;
      }
      extraDefinitions.push(value);
    } else if (value.startsWith('-D') || value.startsWith('/D')) {
      const def = value.substring(2);
      extraDefinitions.push(def);
    } else if (value.startsWith('-std=') || lower.startsWith('-std:') || lower.startsWith('/std:')) {
      const std = value.substring(5);
      if (std.endsWith('++14') || std.endsWith('++1y')) {
        standard = 'c++14';
      } else if (std.endsWith('++17') || std.endsWith('++1z') || std.endsWith('++latest')) {
        standard = 'c++17';
      } else if (std.endsWith('++11') || std.endsWith('++0x')) {
        standard = 'c++11';
      } else if (std.endsWith('++2a')) {
        // Not yet supported...
      } else if (std.endsWith('++98')) {
        standard = 'c++98';
      } else if (std.endsWith('++03')) {
        standard = 'c++03';
      } else {
        // GNU options from: https://gcc.gnu.org/onlinedocs/gcc/C-Dialect-Options.html#C-Dialect-Options
        if (/(c|gnu)(90|89|iso9899:(1990|199409))/.test(value)) {
          standard = 'c89';
        } else if (/(c|gnu)(99|9x|iso9899:(1999|199x))/.test(value)) {
          standard = 'c99';
        } else if (/(c|gnu)(11|1x|iso9899:2011)/.test(value)) {
          standard = 'c11';
        } else if (/(c|gnu)(17|18|iso9899:(2017|2018))/.test(value)) {
          // Not supported by cpptools
          // standardVersion = 'c17';
          standard = 'c11';
        } else {
          log.warning('Unknown standard control flag: ', value);
          standard = 'c++17';
        }
      }
    }
  }
  return {extraDefinitions, standard};
}

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
   * This value determines if we need to show the user an error message about missing compilers. When an update succeeds
   * without missing any compilers, we set this to `true`, otherwise `false`.
   *
   * If an update fails and the value is `true`, we display the message. If an
   * update fails and the value is `false`, we do not display the message.
   *
   * This ensures that we only show the message the first time an update fails
   * within a sequence of failing updates.
   */
  private _lastUpdateSucceeded = true;

  private _workspaceBrowseConfiguration:cpt.WorkspaceBrowseConfiguration = {browsePath:[]};

  /**
   * Get the SourceFileConfigurationItem from the index for the given URI
   * @param uri The configuration to get from the index
   */
  private _getConfiguration(uri: vscode.Uri): cpt.SourceFileConfigurationItem|undefined {
    const norm_path = util.platformNormalizePath(uri.fsPath);
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

  /**
   * A request to determine whether this provider can provide a code browsing configuration for the workspace folder.
   * @param token (optional) The cancellation token.
   * @returns 'true' if this provider can provider a code browsing configuration for the workspace folder.
   */
  async canProvideBrowseConfiguration() {
    return true;
  }

  /**
   * A request to get the code browsing configuration for the workspace folder.
   * @returns A [WorkspaceBrowseConfiguration](#WorkspaceBrowseConfiguration) with the information required to
   * construct the equivalent of `browse.path` from `c_cpp_properties.json`.
   */
  async provideBrowseConfiguration() {
    return this._workspaceBrowseConfiguration;
  }

  /** No-op */
  dispose() {}

  /**
   * Index of files to configurations, using the normalized path to the file
   * as the key.
   */
  private readonly _fileIndex = new Map<string, cpt.SourceFileConfigurationItem>();

  /**
   * Create a source file configuration for the given file group.
   * @param fileGroup The file group from the code model to create config data for
   * @param opts Index update options
   */
  private _buildConfigurationData(fileGroup: cms.CodeModelFileGroup, opts: CodeModelParams, target: TargetDefaults):
      cpt.SourceFileConfiguration {
    // If the file didn't have a language, default to C++
    const lang = fileGroup.language || 'CXX';
    // Try the group's language's compiler, then the C++ compiler, then the C compiler.
    const comp_cache = opts.cache.get(`CMAKE_${lang}_COMPILER`) || opts.cache.get('CMAKE_CXX_COMPILER')
        || opts.cache.get('CMAKE_C_COMPILER');
    // Try to get the path to the compiler we want to use
    const comp_path = comp_cache ? comp_cache.as<string>() : opts.clCompilerPath;
    if (!comp_path) {
      throw new MissingCompilerException();
    }
    const is_msvc = comp_path && (path.basename(comp_path).toLocaleLowerCase() === 'cl.exe');
    const flags = fileGroup.compileFlags ? [...shlex.split(fileGroup.compileFlags)] : target.compileFlags;
    const {standard, extraDefinitions} = parseCompileFlags(flags);
    const defines = (fileGroup.defines || target.defines).concat(extraDefinitions);
    const includePath = fileGroup.includePath ? fileGroup.includePath.map(p => p.path) : target.includePath;

    const newBrowsePath = this._workspaceBrowseConfiguration.browsePath;
    for (const includePathItem of includePath) {
      if (newBrowsePath.indexOf(includePathItem) < 0) {
        newBrowsePath.push(includePathItem);
      }
    }
    this._workspaceBrowseConfiguration = {
      browsePath: newBrowsePath,
      standard,
      compilerPath: comp_path || undefined,
    };
    return {
      defines,
      standard,
      includePath,
      intelliSenseMode: is_msvc ? 'msvc-x64' : 'clang-x64',
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
  private _updateFileGroup(sourceDir: string,
                           grp: cms.CodeModelFileGroup,
                           opts: CodeModelParams,
                           target: TargetDefaults) {
    const configuration = this._buildConfigurationData(grp, opts, target);
    for (const src of grp.sources) {
      const abs = path.isAbsolute(src) ? src : path.join(sourceDir, src);
      const abs_norm = util.platformNormalizePath(abs);
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
    let hadMissingCompilers = false;
    this._workspaceBrowseConfiguration = {browsePath: []};
    for (const config of opts.codeModel.configurations) {
      for (const project of config.projects) {
        for (const target of project.targets) {
          /// Now some shenanigans since header files don't have config data:
          /// 1. Accumulate some "defaults" based on the set of all options for each file group
          /// 2. Pass these "defaults" down when rebuilding the config data
          /// 3. Any `fileGroup` that does not have the associated attribute will receive the `default`
          const grps = target.fileGroups || [];
          const includePath = [...new Set(util.flatMap(grps, grp => grp.includePath || []))].map(item => item.path);
          const compileFlags = [...new Set(util.flatMap(grps, grp => shlex.split(grp.compileFlags || '')))];
          const defines = [...new Set(util.flatMap(grps, grp => grp.defines || []))];
          for (const grp of target.fileGroups || []) {
            try {

              this._updateFileGroup(
                  target.sourceDirectory || '',
                  grp,
                  opts,
                  {
                    compileFlags,
                    includePath,
                    defines,
                  },
              );
            } catch (e) {
              if (e instanceof MissingCompilerException) {
                hadMissingCompilers = true;
              } else {
                throw e;
              }
            }
          }
        }
      }
    }
    if (hadMissingCompilers && this._lastUpdateSucceeded) {
      vscode.window.showErrorMessage('The path to the compiler for one or more source files was not found in ' +
                                     'the CMake cache. If you are using a toolchain file, this probably means ' +
                                     'that you need to specify the CACHE option when you set your C and/or C++ ' +
                                     'compiler path');
    }
    this._lastUpdateSucceeded = !hadMissingCompilers;
  }
}