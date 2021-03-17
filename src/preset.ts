import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
import * as path from 'path';

import * as util from '@cmt/util';
import * as logging from '@cmt/logging';
import { EnvironmentVariables } from '@cmt/proc';
import { expandString, ExpansionOptions } from '@cmt/expand';
import paths from '@cmt/paths';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('preset');

export interface PresetsFile {
  version: number;
  cmakeMinimumRequired: CmakeMinimumRequired;
  configurePresets: ConfigurePreset[] | undefined;
  buildPresets: BuildPreset[] | undefined;
  testPresets: TestPreset[] | undefined;
}

export interface CmakeMinimumRequired {
  major: number;
  minor: number;
  patch: number;
}

export interface Preset {
  name: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  inherits?: string[];
  environment?: { [key: string]: null | string };
  vendor?: object;

  __expanded?: boolean; // Private field to indicate if we have already expaned thie preset.
}

export interface ValueStrategy {
  value?: string;
  strategy?: 'set' | 'external';
}

export interface WarningOptions {
  dev?: boolean;
  deprecated?: boolean;
  uninitialized?: boolean;
  unusedCli?: boolean;
  systemVars?: boolean;
}

export interface ErrorOptions {
  dev?: boolean;
  deprecated?: boolean;
}

export interface DebugOptions {
  output?: boolean;
  tryCompile?: boolean;
  find?: boolean;
}

export interface ConfigurePreset extends Preset {
  generator?: string;
  architecture?: string | ValueStrategy;
  toolset?: string | ValueStrategy;
  binaryDir?: string;
  cmakeExecutable?: string;
  cacheVariables?: { [key: string]: null | boolean | string | { type: string, value: boolean | string } };
  warnings?: WarningOptions;
  errors?: ErrorOptions;
  debug?: DebugOptions;
}

export interface BuildPreset extends Preset {
  configurePreset?: string;
  inheritConfigureEnvironment?: boolean; // Defaults to true
  jobs?: number;
  targets?: string | string[];
  configuration?: string;
  cleanFirst?: boolean;
  verbose?: boolean;
  nativeToolOptions?: string[];

  __binaryDir?: string; // Private field since we are getting this from the config preset
  __generator?: string; // Private field since we are getting this from the config preset
}

export interface OutputOptions {
  shortProgress?: boolean;
  verbosity?: 'default' | 'verbose' | 'extra';
  debug?: boolean;
  outputOnFailure?: boolean;
  quiet?: boolean;
  outputLogFile?: string;
  labelSummary?: boolean;
  subprojectSummary?: boolean;
  maxPassedTestOutputSize?: number;
  maxFailedTestOutputSize?: number;
  maxTestNameWidth?: number;
}

export interface IncludeFilter {
  name?: string;
  label?: string;
  useUnion?: boolean;
  index?: string | { start?: number, end?: number, stride?: number, specificTests?: number[] };
}

export interface ExcludeFilter {
  name?: string;
  label?: string;
  fixtures?: { any: string, setup: string, cleanup: string };
}

export interface TestFilter {
  include?: IncludeFilter;
  exclude?: ExcludeFilter;
}

export interface ExecutionOptions {
  stopOnFailure?: boolean;
  enableFailover?: boolean;
  jobs?: number;
  resourceSpecFile?: string;
  testLoad?: number;
  showOnly?: 'human' | 'json-v1';
  repeat?: { mode: 'until-fail' | 'until-pass' | 'after-timeout', count: number};
  interactiveDebugging?: boolean;
  scheduleRandom?: boolean;
  timeout?: number;
  noTestsAction?: 'default' | 'error' | 'ignore';
}

export interface TestPreset extends Preset {
  configurePreset?: string;
  inheritConfigureEnvironment?: boolean; // Defaults to true
  configuration?: string;
  overwriteConfigurationFile?: string[];
  output?: OutputOptions;
  filter?: TestFilter;
  execution?: ExecutionOptions;
}

let presetsFile: PresetsFile | undefined;
let userPresetsFile: PresetsFile | undefined;
const presetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();
const userPresetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();

export function presetsExist() {
  return !!presetsFile;
}

