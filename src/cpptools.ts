/**
 * Module for vscode-cpptools integration.
 *
 * This module uses the [vscode-cpptools API](https://www.npmjs.com/package/vscode-cpptools)
 * to provide that extension with per-file configuration information.
 */ /** */

import {CMakeCache} from '@cmt/cache';
import * as codemodel_api from '@cmt/drivers/codemodel-driver-interface';
import {createLogger} from '@cmt/logging';
import rollbar from '@cmt/rollbar';
import * as shlex from '@cmt/shlex';
import * as util from '@cmt/util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as cpt from 'vscode-cpptools';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('cpptools');

type Architecture = 'x86' | 'x64' | 'arm' | 'arm64' | undefined;
type StandardVersion = 'c89'|'c99'|'c11'|'c18'|'c++98'|'c++03'|'c++11'|'c++14'|'c++17'|'c++20'|
  'gnu89'|'gnu99'|'gnu11'|'gnu18'|'gnu++98'|'gnu++03'|'gnu++11'|'gnu++14'|'gnu++17'|'gnu++20';


export interface CompileFlagInformation {
  extraDefinitions: string[];
  standard: StandardVersion;
  targetArch: Architecture;
}

class MissingCompilerException extends Error {}

interface TargetDefaults {
  name: string;
  includePath: string[];
  compileFlags: string[];
  defines: string[];
}

function parseCppStandard(std: string, can_use_gnu: boolean): StandardVersion|null {
  const is_gnu = can_use_gnu && std.startsWith('gnu');
  if (std.endsWith('++2a') || std.endsWith('++20') || std.endsWith('++latest')) {
    return is_gnu ? 'gnu++20' : 'c++20';
  } else if (std.endsWith('++17') || std.endsWith('++1z')) {
    return is_gnu ? 'gnu++17' : 'c++17';
  } else if (std.endsWith('++14') || std.endsWith('++1y')) {
    return is_gnu ? 'gnu++14' : 'c++14';
  } else if (std.endsWith('++11') || std.endsWith('++0x')) {
    return is_gnu ? 'gnu++11' : 'c++11';
  } else if (std.endsWith('++03')) {
    return is_gnu ? 'gnu++03' : 'c++03';
  } else if (std.endsWith('++98')) {
    return is_gnu ? 'gnu++98' : 'c++98';
  } else {
    return null;
  }
}

function parseCStandard(std: string, can_use_gnu: boolean): StandardVersion|null {
  // GNU options from: https://gcc.gnu.org/onlinedocs/gcc/C-Dialect-Options.html#C-Dialect-Options
  const is_gnu = can_use_gnu && std.startsWith('gnu');
  if (/(c|gnu)(90|89|iso9899:(1990|199409))/.test(std)) {
    return is_gnu ? 'gnu89' : 'c89';
  } else if (/(c|gnu)(99|9x|iso9899:(1999|199x))/.test(std)) {
    return is_gnu ? 'gnu99' : 'c99';
  } else if (/(c|gnu)(11|1x|iso9899:2011)/.test(std)) {
    return is_gnu ? 'gnu11' : 'c11';
  } else if (/(c|gnu)(17|18|iso9899:(2017|2018))/.test(std)) {
    if (can_use_gnu) {
      // cpptools supports 'c18' in same version it supports GNU std.
      return is_gnu ? 'gnu18' : 'c18';
    } else {
      return 'c11';
    }
  } else {
    return null;
  }
}

function parseTargetArch(target: string): Architecture {
  // Value of target param is lowercased.
  const is_arm_32: (value: string) => boolean = value => {
    // ARM verions from https://en.wikipedia.org/wiki/ARM_architecture#Cores
    if (value.indexOf('armv8-r') >=0 || value.indexOf('armv8-m') >=0) {
      return true;
    } else {
      // Check if ARM version is 7 or earlier.
      const verStr = value.substr(5, 1);
      const verNum = +verStr;
      return verNum <= 7;
    }
  };
  switch(target) {
    case '-m32':
    case 'i686':
      return 'x86';
    case '-m64':
    case 'amd64':
    case 'x86_64':
      return 'x64';
  }
  // Check triple target value
  if (target.indexOf('aarch64') >= 0 || target.indexOf('armv8-a') >= 0 || target.indexOf('armv8.') >= 0) {
    return 'arm64';
  } else if (target.indexOf('arm') >= 0 || is_arm_32(target)) {
    return 'arm';
  }
  // TODO: whitelist architecture values and add telemetry
  return undefined;
}

