import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
import * as path from 'path';

import * as util from '@cmt/util';
import * as logging from '@cmt/logging';
import { EnvironmentVariables, execute } from '@cmt/proc';
import { expandString, ExpansionOptions } from '@cmt/expand';
import paths from '@cmt/paths';
import { effectiveKitEnvironment, getKitEnvironmentVariablesObject, Kit } from '@cmt/kit';
import { compareVersions } from '@cmt/installs/visual-studio';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('preset');

export interface PresetsFile {
  version: number;
  cmakeMinimumRequired?: util.Version;
  configurePresets?: ConfigurePreset[] | undefined;
  buildPresets?: BuildPreset[] | undefined;
  testPresets?: TestPreset[] | undefined;
}

export type VendorType = { [key: string]: any };

export interface Preset {
  name: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  inherits?: string | string[];
  environment?: { [key: string]: null | string };
  vendor?: VendorType;

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

type CacheVarType = null | boolean | string | { type: string, value: boolean | string };

export type OsName = "Windows" | "Linux" | "macOS";

export type Vendor_VsSettings = {
  'microsoft.com/VisualStudioSettings/CMake/1.0': {
    hostOS: OsName | OsName[];
    [key: string]: any;
  }
  [key: string]: any;
};

export interface ConfigurePreset extends Preset {
  generator?: string;
  architecture?: string | ValueStrategy;
  toolset?: string | ValueStrategy;
  binaryDir?: string;
  cmakeExecutable?: string;
  cacheVariables?: { [key: string]: CacheVarType };
  warnings?: WarningOptions;
  errors?: ErrorOptions;
  debug?: DebugOptions;
  vendor?: Vendor_VsSettings | VendorType;
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

  // Private fields
  __binaryDir?: string; // Getting this from the config preset
  __generator?: string; // Getting this from the config preset
  __targets?: string | string[]; // This field is translated to build args, so we can overwrite the target arguments.
}

/**
 * Should NOT cache anything. Need to make a copy if any fields need to be changed.
 */
export const defaultBuildPreset: BuildPreset = {
  name: '__defaultBuildPreset__',
  displayName: localize('default.build.preset', '[Default]'),
  description: localize('default.build.preset.description', 'An empty build preset that does not add any arguments')
};

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

  // Private fields
  __binaryDir?: string; // Getting this from the config preset
  __generator?: string; // Getting this from the config preset
}

/**
 * Should NOT cache anything. Need to make a copy if any fields need to be changed.
 */
export const defaultTestPreset: TestPreset = {
  name: '__defaultTestPreset__',
  displayName: localize('default.test.preset', '[Default]'),
  description: localize('default.test.preset.description', 'An empty test preset that does not add any arguments')
};

// original*PresetsFile's are each used to keep a copy by **value**. They are used to update
// the presets files. non-original's are also used for caching during various expansions.
let originalPresetsFile: PresetsFile | undefined;
let originalUserPresetsFile: PresetsFile | undefined;
let presetsFile: PresetsFile | undefined;
let userPresetsFile: PresetsFile | undefined;
const presetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();
const userPresetsChangedEmitter = new vscode.EventEmitter<PresetsFile>();

export function getOriginalPresetsFile() {
  return originalPresetsFile;
}

export function getOriginalUserPresetsFile() {
  return originalUserPresetsFile;
}

export function setOriginalPresetsFile(presets: PresetsFile | undefined) {
  originalPresetsFile = presets;
}

export function setOriginalUserPresetsFile(presets: PresetsFile | undefined) {
  originalUserPresetsFile = presets;
}