export function getPresetsFile() {
  return presetsFile;
}

export function userPresetsExist() {
  return !!userPresetsFile;
}

export function getUserPresetsFile() {
  return userPresetsFile;
}

export function setPresetsFile(presets: PresetsFile | undefined) {
  presetsFile = presets;
  presetsChangedEmitter.fire();
}

export function setUserPresetsFile(presets: PresetsFile | undefined) {
  userPresetsFile = presets;
  userPresetsChangedEmitter.fire();
}

function getDisplayName(name: string, presets: Preset[]): string | null {
  for (const preset of presets) {
    if (preset.name === name) {
      return preset.displayName || preset.name;
    }
  }

  return null;
}

export function getConfigurePresetDisplayName(name: string): string | null {
  return getDisplayName(name, allConfigurePresets());
}
export function getBuildPresetDisplayName(name: string): string | null {
  return getDisplayName(name, allBuildPresets());
}
export function getTestPresetDisplayName(name: string): string | null {
  return getDisplayName(name, allTestPresets());
}

export function configurePresets() { return presetsFile?.configurePresets || []; }

export function userConfigurePresets() { return userPresetsFile?.configurePresets || []; }

/**
 * Don't use this function if you need to keep any changes in the presets
 */
export function allConfigurePresets() { return configurePresets().concat(userConfigurePresets()); }

export function buildPresets() { return presetsFile?.buildPresets || []; }

export function userBuildPresets() { return userPresetsFile?.buildPresets || []; }

/**
 * Don't use this function if you need to keep any changes in the presets
 */
export function allBuildPresets() { return buildPresets().concat(userBuildPresets()); }

export function testPresets() { return presetsFile?.testPresets || []; }

export function userTestPresets() { return userPresetsFile?.testPresets || []; }

/**
 * Don't use this function if you need to keep any changes in the presets
 */
export function allTestPresets() { return testPresets().concat(userTestPresets()); }

/**
 * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
 */
export function onPresetsChanged(listener: () => any) { return presetsChangedEmitter.event(listener); }

/**
 * Call configurePresets, buildPresets, or testPresets to get the latest presets when thie event is fired.
 */
export function onUserPresetsChanged(listener: () => any) { return userPresetsChangedEmitter.event(listener); }

export function getPresetByName<T extends Preset>(presets: T[], name: string): T | null {
  for (const preset of presets) {
    if (preset.name === name) {
      return preset;
    }
  }
  return null;
}

const referencedConfigurePresets: Set<string> = new Set();

/**
 * This function can NOT be invoked on extension initialization. Or there might be deadlocks
 */
export function expandConfigurePreset(name: string,
                                      workspaceFolder: string,
                                      sourceDir: string,
                                      allowUserPreset: boolean = false): Promise<ConfigurePreset | null> {
  referencedConfigurePresets.clear();
  return expandConfigurePresetImpl(name, workspaceFolder, sourceDir, allowUserPreset);
}

async function expandConfigurePresetImpl(name: string,
                                         workspaceFolder: string,
                                         sourceDir: string,
                                         allowUserPreset: boolean = false): Promise<ConfigurePreset | null> {
  let preset = getPresetByName(configurePresets(), name);
  if (preset) {
    return expandConfigurePresetHelper(preset, workspaceFolder, sourceDir);
  }

  if (allowUserPreset) {
    preset = getPresetByName(userConfigurePresets(), name);
    if (preset) {
      return expandConfigurePresetHelper(preset, workspaceFolder, sourceDir, true);
    }
  }

  log.error(localize('config.preset.not.found', 'Could not find configure preset with name {0}', name));
  return null;
}