export function parseCompileFlags(cptVersion: cpt.Version, args: string[], lang?: string): CompileFlagInformation {
  const can_use_gnu_std = (cptVersion >= cpt.Version.v4);
  const iter = args[Symbol.iterator]();
  const extraDefinitions: string[] = [];
  let standard: StandardVersion = (lang === 'C') ? 'c11' : 'c++17';
  let targetArch: Architecture = undefined;
  while (1) {
    const {done, value} = iter.next();
    if (done) {
      break;
    }
    const lower = value.toLowerCase();
    if (lower === '-m32' || lower === '-m64') {
      targetArch = parseTargetArch(lower);
    } else if (lower.startsWith('-arch=') || lower.startsWith('/arch:')) {
      const target = lower.substring(6);
      targetArch = parseTargetArch(target);
    } else if (lower === '-arch') {
      // tslint:disable-next-line:no-shadowed-variable
      const {done, value} = iter.next();
      if (done) {
        // TODO: whitelist architecture values and add telemetry
        continue;
      }
      targetArch = parseTargetArch(value.toLowerCase());
    } else if (lower.startsWith('-march=')) {
      const target = lower.substring(7);
      targetArch = parseTargetArch(target);
    } else if (lower.startsWith('--target=')) {
      const target = lower.substring(9);
      targetArch = parseTargetArch(target);
    } else if (lower === '-target') {
      // tslint:disable-next-line:no-shadowed-variable
      const {done, value} = iter.next();
      if (done) {
        // TODO: whitelist architecture values and add telemetry
        continue;
      }
      targetArch = parseTargetArch(value.toLowerCase());
    } else if (value === '-D' || value === '/D') {
      // tslint:disable-next-line:no-shadowed-variable
      const {done, value} = iter.next();
      if (done) {
        rollbar.error(localize('unexpected.end.of.arguments', 'Unexpected end of parsing command line arguments'));
        continue;
      }
      extraDefinitions.push(value);
    } else if (value.startsWith('-D') || value.startsWith('/D')) {
      const def = value.substring(2);
      extraDefinitions.push(def);
    } else if (value.startsWith('-std=') || lower.startsWith('-std:') || lower.startsWith('/std:')) {
      const std = value.substring(5);
      if (lang === 'CXX' || lang === 'OBJCXX' ) {
        const s = parseCppStandard(std, can_use_gnu_std);
        if (s === null) {
          log.warning(localize('unknown.control.gflag.cpp', 'Unknown C++ standard control flag: {0}', value));
        } else {
          standard = s;
        }
      } else if (lang === 'C' || lang === 'OBJC' ) {
        const s = parseCStandard(std, can_use_gnu_std);
        if (s === null) {
          log.warning(localize('unknown.control.gflag.c', 'Unknown C standard control flag: {0}', value));
        } else {
          standard = s;
        }
      } else if (lang === undefined) {
        let s = parseCppStandard(std, can_use_gnu_std);
        if (s === null) {
          s = parseCStandard(std, can_use_gnu_std);
        }
        if (s === null) {
          log.warning(localize('unknown.control.gflag', 'Unknown standard control flag: {0}', value));
        } else {
          standard = s;
        }
      } else {
        log.warning(localize('unknown language', 'Unknown language: {0}', value));
      }
    }
  }
  return {extraDefinitions, standard, targetArch};
}

/**
 * Determine the IntelliSenseMode based on hints from compiler path
 * and target architecture parsed from compiler flags.
 */