export function getPresetsFile() {
  return presetsFile;
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

export function minCMakeVersion() {
  const min1 = presetsFile?.cmakeMinimumRequired;
  const min2 = userPresetsFile?.cmakeMinimumRequired;
  if (!min1) {
    return min2;
  }
  if (!min2) {
    return min1;
  }
  return util.versionLess(min1, min2) ? min1 : min2;
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

function isInheritable(key: keyof ConfigurePreset | keyof BuildPreset | keyof TestPreset) {
  return key !== 'name' && key !== 'hidden' && key !== 'inherits' && key !== 'description' && key !== 'displayName';
}

function removeNullEnvVars(preset: Preset) {
  if (preset.environment) {
    for (const key in preset.environment) {
      if (preset.environment[key] === null) {
        delete preset.environment[key];
      }
    }
  }
}

let kits: Kit[] = [];

/**
 * Using kits as compilers
 */
export function setCompilers(_kits: Kit[]) {
  kits = _kits;
}

/**
 * Used for both expandConfigurePreset and expandVendorForConfigurePreset
 */
const referencedConfigurePresets: Set<string> = new Set();

/**
 * This is actually a very limited version of expandConfigurePreset.
 * Build/test presets currently don't need this, but We could extend this
 * to work with build/test presets in the future.
 * Use expandVendorPreset if other fields are needed.
 * They should NOT be used together.
 * They should Not call each other.
 */
export function expandVendorForConfigurePresets(): void {
  for (const preset of configurePresets()) {
    getVendorForConfigurePreset(preset.name);
  }
  for (const preset of userConfigurePresets()) {
    getVendorForConfigurePreset(preset.name);
  }
}

function getVendorForConfigurePreset(name: string): VendorType | Vendor_VsSettings | null {
  referencedConfigurePresets.clear();
  return getVendorForConfigurePresetImpl(name);
}

function getVendorForConfigurePresetImpl(name: string, allowUserPreset: boolean = false): VendorType | Vendor_VsSettings | null {
  let preset = getPresetByName(configurePresets(), name);
  if (preset) {
    return getVendorForConfigurePresetHelper(preset);
  }

  if (allowUserPreset) {
    preset = getPresetByName(userConfigurePresets(), name);
    if (preset) {
      return getVendorForConfigurePresetHelper(preset, true);
    }
  }

  return null;
}

function getVendorForConfigurePresetHelper(preset: ConfigurePreset, allowUserPreset: boolean = false): VendorType | Vendor_VsSettings | null {
  if (preset.__expanded) {
    return preset.vendor || null;
  }

  if (referencedConfigurePresets.has(preset.name)) {
    // Refernced this preset before, but it doesn't have a configure preset. This is a circular inheritance.
    log.error('circular.inherits.in.config.preset', 'Circular inherits in configure preset {0}', preset.name);
    return null;
  }

  referencedConfigurePresets.add(preset.name);

  preset.vendor = preset.vendor || {};

  if (preset.inherits) {
    if (util.isString(preset.inherits)) {
      preset.inherits = [preset.inherits];
    }
    for (const parent of preset.inherits) {
      const parentVendor = getVendorForConfigurePresetImpl(parent, allowUserPreset);
      if (parentVendor) {
        for (const key in parentVendor) {
          if (!preset.vendor[key]) {
            preset.vendor[key] = parentVendor[key];
          }
        }
      }
    }
  }

  return preset.vendor || null;
}

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
  let inheritedEnv = {};
  if (preset.inherits) {
    if (util.isString(preset.inherits)) {
      preset.inherits = [preset.inherits];
    }
    for (const parentName of preset.inherits) {
      const parent = await expandConfigurePresetImpl(parentName, workspaceFolder, sourceDir, allowUserPreset);
      if (parent) {
        // Inherit environment
        inheritedEnv = util.mergeEnvironment(parent.environment! as EnvironmentVariables, inheritedEnv as EnvironmentVariables);
        // Inherit cache vars
        for (const name in parent.cacheVariables) {
          if (!preset.cacheVariables[name]) {
            preset.cacheVariables[name] = parent.cacheVariables[name];
          }
        }
        // Inherit other fields
        let key: keyof ConfigurePreset;
        for (key in parent) {
          if (isInheritable(key) && preset[key] === undefined) {
            // 'as never' to bypass type check
            preset[key] = parent[key] as never;
          }
        }
      }
    }
  }

  inheritedEnv = util.mergeEnvironment(process.env as EnvironmentVariables, inheritedEnv as EnvironmentVariables);

  let clEnv: EnvironmentVariables = {};

  // [Windows Only] If CMAKE_CXX_COMPILER or CMAKE_C_COMPILER is set as 'cl' or 'cl.exe', but they are not on PATH,
  // then set the env automatically
  if (process.platform === 'win32') {
    const getStringValueFromCacheVar = (variable: CacheVarType) => {
      if (util.isString(variable)) {
        return variable;
      } else if (variable && typeof variable === 'object') {
        return util.isString(variable.value) ? variable.value : null;
      }
      return null;
    };
    if (preset.cacheVariables) {
      const cxxCompiler = getStringValueFromCacheVar(preset.cacheVariables['CMAKE_CXX_COMPILER'])?.toLowerCase();
      const cCompiler = getStringValueFromCacheVar(preset.cacheVariables['CMAKE_C_COMPILER'])?.toLowerCase();
      if (cxxCompiler === 'cl' || cxxCompiler === 'cl.exe' || cCompiler === 'cl' || cCompiler === 'cl.exe') {
        const clLoc = await execute('where.exe', ['cl'], null, { environment: preset.environment as EnvironmentVariables,
                                                                    silent: true,
                                                                    encoding: 'utf8',
                                                                    shell: true }).result;
        if (!clLoc.stdout) {
          // Not on PATH, need to set env
          let arch = 'x86';
          let toolsetArch = 'host=x86';
          let toolsetVsVersion: string | undefined;
          if (util.isString(preset.architecture)) {
            arch = preset.architecture;
          } else if (preset.architecture && preset.architecture.value) {
            arch = preset.architecture.value;
          } else {
            log.warning(localize('no.cl.arch', 'Configure preset {0}: No architecture specified for cl.exe, using x86 by default', preset.name));
          }
          const toolsetArchRegex = /(host=\w+),?/i;
          const toolsetVsVersionRegex = /version=(\w+),?/i;
          const noToolsetArchWarning = localize('no.cl.toolset.arch', 'Configure preset {0}: No toolset architecture specified for cl.exe, using x86 by default', preset.name);
          const noToolsetVsVersionWarning = localize('no.cl.toolset.version', 'Configure preset {0}: No toolset version specified for cl.exe, using latest by default', preset.name);
          const matchToolsetArchAndVersion = (toolset: string) => {
            const tollsetArchMatches = toolset.match(toolsetArchRegex);
            if (!tollsetArchMatches) {
              log.warning(noToolsetArchWarning);
            } else {
              toolsetArch = tollsetArchMatches[1];
            }
            const tollsetVsVersionMatches = toolset.match(toolsetVsVersionRegex);
            if (!tollsetVsVersionMatches) {
              log.warning(noToolsetVsVersionWarning);
            } else {
              toolsetVsVersion = tollsetVsVersionMatches[1];
            }
          };
          if (!preset.toolset) {
            log.warning(noToolsetArchWarning);
          } else if (util.isString(preset.toolset)) {
            matchToolsetArchAndVersion(preset.toolset);
          } else if (!preset.toolset.value) {
            log.warning(noToolsetArchWarning);
          } else {
            matchToolsetArchAndVersion(preset.toolset.value);
          }
          let latestVsVersion: string = '';
          let latestVsIndex = -1;
          for (let i = 0; i < kits.length; i++) {
            const kit = kits[i];
            if (kit.visualStudio && kit.visualStudioVersion && !kit.compilers) {
              if (kit.preferredGenerator &&
                  (kit.visualStudioArchitecture === arch || kit.preferredGenerator.platform === arch) &&
                  kit.preferredGenerator.toolset === toolsetArch) {
                if (toolsetVsVersion && kit.visualStudioVersion.startsWith(toolsetVsVersion)) {
                  latestVsVersion = kit.visualStudioVersion;
                  latestVsIndex = i;
                  break;
                }
                if (!toolsetVsVersion && compareVersions(latestVsVersion, kit.visualStudioVersion) < 0) {
                  latestVsVersion = kit.visualStudioVersion;
                  latestVsIndex = i;
                }
              }
            }
          }
          if (latestVsIndex < 0) {
            log.error(localize('specified.cl.not.found', 'Configure preset {0}: Specified cl.exe with toolset {1} and architecture {2} are not found',
                              preset.name, toolsetVsVersion ? `${toolsetVsVersion},${toolsetArch}` : toolsetArch, arch));
          } else {
            clEnv = getKitEnvironmentVariablesObject(await effectiveKitEnvironment(kits[latestVsIndex]));
            // if ninja isn't on path, try to look for it in a VS install
            const ninjaLoc = await execute('where.exe', ['ninja'], null, { environment: preset.environment as EnvironmentVariables,
                                                                           silent: true,
                                                                           encoding: 'utf8',
                                                                           shell: true }).result;
            if (!ninjaLoc.stdout) {
              const vsCMakePaths = await paths.vsCMakePaths(kits[latestVsIndex].visualStudio);
              if (vsCMakePaths.ninja) {
                log.warning(localize('ninja.not.set', 'Ninja is not set on PATH, trying to use {0}', vsCMakePaths.ninja));
                clEnv['PATH'] = `${path.dirname(vsCMakePaths.ninja)};${clEnv['PATH']}`;
              }
            }
          }
        }
      }
    }
  }

  clEnv = util.mergeEnvironment(inheritedEnv as EnvironmentVariables, clEnv as EnvironmentVariables);
  preset.environment = util.mergeEnvironment(clEnv as EnvironmentVariables, preset.environment as EnvironmentVariables);

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
      sourceDir,
      sourceParentDir: path.dirname(sourceDir),
      sourceDirName: path.basename(sourceDir),
      presetName: preset.name
    },
    envOverride: preset.environment as EnvironmentVariables,
    recursive: true,
    // Don't support commands since expansion might be called on activation. If there is
    // an extension depending on us, and there is a command in this extension is invoked,
    // this would be a deadlock. This could be avoided but at a huge cost.
    doNotSupportCommands: true
  };
  // Expand environment vars first since other fields may refer to them
  if (preset.environment) {
    for (const key in preset.environment) {
      if (preset.environment[key]) {
        preset.environment[key] = await expandString(preset.environment[key]!, expansionOpts);
      }
    }
  }

  removeNullEnvVars(preset);

  // Expand other fields
  if (preset.binaryDir) {
    preset.binaryDir = util.lightNormalizePath(await expandString(preset.binaryDir, expansionOpts));
  }
  if (preset.cmakeExecutable) {
    preset.cmakeExecutable = util.lightNormalizePath(await expandString(preset.cmakeExecutable, expansionOpts));
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

// Used for both getConfigurePreset and expandBuildPreset.
const referencedBuildPresets: Set<string> = new Set();

/**
 * This is actually a very limited version of expandBuildPreset/expandTestPreset.
 * Use expandBuildPreset/expandTestPreset if other fields are needed.
 * They should NOT be used together.
 * They should Not call each other.
 */
export function expandConfigurePresetForPresets(presetType: 'build' | 'test'): void {
  if (presetType === 'build') {
    for (const preset of buildPresets()) {
      getConfigurePresetForPreset(preset.name, presetType);
    }
    for (const preset of userBuildPresets()) {
      getConfigurePresetForPreset(preset.name, presetType);
    }
  } else {
    for (const preset of testPresets()) {
      getConfigurePresetForPreset(preset.name, presetType);
    }
    for (const preset of userTestPresets()) {
      getConfigurePresetForPreset(preset.name, presetType);
    }
  }
}

function getConfigurePresetForPreset(name: string, presetType: 'build' | 'test'): string | null {
  if (presetType === 'build') {
    referencedBuildPresets.clear();
  } else {
    referencedTestPresets.clear();
  }
  return getConfigurePresetForPresetImpl(name, presetType);
}

function getConfigurePresetForPresetImpl(name: string, presetType: 'build' | 'test', allowUserPreset: boolean = false): string | null {
  let preset: BuildPreset | TestPreset | null;
  if (presetType === 'build') {
    preset = getPresetByName(buildPresets(), name);
  } else {
    preset = getPresetByName(testPresets(), name);
  }
  if (preset) {
    return getConfigurePresetForPresetHelper(preset, presetType);
  }

  if (allowUserPreset) {
    if (presetType === 'build') {
      preset = getPresetByName(userBuildPresets(), name);
    } else {
      preset = getPresetByName(userTestPresets(), name);
    }
    if (preset) {
      return getConfigurePresetForPresetHelper(preset, presetType, true);
    }
  }

  return null;
}

function getConfigurePresetForPresetHelper(preset: BuildPreset | TestPreset, presetType: 'build' | 'test', allowUserPreset: boolean = false): string | null {
  if (preset.configurePreset) {
    return preset.configurePreset;
  }

  if (preset.__expanded) {
    return preset.configurePreset || null;
  }

  if (presetType === 'build') {
    if (referencedBuildPresets.has(preset.name)) {
      // Refernced this preset before, but it doesn't have a configure preset. This is a circular inheritance.
      log.error('circular.inherits.in.build.preset', 'Circular inherits in build preset {0}', preset.name);
      return null;
    }

    referencedBuildPresets.add(preset.name);
  } else {
    if (referencedTestPresets.has(preset.name)) {
      log.error('circular.inherits.in.test.preset', 'Circular inherits in test preset {0}', preset.name);
      return null;
    }

    referencedTestPresets.add(preset.name);
  }

  if (preset.inherits) {
    if (util.isString(preset.inherits)) {
      preset.inherits = [preset.inherits];
    }
    for (const parent of preset.inherits) {
      const parentConfigurePreset = getConfigurePresetForPresetImpl(parent, presetType, allowUserPreset);
      if (parentConfigurePreset) {
        preset.configurePreset = parentConfigurePreset;
        return parentConfigurePreset;
      }
    }
  }

  return null;
}

export function expandBuildPreset(name: string,
                                  workspaceFolder: string,
                                  sourceDir: string,
                                  allowUserPreset: boolean = false,
                                  configurePreset?: string): Promise<BuildPreset | null> {
  referencedBuildPresets.clear();
  return expandBuildPresetImpl(name, workspaceFolder, sourceDir, allowUserPreset, configurePreset);
}

async function expandBuildPresetImpl(name: string,
                                     workspaceFolder: string,
                                     sourceDir: string,
                                     allowUserPreset: boolean = false,
                                     configurePreset?: string): Promise<BuildPreset | null> {
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

  if (name === defaultBuildPreset.name) {
    // Construct the default build preset every time since it should NOT be cached
    preset = {
      name: defaultBuildPreset.name,
      displayName: defaultBuildPreset.displayName,
      description: defaultBuildPreset.description,
      configurePreset
    };
    return expandBuildPresetHelper(preset, workspaceFolder, sourceDir, true);
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
    if (util.isString(preset.inherits)) {
      preset.inherits = [preset.inherits];
    }
    for (const parentName of preset.inherits) {
      const parent = await expandBuildPresetImpl(parentName, workspaceFolder, sourceDir, allowUserPreset);
      if (parent) {
        // Inherit environment
        inheritedEnv = util.mergeEnvironment(parent.environment! as EnvironmentVariables, inheritedEnv);
        // Inherit other fields
        let key: keyof BuildPreset;
        for (key in parent) {
          if (isInheritable(key) && preset[key] === undefined) {
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
      sourceDir,
      sourceParentDir: path.dirname(sourceDir),
      sourceDirName: path.basename(sourceDir),
      presetName: preset.name
    },
    envOverride: preset.environment as EnvironmentVariables,
    recursive: true,
    // Don't support commands since expansion might be called on activation. If there is
    // an extension depending on us, and there is a command in this extension is invoked,
    // this would be a deadlock. This could be avoided but at a huge cost.
    doNotSupportCommands: true
  };

  // Expand environment vars first since other fields may refer to them
  if (preset.environment) {
    for (const key in preset.environment) {
      if (preset.environment[key]) {
        preset.environment[key] = await expandString(preset.environment[key]!, expansionOpts);
      }
    }
  }

  removeNullEnvVars(preset);

  // Expand other fields
  if (preset.targets) {
    if (util.isString(preset.targets)) {
      preset.targets = await expandString(preset.targets, expansionOpts);
    } else {
      for (const index in preset.targets) {
        preset.targets[index] = await expandString(preset.targets[index], expansionOpts);
      }
    }
  }
  if (preset.nativeToolOptions) {
    for (const index in preset.nativeToolOptions) {
      preset.nativeToolOptions[index] = await expandString(preset.nativeToolOptions[index], expansionOpts);
    }
  }

  preset.__expanded = true;
  return preset;
}

const referencedTestPresets: Set<string> = new Set();

export function expandTestPreset(name: string,
                                 workspaceFolder: string,
                                 sourceDir: string,
                                 allowUserPreset: boolean = false,
                                 configurePreset?: string): Promise<TestPreset | null> {
  referencedTestPresets.clear();
  return expandTestPresetImpl(name, workspaceFolder, sourceDir, allowUserPreset, configurePreset);
}

async function expandTestPresetImpl(name: string,
                                    workspaceFolder: string,
                                    sourceDir: string,
                                    allowUserPreset: boolean = false,
                                    configurePreset?: string): Promise<TestPreset | null> {
  let preset = getPresetByName(testPresets(), name);
  if (preset) {
    return expandTestPresetHelper(preset, workspaceFolder, sourceDir);
  }

  if (allowUserPreset) {
    preset = getPresetByName(userTestPresets(), name);
    if (preset) {
      return expandTestPresetHelper(preset, workspaceFolder, sourceDir, true);
    }
  }

  if (name === defaultTestPreset.name) {
    // Construct the default test preset every time since it should NOT be cached
    preset = {
      name: defaultTestPreset.name,
      displayName: defaultTestPreset.displayName,
      description: defaultTestPreset.description,
      configurePreset
    };
    return expandTestPresetHelper(preset, workspaceFolder, sourceDir, true);
  }

  log.error(localize('test.preset.not.found', 'Could not find test preset with name {0}', name));
  return null;
}

async function expandTestPresetHelper(preset: TestPreset,
                                      workspaceFolder: string,
                                      sourceDir: string,
                                      allowUserPreset: boolean = false) {
  if (preset.__expanded) {
    return preset;
  }

  if (referencedTestPresets.has(preset.name) && !preset.__expanded) {
    // Refernced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
    log.error('circular.inherits.in.test.preset', 'Circular inherits in test preset {0}', preset.name);
    return null;
  }

  referencedTestPresets.add(preset.name);

  // Init env to empty if not specified to avoid null checks later
  if (!preset.environment) {
    preset.environment = {};
  }
  let inheritedEnv = {};

  // Expand inherits
  if (preset.inherits) {
    if (util.isString(preset.inherits)) {
      preset.inherits = [preset.inherits];
    }
    for (const parentName of preset.inherits) {
      const parent = await expandTestPresetImpl(parentName, workspaceFolder, sourceDir, allowUserPreset);
      if (parent) {
        // Inherit environment
        inheritedEnv = util.mergeEnvironment(parent.environment! as EnvironmentVariables, inheritedEnv);
        // Inherit other fields
        let key: keyof TestPreset;
        for (key in parent) {
          if (isInheritable(key) && preset[key] === undefined) {
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
      sourceDir,
      sourceParentDir: path.dirname(sourceDir),
      sourceDirName: path.basename(sourceDir),
      presetName: preset.name
    },
    envOverride: preset.environment as EnvironmentVariables,
    recursive: true,
    // Don't support commands since expansion might be called on activation. If there is
    // an extension depending on us, and there is a command in this extension is invoked,
    // this would be a deadlock. This could be avoided but at a huge cost.
    doNotSupportCommands: true
  };

  // Expand environment vars first since other fields may refer to them
  if (preset.environment) {
    for (const key in preset.environment) {
      if (preset.environment[key]) {
        preset.environment[key] = await expandString(preset.environment[key]!, expansionOpts);
      }
    }
  }

  removeNullEnvVars(preset);

  // Expand other fields
  if (preset.overwriteConfigurationFile) {
    for (const index in preset.overwriteConfigurationFile) {
      preset.overwriteConfigurationFile[index] = await expandString(preset.overwriteConfigurationFile[index], expansionOpts);
    }
  }
  if (preset.output?.outputLogFile) {
    preset.output.outputLogFile = util.lightNormalizePath(await expandString(preset.output.outputLogFile, expansionOpts));
  }
  if (preset.filter?.include?.name) {
    preset.filter.include.name = await expandString(preset.filter.include.name, expansionOpts);
  }
  if (util.isString(preset.filter?.include?.index)) {
    preset.filter!.include!.index = await expandString(preset.filter!.include!.index, expansionOpts);
  }
  if (preset.filter?.exclude?.label) {
    preset.filter.exclude.label = await expandString(preset.filter.exclude.label, expansionOpts);
  }
  if (preset.filter?.exclude?.name) {
    preset.filter.exclude.name = await expandString(preset.filter.exclude.name, expansionOpts);
  }
  if (preset.filter?.exclude?.fixtures?.any) {
    preset.filter.exclude.fixtures.any = await expandString(preset.filter.exclude.fixtures.any, expansionOpts);
  }
  if (preset.filter?.exclude?.fixtures?.setup) {
    preset.filter.exclude.fixtures.setup = await expandString(preset.filter.exclude.fixtures.setup, expansionOpts);
  }
  if (preset.filter?.exclude?.fixtures?.cleanup) {
    preset.filter.exclude.fixtures.cleanup = await expandString(preset.filter.exclude.fixtures.cleanup, expansionOpts);
  }
  if (preset.execution?.resourceSpecFile) {
    preset.execution.resourceSpecFile = util.lightNormalizePath(await expandString(preset.execution.resourceSpecFile, expansionOpts));
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

  if (util.isString(preset.__targets)) {
    result.push('--target', preset.__targets);
  } else if (util.isArrayOfString(preset.__targets)) {
    result.push('--target', ...preset.__targets);
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