async function expandConfigurePresetHelper(preset: ConfigurePreset,
                                           workspaceFolder: string,
                                           sourceDir: string,
                                           allowUserPreset: boolean = false) {
  if (preset.__expanded) {
    return preset;
  }

  if (referencedConfigurePresets.has(preset.name) && !preset.__expanded) {
    // Refernced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
    log.error('circular.inherits.in.config.preset', 'Circular inherits in configure preset {0}', preset.name);
    return null;
  }

  referencedConfigurePresets.add(preset.name);

  // Init env and cacheVar to empty if not specified to avoid null checks later
  if (!preset.environment) {
    preset.environment = {};
  }
  if (!preset.cacheVariables) {
    preset.cacheVariables = {};
  }

  // Expand inherits
  if (preset.inherits) {
    for (const parentName of preset.inherits) {
      const parent = await expandConfigurePresetImpl(parentName, workspaceFolder, sourceDir, allowUserPreset);
      if (parent) {
        // Inherit environment
        preset.environment = util.mergeEnvironment(parent.environment! as EnvironmentVariables, preset.environment as EnvironmentVariables);
        // Inherit cache vars
        for (const name in parent.cacheVariables) {
          if (!preset.cacheVariables[name]) {
            preset.cacheVariables[name] = parent.cacheVariables[name];
          }
        }
        // Inherit other fields
        let key: keyof ConfigurePreset;
        for (key in parent) {
          if (preset[key] === undefined) {
            // 'as never' to bypass type check
            preset[key] = parent[key] as never;
          }
        }
      }
    }
  }

  preset.environment = util.mergeEnvironment(process.env as EnvironmentVariables, preset.environment as EnvironmentVariables);

  // Expand strings
  const expansionOpts: ExpansionOptions = {
    vars: {
      generator: preset.generator || 'null',
      workspaceFolder,
      workspaceFolderBasename: path.basename(workspaceFolder),
      workspaceHash: util.makeHashString(workspaceFolder),
      workspaceRoot: workspaceFolder,
      workspaceRootFolderName: path.dirname(workspaceFolder),
      userHome: paths.userHome,
      sourceDir: sourceDir,
      sourceParentDir: path.dirname(sourceDir),
      sourceDirName: path.basename(sourceDir),
      presetName: preset.name
    },
    envOverride: preset.environment as EnvironmentVariables,
    recursive: true
  };
  // Expand environment vars first since other fields may refer to them
  if (preset.environment) {
    for (const key in preset.environment) {
      if (preset.environment[key]) {
        preset.environment[key] = await expandString(preset.environment[key]!, expansionOpts);
      }
    }
  }
  if (preset.binaryDir) {
    preset.binaryDir = util.lightNormalizePath(await expandString(preset.binaryDir, expansionOpts));
  }
  if (preset.cmakeExecutable) {
    preset.cmakeExecutable = await expandString(preset.cmakeExecutable, expansionOpts);
  }

  type CacheVarObjType = { type: string, value: string | boolean};
  for (const cacheVarName in preset.cacheVariables) {
    if (util.isString(preset.cacheVariables[cacheVarName])) {
      preset.cacheVariables[cacheVarName] = await expandString(preset.cacheVariables[cacheVarName] as string, expansionOpts);
    } else if (util.isString((preset.cacheVariables[cacheVarName] as CacheVarObjType).value)) {
      (preset.cacheVariables[cacheVarName] as CacheVarObjType).value = await expandString((preset.cacheVariables[cacheVarName] as CacheVarObjType).value as string, expansionOpts);
    }
  }

  preset.__expanded = true;
  return preset;
}

// Used for both getConfigurePresetForBuildPreset and expandBuildPreset.
const referencedBuildPresets: Set<string> = new Set();

/**
 * This is actually a very limited version of expandBuildPreset.
 * This function CAN be invoked during extension initialization.
 * They should NOT be used together.
 * They should Not call each other.
 */
export function getConfigurePresetForBuildPreset(name: string): string | null {
  referencedBuildPresets.clear();
  return getConfigurePresetForBuildPresetImpl(name);
}

function getConfigurePresetForBuildPresetImpl(name: string, allowUserPreset: boolean = false): string | null {
  let preset = getPresetByName(buildPresets(), name);
  if (preset) {
    return getConfigurePresetForBuildPresetHelper(preset);
  }

  if (allowUserPreset) {
    preset = getPresetByName(userBuildPresets(), name);
    if (preset) {
      return getConfigurePresetForBuildPresetHelper(preset, true);
    }
  }

  return null;
}