export function getIntelliSenseMode(cptVersion: cpt.Version, compiler_path: string, target_arch: Architecture) {
  const can_use_arm = (cptVersion >= cpt.Version.v4);
  const compiler_name = path.basename(compiler_path || "").toLocaleLowerCase();
  if (compiler_name === 'cl.exe') {
    const clArch = path.basename(path.dirname(compiler_path)).toLocaleLowerCase();
    switch (clArch) {
      case 'arm64':
        return can_use_arm ? 'msvc-arm64' : 'msvc-x64';
      case 'arm':
        return can_use_arm ? 'msvc-arm' : 'msvc-x86';
      case 'x86':
        return 'msvc-x86';
      case 'x64':
      default:
        return 'msvc-x64';
    }
  } else if (compiler_name.indexOf('armclang') >= 0) {
    switch (target_arch) {
      case 'arm64':
        return can_use_arm ? 'clang-arm64' : 'clang-x64';
      case 'arm':
      default:
        return can_use_arm ? 'clang-arm' : 'clang-x86';
    }
  } else if (compiler_name.indexOf('clang') >= 0) {
    switch (target_arch) {
      case 'arm64':
        return can_use_arm ? 'clang-arm64' : 'clang-x64';
      case 'arm':
        return can_use_arm ? 'clang-arm' : 'clang-x86';
      case 'x86':
        return 'clang-x86';
      case 'x64':
      default:
        return 'clang-x64';
    }
  }  else if (compiler_name.indexOf('aarch64') >= 0) {
    // Compiler with 'aarch64' in its name may also have 'arm', so check for
    // aarch64 compilers before checking for ARM specific compilers.
    return can_use_arm ? 'gcc-arm64' : 'gcc-x64';
  } else if (compiler_name.indexOf('arm') >= 0) {
    return can_use_arm ? 'gcc-arm' : 'gcc-x86';
  } else if (compiler_name.indexOf('gcc') >= 0 || compiler_name.indexOf('g++') >= 0) {
    switch (target_arch) {
      case 'x86':
        return 'gcc-x86';
      case 'x64':
      default:
        return 'gcc-x64';
    }
  } else {
    // unknown compiler; pick platform defaults.
    if (process.platform === 'win32') {
      return 'msvc-x64';
    } else if (process.platform === 'darwin') {
      return 'clang-x64';
    } else {
      return 'gcc-x64';
    }
  }
}

/**
 * Type given when updating the configuration data stored in the file index.
 */
export interface CodeModelParams {
  /**
   * The CMake codemodel content. This is the important one.
   */
  codeModel: codemodel_api.CodeModelContent;
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
  /**
   * The active target
   */
  activeTarget: string|null;
  /**
   * Workspace folder full path.
   */
  folder: string;
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
  readonly extensionId = 'ms-vscode.cmake-tools';
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

  private _workspaceBrowseConfiguration: cpt.WorkspaceBrowseConfiguration = {browsePath: []};
  private readonly _workspaceBrowseConfigurations = new Map<string, cpt.WorkspaceBrowseConfiguration>();

