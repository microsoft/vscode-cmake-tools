import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import * as async from './async';
import * as rimraf from 'rimraf';

import {CodeModelConfiguration} from './server-client';

export namespace util {
  export function rmdir(dirpath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      rimraf(dirpath, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  export function isMultiConfGenerator(gen: string): boolean {
    return gen.includes('Visual Studio') || gen.includes('Xcode');
  }
  export function product<T>(arrays: T[][]): T[][] {
    // clang-format off
    return arrays.reduce((acc, curr) =>
      acc
        // Append each element of the current array to each list already accumulated
        .map(
          prev => curr.map(
            item => prev.concat(item)
          )
        )
        .reduce(
          // Join all the lists
          (a, b) => a.concat(b),
          []
        ),
        [[]] as T[][]
      );
    // clang-format on
  }

  export type Maybe<T> = (T|null);

  export interface ConfigureArguments {
    key: string;
    value: (string|string[]|number|boolean);
  }

  export interface VariantConfigurationOptions {
    oneWordSummary?: string;
    description?: string;
    buildType?: Maybe<string>;
    linkage?: Maybe<string>;
    settings?: ConfigureArguments[];
    generator?: Maybe<string>;
    toolset?: Maybe<string>;
  }

  // export type VariantOptionChoices = Map<string, VariantOption>;

  export interface VariantSetting {
    description: string;
    default:
      string;
    choices: Map<string, VariantConfigurationOptions>;
  }

  export type VariantSet = Map<string, VariantSetting>;

  export interface VariantCombination extends vscode.QuickPickItem {
    keywordSettings: Map<string, string>;
  }

  export const DEFAULT_VARIANTS = {
    buildType: {
      'default$': 'debug',
      'description$': 'The build type to use',
      debug: {
        'oneWordSummary$': 'Debug',
        'description$': 'Emit debug information without performing optimizations',
        buildType: 'Debug',
      },
      release: {
        'oneWordSummary$': 'Release',
        'description$': 'Enable optimizations, omit debug info',
        buildType: 'Release',
      },
      minsize: {
        'oneWordSummary$': 'MinSizeRel',
        'description$': 'Optimize for smallest binary size',
        buildType: 'MinSizeRel',
      },
      reldeb: {
        'oneWordSummary$': 'RelWithDebInfo',
        'description$': 'Perform optimizations AND include debugging information',
        buildType: 'RelWithDebInfo',
      }
    },
    // The world isn't ready...
    // link: {
    //   ''$description$'': 'The link usage of build libraries',,
    //   'default$': 'static',
    //   static: {
    //     'oneWordSummary$': 'Static',
    //     'description$': 'Emit Static Libraries',
    //     linkage: 'static',
    //   },
    //   shared: {
    //     'oneWordSummary$': 'Shared',
    //     'description$': 'Emit shared libraries/DLLs',
    //     linkage: 'shared',
    //   }
    // }
  };

  export interface WorkspaceCache {
    variant?: Maybe<VariantCombination>;
    activeEnvironments?: string[];
    codeModel?: Maybe<CodeModelConfiguration[]>;
  };

  export function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
  }

  export function replaceAll(str: string, needle: string, what: string) {
    const pattern = escapeStringForRegex(needle);
    const re = new RegExp(pattern, 'g');
    return str.replace(re, what);
  }

  export function removeAllPatterns(str: string, patterns: string[]): string {
    return patterns.reduce((acc, needle) => {
      return replaceAll(acc, needle, '');
    }, str);
  }

  export function normalizePath(p: string, normalize_case=true): string {
    let norm = path.normalize(p);
    while (path.sep !== path.posix.sep && norm.includes(path.sep)) {
        norm = norm.replace(path.sep, path.posix.sep);
    }
    if (normalize_case && process.platform === 'win32') {
      norm = norm.toLocaleLowerCase().normalize();
    }
    return norm;
  }

  export abstract class OutputParser {
    public abstract parseLine(line: string): Maybe<number>;
  }

  export async function ensureDirectory(dirpath: string): Promise<void> {
    const abs = path.normalize(path.resolve(dirpath));
    if (!(await async.exists(dirpath))) {
      const parent = path.dirname(dirpath);
      await ensureDirectory(parent);
      try {
        await async.doVoidAsync(fs.mkdir, dirpath);
      } catch(e) {
        if (e.code == 'EEXIST') {
          // It already exists, but that's ok
          return;
        }
        throw e;
      }
    } else {
      if (!(await async.isDirectory(dirpath))) {
        throw new Error(`Failed to create directory: "${dirpath}" is an existing file and is not a directory`);
      }
    }
  }

  export async function writeFile(filepath: string, content: string): Promise<void> {
    await ensureDirectory(path.dirname(filepath));
    return new Promise<void>((resolve, reject) => {
      fs.writeFile(filepath, content, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      })
    })
  }


  export interface Version {
    major: number;
    minor: number;
    patch: number;
  }
  export function parserVersion(str: string): Version {
    const version_re = /(\d+)\.(\d+).(\d+)/;
    const mat = version_re.exec(str);
    if (!mat) {
      throw new Error(`Invalid version string ${str}`);
    }
    const [major, minor, patch] = mat!;
    return {
      major: parseInt(major),
      minor: parseInt(minor),
      patch: parseInt(patch),
    };
  }

  export function versionGreater(lhs: Version, rhs: Version | string): boolean {
    if (typeof(rhs) === 'string') {
      return versionGreater(lhs, parserVersion(rhs));
    }
    return lhs.major > rhs.major || (
      lhs.major == rhs.major &&
      lhs.minor > rhs.minor
    ) || (
      lhs.major == rhs.major &&
      lhs.minor == rhs.major &&
      lhs.patch == lhs.patch
    );
  }

  export function versionEquals(lhs: Version, rhs: Version | string): boolean {
    if (typeof(rhs) === 'string') {
      return versionEquals(lhs, parserVersion(rhs));
    }
    return lhs.major == rhs.major && lhs.minor == rhs.minor && lhs.patch == rhs.patch;
  }

  export function versionLess(lhs: Version, rhs: Version | string): boolean {
    return !versionGreater(lhs, rhs) && versionEquals(lhs, rhs);
  }
}