function getConfigurePresetForBuildPresetHelper(preset: BuildPreset, allowUserPreset: boolean = false): string | null {
  if (preset.configurePreset) {
    return preset.configurePreset;
  }

  if (preset.__expanded) {
    return preset.configurePreset || null;
  }

  if (referencedBuildPresets.has(preset.name)) {
    // Refernced this preset before, but it doesn't have a configure preset. This is a circular inheritance.
    log.error('circular.inherits.in.build.preset', 'Circular inherits in build preset {0}', preset.name);
    return null;
  }

  referencedBuildPresets.add(preset.name);

  if (preset.inherits) {
    for (const parent of preset.inherits) {
      const parentConfigurePreset = getConfigurePresetForBuildPresetImpl(parent, allowUserPreset);
      if (parentConfigurePreset) {
        preset.configurePreset = parentConfigurePreset;
        return parentConfigurePreset;
      }
    }
  }

  return null;
}

/**
 * This function can NOT be invoked on extension initialization. Or there might be deadlocks
 */
export function expandBuildPreset(name: string,
                                  workspaceFolder: string,
                                  sourceDir: string,
                                  allowUserPreset: boolean = false): Promise<BuildPreset | null> {
  referencedBuildPresets.clear();
  return expandBuildPresetImpl(name, workspaceFolder, sourceDir, allowUserPreset);
}

async function expandBuildPresetImpl(name: string,
                                     workspaceFolder: string,
                                     sourceDir: string,
                                     allowUserPreset: boolean = false): Promise<BuildPreset | null> {
  let preset = getPresetByName(buildPresets(), name);
  if (preset) {
    return expandBuildPresetHelper(preset, workspaceFolder, sourceDir);
  }

  if (allowUserPreset) {
    preset = getPresetByName(userBuildPresets(), name);
    if (preset) {
      return expandBuildPresetHelper(preset, workspaceFolder, sourceDir, true);
    }
  }

  log.error(localize('build.preset.not.found', 'Could not find build preset with name {0}', name));
  return null;
}

async function expandBuildPresetHelper(preset: BuildPreset,
                                       workspaceFolder: string,
                                       sourceDir: string,
                                       allowUserPreset: boolean = false) {
  if (preset.__expanded) {
    return preset;
  }

  if (referencedBuildPresets.has(preset.name) && !preset.__expanded) {
    // Refernced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
    // Notice that we check !preset.__expanded here but not in getConfigurePresetForBuildPresetHelper because
    // multiple parents could all point to the same parent.
    log.error('circular.inherits.in.build.preset', 'Circular inherits in build preset {0}', preset.name);
    return null;
  }

  referencedBuildPresets.add(preset.name);

  // Init env to empty if not specified to avoid null checks later
  if (!preset.environment) {
    preset.environment = {};
  }
  let inheritedEnv = {};

  // Expand inherits
  if (preset.inherits) {
    for (const parentName of preset.inherits) {
      const parent = await expandBuildPresetImpl(parentName, workspaceFolder, sourceDir, allowUserPreset);
      if (parent) {
        // Inherit environment
        inheritedEnv = util.mergeEnvironment(parent.environment! as EnvironmentVariables, inheritedEnv);
        // Inherit other fields
        let key: keyof BuildPreset;
        for (key in parent) {
          if (preset[key] === undefined) {
            // 'as never' to bypass type check
            preset[key] = parent[key] as never;
          }
        }
      }
    }
  }

  // Expand configure preset. Evaluate this after inherits since it may come from parents
  if (preset.configurePreset) {
    const configurePreset = await expandConfigurePreset(preset.configurePreset, workspaceFolder, sourceDir, allowUserPreset);
    if (configurePreset) {
      preset.__binaryDir = configurePreset.binaryDir;
      preset.__generator = configurePreset.generator;

      if (preset.inheritConfigureEnvironment !== false) { // Check false explicitly since defaults to true
        inheritedEnv = util.mergeEnvironment(inheritedEnv, configurePreset.environment! as EnvironmentVariables);
      }
    }
  }

  preset.environment = util.mergeEnvironment(process.env as EnvironmentVariables, inheritedEnv, preset.environment as EnvironmentVariables);

  const expansionOpts: ExpansionOptions = {
    vars: {
      generator: preset.__generator || 'null',
      workspaceFolder,
      workspaceFolderBasename: path.basename(workspaceFolder),
      workspaceHash: util.makeHashString(workspaceFolder),
      workspaceRoot: workspaceFolder,
      workspaceRootFolderName: path.dirname(workspaceFolder),
      userHome: paths.userHome,
      sourceDir: sourceDir,
      sourceParentDir: path.dirname(sourceDir),
      sourceDirName: path.basename(sourceDir),
      presetName: preset.name
    },
    envOverride: preset.environment as EnvironmentVariables,
    recursive: true
  };
  // Expand environment vars first since other fields may refer to them
  if (preset.environment) {
    for (const key in preset.environment) {
      if (preset.environment[key]) {
        preset.environment[key] = await expandString(preset.environment[key]!, expansionOpts);
      }
    }
  }

  preset.__expanded = true;
  return preset;
}