  /**
   * Get the SourceFileConfigurationItem from the index for the given URI
   * @param uri The configuration to get from the index
   */
  private _getConfiguration(uri: vscode.Uri): cpt.SourceFileConfigurationItem|undefined {
    const norm_path = util.platformNormalizePath(uri.fsPath);
    const configurations = this._fileIndex.get(norm_path);
    if (this._activeTarget && configurations?.has(this._activeTarget)) {
      return configurations!.get(this._activeTarget);
    } else {
      return configurations?.values().next().value; // Any value is fine if the target doesn't match
    }
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
  async canProvideBrowseConfiguration() { return true; }

  /**
   * A request to get the code browsing configuration for the workspace folder.
   * @returns A [WorkspaceBrowseConfiguration](#WorkspaceBrowseConfiguration) with the information required to
   * construct the equivalent of `browse.path` from `c_cpp_properties.json`.
   */
  async provideBrowseConfiguration() { return this._workspaceBrowseConfiguration; }

  async canProvideBrowseConfigurationsPerFolder() { return true; }

  async provideFolderBrowseConfiguration(_uri: vscode.Uri): Promise<cpt.WorkspaceBrowseConfiguration> {
    return this._workspaceBrowseConfigurations.get(util.platformNormalizePath(_uri.fsPath)) ?? this._workspaceBrowseConfiguration;
  }

  /** No-op */
  dispose() {}

  /**
   * Version of Cpptools API
   */
  private _cpptoolsVersion: cpt.Version = cpt.Version.latest;

  /**
   * Index of files to configurations, using the normalized path to the file
   * as the key to the <target,configuration>.
   */
  private readonly _fileIndex = new Map<string, Map<string, cpt.SourceFileConfigurationItem>>();

  /**
   * If a source file configuration exists for the active target, we will prefer that one when asked.
   */
  private _activeTarget: string|null = null;

  /**
   * Create a source file configuration for the given file group.
   * @param fileGroup The file group from the code model to create config data for
   * @param opts Index update options
   */
  private _buildConfigurationData(fileGroup: codemodel_api.CodeModelFileGroup, opts: CodeModelParams, target: TargetDefaults, sysroot: string):
      cpt.SourceFileConfiguration {
    // If the file didn't have a language, default to C++
    const lang = fileGroup.language === "RC" ? undefined : fileGroup.language;
    // Try the group's language's compiler, then the C++ compiler, then the C compiler.
    const comp_cache = opts.cache.get(`CMAKE_${lang}_COMPILER`) || opts.cache.get('CMAKE_CXX_COMPILER')
        || opts.cache.get('CMAKE_C_COMPILER');
    // Try to get the path to the compiler we want to use
    const comp_path = comp_cache ? comp_cache.as<string>() : opts.clCompilerPath;
    if (!comp_path) {
      throw new MissingCompilerException();
    }
    const normalizedCompilerPath = util.platformNormalizePath(comp_path);
    const flags = fileGroup.compileFlags ? [...shlex.split(fileGroup.compileFlags)] : target.compileFlags;
    const {standard, extraDefinitions, targetArch} = parseCompileFlags(this.cpptoolsVersion, flags, lang);
    const defines = (fileGroup.defines || target.defines).concat(extraDefinitions);
    const includePath = fileGroup.includePath ? fileGroup.includePath.map(p => p.path) : target.includePath;
    const normalizedIncludePath = includePath.map(p => util.platformNormalizePath(p));

    const newBrowsePath = this._workspaceBrowseConfiguration.browsePath;
    for (const includePathItem of normalizedIncludePath) {
      if (newBrowsePath.indexOf(includePathItem) < 0) {
        newBrowsePath.push(includePathItem);
      }
    }

    if (sysroot) {
      flags.push(`--sysroot=${sysroot}`);
    }

    this._workspaceBrowseConfiguration = {
      browsePath: newBrowsePath,
      standard,
      compilerPath: normalizedCompilerPath || undefined,
      compilerArgs: flags || undefined
    };

    this._workspaceBrowseConfigurations.set(util.platformNormalizePath(opts.folder), this._workspaceBrowseConfiguration);

    return {
      defines,
      standard,
      includePath: normalizedIncludePath,
      intelliSenseMode: getIntelliSenseMode(this.cpptoolsVersion, comp_path, targetArch),
      compilerPath: normalizedCompilerPath || undefined,
      compilerArgs: flags || undefined
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
                           grp: codemodel_api.CodeModelFileGroup,
                           opts: CodeModelParams,
                           target: TargetDefaults,
                           sysroot: string) {
    const configuration = this._buildConfigurationData(grp, opts, target, sysroot);
    for (const src of grp.sources) {
      const abs = path.isAbsolute(src) ? src : path.join(sourceDir, src);
      const abs_norm = util.platformNormalizePath(abs);
      if (this._fileIndex.has(abs_norm)) {
        this._fileIndex.get(abs_norm)!.set(target.name, {
          uri: vscode.Uri.file(abs).toString(),
          configuration
        });
      } else {
        const data = new Map<string, cpt.SourceFileConfigurationItem>();
        data.set(target.name, {
          uri: vscode.Uri.file(abs).toString(),
          configuration,
        });
        this._fileIndex.set(abs_norm, data);
      }
      const dir = path.dirname(abs_norm);
      if (this._workspaceBrowseConfiguration.browsePath.indexOf(dir) < 0) {
        this._workspaceBrowseConfiguration.browsePath.push(dir);
      }
    }
  }

    /**
   * Gets the version of Cpptools API.
   */
  get cpptoolsVersion(): cpt.Version {
    return this._cpptoolsVersion;
  }
  /**
   * Set the version of Cpptools API.
   * @param value of CppTools API version
   */
  set cpptoolsVersion(value: cpt.Version) {
    this._cpptoolsVersion = value;
  }

  /**
   * Update the file index and code model
   * @param opts Update parameters
   */
  updateConfigurationData(opts: CodeModelParams) {
    let hadMissingCompilers = false;
    this._workspaceBrowseConfiguration = {browsePath: []};
    this._activeTarget = opts.activeTarget;
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
          const sysroot = target.sysroot || '';
          for (const grp of target.fileGroups || []) {
            try {
              this._updateFileGroup(
                  target.sourceDirectory || '',
                  grp,
                  opts,
                  {
                    name: target.name,
                    compileFlags,
                    includePath,
                    defines,
                  },
                  sysroot
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
      vscode.window.showErrorMessage(localize('path.not.found.in.cmake.cache',
        'The path to the compiler for one or more source files was not found in the CMake cache. If you are using a toolchain file, this probably means that you need to specify the CACHE option when you set your C and/or C++ compiler path'));
    }
    this._lastUpdateSucceeded = !hadMissingCompilers;
  }
}
