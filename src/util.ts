import * as vscode from 'vscode';
import * as path from 'path';

export namespace Util {
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

  type Maybe<T> = (T|null);

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
      '-default': 'debug',
      '-description': 'The build type to use',
      debug: {
        oneWordSummary: 'Debug',
        buildType: 'Debug',
        description: 'Emit debug information without performing optimizations'
      },
      release: {
        oneWordSummary: 'Release',
        buildType: 'Release',
        description: 'Enable optimizations, omit debug info'
      },
      minsize: {
        oneWordSummary: 'MinSizeRel',
        buildType: 'MinSizeRel',
        description: 'Optimize for smallest binary size'
      },
      reldeb: {
        oneWordSummary: 'RelWithDebInfo',
        buildType: 'RelWithDebInfo',
        description: 'Perform optimizations AND include debugging information'
      }
    },
    // The world isn't ready...
    // link: {
    //   '-default': 'static',
    //   '-description': 'The link usage of build libraries',
    //   static: {
    //     oneWordSummary: 'Static',
    //     linkage: 'static',
    //     description: 'Emit Static Libraries'
    //   },
    //   shared: {
    //     oneWordSummary: 'Shared',
    //     linkage: 'shared',
    //     description: 'Emit shared libraries/DLLs'
    //   }
    // }
  };

  export interface WorkspaceCache {
    variant?: Maybe<VariantCombination>;
  };

  export function normalizePath(p: string): string {
    let norm = path.normalize(p);
    while (path.sep !== path.posix.sep && norm.includes(path.sep)) {
        norm = norm.replace(path.sep, path.posix.sep);
    }
    return norm
  }
}