export function configureArgs(preset: ConfigurePreset): string[] {
  const result: string[] = [];

  // CacheVariables
  if (preset.cacheVariables) {
    util.objectPairs(preset.cacheVariables).forEach(([key, value]) => {
      if (util.isString(value) || typeof value === 'boolean') {
        result.push(`-D${key}=${value}`);
      } else if (value) {
        result.push(`-D${key}:${value.type}=${value.value}`);
      }
    });
  }

  // Warnings
  if (preset.warnings) {
    if (preset.warnings.dev !== undefined) {
      result.push(preset.warnings.dev ? '-Wdev' : '-Wno-dev');
    }
    if (preset.warnings.deprecated !== undefined) {
      result.push(preset.warnings.deprecated ? '-Wdeprecated' : '-Wno-deprecated');
    }
    /* tslint:disable:no-unused-expression */
    preset.warnings.uninitialized && result.push('--warn-uninitialized');
    preset.warnings.unusedCli && result.push('--no-warn-unused-cli');
    preset.warnings.systemVars && result.push('--check-system-vars');
    /* tslint:enable:no-unused-expression */
  }

  // Errors
  if (preset.errors) {
    if (preset.errors.dev !== undefined) {
      result.push(preset.errors.dev ? '-Werror=dev' : '-Wno-error=dev');
    }
    if (preset.errors.deprecated !== undefined) {
      result.push(preset.errors.deprecated ? '-Werror=deprecated' : '-Wno-error=deprecated');
    }
  }

  // Debug
  if (preset.debug) {
    /* tslint:disable:no-unused-expression */
    preset.debug.output && result.push('--debug-output');
    preset.debug.tryCompile && result.push('--debug-trycompile');
    preset.debug.find && result.push('--debug-find');
    /* tslint:enable:no-unused-expression */
  }

  return result;
}

export function buildArgs(preset: BuildPreset): string[] {
  const result: string[] = [];

  /* tslint:disable:no-unused-expression */

  preset.__binaryDir && result.push('--build', preset.__binaryDir);
  preset.jobs && result.push('--parallel', preset.jobs.toString());
  preset.configuration && result.push('--config ', preset.configuration);
  preset.cleanFirst && result.push('--clean-first');
  preset.verbose && result.push('--verbose');

  if (util.isString(preset.targets)) {
    result.push('--target', preset.targets);
  } else if (util.isArrayOfString(preset.targets)) {
    for (const target of preset.targets) {
      result.push('--target', target);
    }
  }

  preset.nativeToolOptions && result.push('--', ...preset.nativeToolOptions);

  /* tslint:enable:no-unused-expression */

  return result;
}

export function testArgs(preset: TestPreset): string[] {
  const result: string[] = [];

  /* tslint:disable:no-unused-expression */

  preset.configuration && result.push('--build-config', preset.configuration);
  if (preset.overwriteConfigurationFile) {
    for (const config of preset.overwriteConfigurationFile) {
      result.push('--overwrite', config);
    }
  }

  // Output
  if (preset.output) {
    preset.output.shortProgress && result.push('--progress');
    preset.output.verbosity === 'verbose' && result.push('--verbose');
    preset.output.verbosity === 'extra' && result.push('--extra-verbose');
    preset.output.debug && result.push('--debug');
    preset.output.outputOnFailure && result.push('--output-on-failure');
    preset.output.quiet && result.push('--quiet');
    preset.output.outputLogFile && result.push('--output-log', preset.output.outputLogFile);
    !preset.output.labelSummary && result.push('--no-label-summary');
    !preset.output.subprojectSummary && result.push('--no-subproject-summary');
    preset.output.maxPassedTestOutputSize && result.push('--test-output-size-passed', preset.output.maxPassedTestOutputSize.toString());
    preset.output.maxFailedTestOutputSize && result.push('--test-output-size-failed', preset.output.maxFailedTestOutputSize.toString());
    preset.output.maxTestNameWidth && result.push('--max-width', preset.output.maxTestNameWidth.toString());
  }

  // Filter
  if (preset.filter?.include) {
    preset.filter.include.name && result.push('--tests-regex', preset.filter.include.name);
    preset.filter.include.label && result.push('--label-regex', preset.filter.include.label);
    preset.filter.include.useUnion && result.push('--union');
    if (preset.filter.include.index) {
      if (util.isString(preset.filter.include.index)) {
        result.push('--tests-information', preset.filter.include.index);
      } else {
        const start = preset.filter.include.index.start || '';
        const end = preset.filter.include.index.end || '';
        const stride = preset.filter.include.index.stride || '';
        const specificTests = preset.filter.include.index.specificTests ? `,${preset.filter.include.index.specificTests.join(',')}` : '';
        result.push(`--tests-information ${start},${end},${stride}${specificTests}`);
      }
    }
  }
  if (preset.filter?.exclude) {
    preset.filter.exclude.name && result.push('--exclude-regex', preset.filter.exclude.name);
    preset.filter.exclude.label && result.push('--label-exclude', preset.filter.exclude.label);
    preset.filter.exclude.fixtures?.any && result.push('--fixture-exclude-any', preset.filter.exclude.fixtures.any);
    preset.filter.exclude.fixtures?.setup && result.push('--fixture-exclude-setup', preset.filter.exclude.fixtures.setup);
    preset.filter.exclude.fixtures?.cleanup && result.push('--fixture-exclude-cleanup', preset.filter.exclude.fixtures.cleanup);
  }
  if (preset.execution) {
    preset.execution.stopOnFailure && result.push('--stop-on-failure');
    preset.execution.enableFailover && result.push('-F');
    preset.execution.jobs && result.push('--parallel', preset.execution.jobs.toString());
    preset.execution.resourceSpecFile && result.push('--resource-spec-file', preset.execution.resourceSpecFile);
    preset.execution.testLoad && result.push('--test-load', preset.execution.testLoad.toString());
    preset.execution.showOnly && result.push('--show-only', preset.execution.showOnly);
    preset.execution.repeat && result.push(`--repeat ${preset.execution.repeat.mode}:${preset.execution.repeat.count}`);
    result.push(`--interactive-debug-mode ${preset.execution.interactiveDebugging ? 1 : 0}` );
    preset.execution.scheduleRandom && result.push('--schedule-random');
    preset.execution.timeout && result.push('--timeout', preset.execution.timeout.toString());
    preset.execution.noTestsAction && preset.execution.noTestsAction !== 'default' && result.push('--no-tests=' + preset.execution.noTestsAction);
  }

  /* tslint:enable:no-unused-expression */

  return result;
}

export function configurePresetChangeNeedsClean(newPreset: ConfigurePreset, oldPreset: ConfigurePreset|null): boolean {
  if (!oldPreset) {
    // First configure preset? We never clean
    log.debug(localize('clean.not.needed.no.prior.config.preset', 'Clean not needed: No prior configure preset selected'));
    return false;
  }
  const important_params = (preset: ConfigurePreset) => ({
    preferredGenerator: preset.generator
  });
  const new_imp = important_params(newPreset);
  const old_imp = important_params(oldPreset);
  if (util.compare(new_imp, old_imp) != util.Ordering.Equivalent) {
    log.debug(localize('clean.needed.config.preset.changed', 'Need clean: configure preset changed'));
    return true;
  } else {
    return false;
  }
}
