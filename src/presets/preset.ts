/* eslint-disable no-unused-expressions */
import * as nls from 'vscode-nls';
import * as path from 'path';
import * as vscode from "vscode";
import * as lodash from "lodash";

import * as util from '@cmt/util';
import * as logging from '@cmt/logging';
import { execute } from '@cmt/proc';
import { errorHandlerHelper, expandString, ExpansionErrorHandler, ExpansionOptions } from '@cmt/expand';
import paths from '@cmt/paths';
import { compareVersions, VSInstallation, vsInstallations, enumerateMsvcToolsets, varsForVSInstallation, getVcVarsBatScript } from '@cmt/installs/visualStudio';
import { EnvironmentUtils, EnvironmentWithNull } from '@cmt/environmentVariables';
import { defaultNumJobs, UseVsDeveloperEnvironment } from '@cmt/config';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('preset');

export interface PresetsFile {
    version: number;
    schema?: string;
    cmakeMinimumRequired?: util.Version;
    include?: string[];
    configurePresets?: ConfigurePreset[];
    buildPresets?: BuildPreset[];
    testPresets?: TestPreset[];
    packagePresets?: PackagePreset[];
    workflowPresets?: WorkflowPreset[];

    __path?: string; // Private field holding the path to the file.
}

export type VendorType = { [key: string]: any };

export interface Preset {
    name: string;
    displayName?: string;
    description?: string;
    hidden?: boolean;
    inherits?: string | string[];
    environment?: EnvironmentWithNull;
    vendor?: VendorType;
    condition?: Condition | boolean | null;
    isUserPreset?: boolean;

    __parentEnvironment?: EnvironmentWithNull; // Private field that contains the parent environment, which might be a modified VS Dev Env, or simply process.env.
    __expanded?: boolean; // Private field to indicate if we have already expanded this preset.
    __inheritedPresetCondition?: boolean; // Private field to indicate the fully evaluated inherited preset condition.
    __file?: PresetsFile; // Private field to indicate the file where this preset was defined.
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

enum TraceMode {
    On = "on",
    Off = "off",
    Expand = "expand"
}

enum FormatMode {
    Human = "human",
    Json = "json-v1"
}

export interface TraceOptions {
    mode?: string;
    format?: string;
    source?: string[];
    redirect: string;
}

export interface Condition {
    type: 'const' | 'equals' | 'notEquals' | 'inList' | 'notInList' | 'matches' | 'notMatches' | 'anyOf' | 'allOf' | 'not';
    value?: boolean;
    lhs?: string;
    rhs?: string;
    string?: string;
    list?: string[];
    regex?: string;
    conditions?: Condition[];
    condition?: Condition;
}

class MissingConditionPropertyError extends Error {
    propertyName: string;

    constructor(propertyName: string, ...params: any[]) {
        super(...params);

        this.propertyName = propertyName;
    }
}

class InvalidConditionTypeError extends Error {
    type: string;

    constructor(type: string, ...params: any[]) {
        super(...params);

        this.type = type;
    }
}

function validateConditionProperty(condition: Condition, propertyName: keyof Condition) {
    const property: any = condition[propertyName];
    if (property === undefined || property === null) {
        throw new MissingConditionPropertyError(propertyName);
    }
}

export function evaluateCondition(condition: Condition): boolean {
    validateConditionProperty(condition, 'type');

    switch (condition.type) {
        case 'const':
            validateConditionProperty(condition, 'value');
            return condition.value!;
        case 'equals':
        case 'notEquals':
            validateConditionProperty(condition, 'lhs');
            validateConditionProperty(condition, 'rhs');
            const equals = condition.lhs === condition.rhs;
            return condition.type === 'equals' ? equals : !equals;
        case 'inList':
        case 'notInList':
            validateConditionProperty(condition, 'string');
            validateConditionProperty(condition, 'list');
            const inList = condition.list!.includes(condition.string!);
            return condition.type === 'inList' ? inList : !inList;
        case 'matches':
        case 'notMatches':
            validateConditionProperty(condition, 'string');
            validateConditionProperty(condition, 'regex');
            const regex = new RegExp(condition.regex!);
            const matches = regex.test(condition.string!);
            return condition.type === 'matches' ? matches : !matches;
        case 'allOf':
            validateConditionProperty(condition, 'conditions');
            return condition.conditions!.map((c) => evaluateCondition(c)).reduce((prev, current) => prev && current);
        case 'anyOf':
            validateConditionProperty(condition, 'conditions');
            return condition.conditions!.map((c) => evaluateCondition(c)).reduce((prev, current) => prev || current);
        case 'not':
            validateConditionProperty(condition, 'condition');
            return !evaluateCondition(condition.condition!);
        default:
            throw new InvalidConditionTypeError(condition.type);
    }
}

function evaluateInheritedPresetConditions(preset: Preset, allPresets: Preset[], references: Set<string>): boolean | undefined {
    const evaluateParent = (parentName: string) => {
        const parent = getPresetByName(allPresets, parentName);
        // If the child is not a user preset, the parent should not be a user preset.
        // eslint-disable-next-line @typescript-eslint/tslint/config
        if (parent && !preset.isUserPreset && parent.isUserPreset === true) {
            log.error(localize('invalid.user.inherits', 'Preset {0} in CMakePresets.json can\'t inherit from preset {1} in CMakeUserPresets.json', preset.name, parentName));
            return false;
        }
        if (parent && !references.has(parent.name)) {
            parent.__inheritedPresetCondition = evaluatePresetCondition(parent, allPresets, references);
        }

        return parent ? parent.__inheritedPresetCondition : false;
    };

    references.add(preset.name);
    if (preset.inherits) {
        // When looking up inherited presets, default to false if the preset does not exist since this wouldn't
        // be a valid preset to use.
        if (util.isString(preset.inherits)) {
            return evaluateParent(preset.inherits);
        } else if (util.isArrayOfString(preset.inherits)) {
            return preset.inherits.every(parentName => evaluateParent(parentName));
        }
        log.error(localize('invalid.inherits.type', 'Preset {0}: Invalid value for {1}', preset.name, `\"inherits\": "${preset.inherits}"`));
        return false;
    }
    return true;
}

export function evaluatePresetCondition(preset: Preset, allPresets: Preset[], references?: Set<string>): boolean | undefined {
    const condition = preset.condition;

    if (condition === undefined && !evaluateInheritedPresetConditions(preset, allPresets, references || new Set<string>())) {
        return false;
    }

    if (condition === undefined || condition === null) {
        return true;
    } else if (typeof condition === 'boolean') {
        return condition;
    } else if (typeof condition === 'object') {
        try {
            return evaluateCondition(condition);
        } catch (e) {
            if (e instanceof MissingConditionPropertyError) {
                log.error(localize('missing.condition.property', 'Preset {0}: Missing required property {1} on condition object', preset.name, `"${e.propertyName}"`));
            } else if (e instanceof InvalidConditionTypeError) {
                log.error(localize('invalid.condition.type', 'Preset {0}: Invalid condition type {1}', preset.name, `"${e.type}"`));
            } else {
                // unexpected error
                throw e;
            }

            return undefined;
        }
    }

    log.error(localize('invalid.condition', 'Preset {0}: Condition must be null, boolean, or an object.', preset.name));
    return undefined;
}

export type CacheVarType = null | boolean | string | { type: string; value: boolean | string };

export type OsName = "Windows" | "Linux" | "macOS";

export type VendorVsSettings = {
    'microsoft.com/VisualStudioSettings/CMake/1.0': {
        hostOS: OsName | OsName[];
        [key: string]: any;
    };
    [key: string]: any;
};

export interface ConfigurePreset extends Preset {
    generator?: string;
    architecture?: string | ValueStrategy;
    toolset?: string | ValueStrategy;
    binaryDir?: string;
    cmakeExecutable?: string;
    // Make the cache value to be possibly undefined for type checking
    cacheVariables?: { [key: string]: CacheVarType | undefined };
    warnings?: WarningOptions;
    errors?: ErrorOptions;
    debug?: DebugOptions;
    trace?: TraceOptions;
    vendor?: VendorVsSettings | VendorType;
    toolchainFile?: string;
    installDir?: string;

    // Private fields
    __developerEnvironmentArchitecture?: string; // Private field to indicate which VS Dev Env architecture we're using, if VS Dev Env is used.
}

export interface InheritsConfigurePreset extends Preset {
    configurePreset?: string;
    inheritConfigureEnvironment?: boolean; // Defaults to true
}

export interface BuildPreset extends InheritsConfigurePreset {
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
    outputJUnitFile?: string;
    labelSummary?: boolean;
    subprojectSummary?: boolean;
    maxPassedTestOutputSize?: number;
    maxFailedTestOutputSize?: number;
    testOutputTruncation?: 'tail' | 'heads' | 'middle';
    maxTestNameWidth?: number;
}

export interface IncludeFilter {
    name?: string;
    label?: string;
    useUnion?: boolean;
    index?: string | { start?: number; end?: number; stride?: number; specificTests?: number[] };
}

export interface ExcludeFilter {
    name?: string;
    label?: string;
    fixtures?: { any?: string; setup?: string; cleanup?: string };
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
    repeat?: { mode: 'until-fail' | 'until-pass' | 'after-timeout'; count: number };
    interactiveDebugging?: boolean;
    scheduleRandom?: boolean;
    timeout?: number;
    noTestsAction?: 'default' | 'error' | 'ignore';
}

export interface TestPreset extends InheritsConfigurePreset {
    configuration?: string;
    overwriteConfigurationFile?: string[];
    output?: OutputOptions;
    filter?: TestFilter;
    execution?: ExecutionOptions;

    // Private fields
    __binaryDir?: string; // Getting this from the config preset
    __generator?: string; // Getting this from the config preset
}

export interface PackageOutputOptions {
    debug?: boolean;
    verbose?: boolean;
}

export interface PackagePreset extends InheritsConfigurePreset {
    configurations?: string[];
    generators?: string[];
    variables?: { [key: string]: string | null | undefined };
    configFile?: string;
    output?: PackageOutputOptions;
    packageName?: string;
    packageVersion?: string;
    packageDirectory?: string;
    vendorName?: string;

    // Private fields
    __binaryDir?: string; // Getting this from the config preset
    __generator?: string; // Getting this from the config preset
}

export interface WorkflowStepsOptions {
    type: string;
    name: string;
}

export interface WorkflowPreset {
    name: string;
    displayName?: string;
    description?: string;
    vendor?: VendorType;
    isUserPreset?: boolean;
    steps: WorkflowStepsOptions[];

    __vsDevEnvApplied?: boolean; // Private field to indicate if we have already applied the VS Dev Env.
    __expanded?: boolean; // Private field to indicate if we have already expanded this preset.
    __file?: PresetsFile; // Private field to indicate the file where this preset was defined.

}

// Interface for toolset options specified here: https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_TOOLSET.html
// The key names (left of '=') are removed and just the values are stored.
interface Toolset {
    name?: string;          // 'toolset', e.g. 'v141'
    cuda?: string;          // 'cuda=<version>|<path>'
    host?: string;          // 'host=<arch>'
    version?: string;       // 'version=<version>'
    VCTargetsPath?: string; // 'VCTargetsPath=<path>'
}

/**
 * Should NOT cache anything. Need to make a copy if any fields need to be changed.
 */

export const defaultTestPreset: TestPreset = {
    name: '__defaultTestPreset__',
    displayName: localize('default.test.preset', '[Default]'),
    description: localize('default.test.preset.description', 'An empty test preset that does not add any arguments')
};
export const defaultPackagePreset: PackagePreset = {
    name: '__defaultPackagePreset__',
    displayName: localize('default.package.preset', '[Default]'),
    description: localize('default.package.preset.description', 'An empty package preset that does not add any arguments')
};
export const defaultWorkflowPreset: WorkflowPreset = {
    name: '__defaultWorkflowPreset__',
    steps: [{type: "configure", name: "_placeholder_"}],
    displayName: localize('default.workflow.preset', '[Default]'),
    description: localize('default.workflow.preset.description', 'An empty workflow preset that does not add any arguments')
};

/**
 * presetsFiles are stored here because expansions require access to other presets.
 * Change event emitters are in presetsController.
 *
 * original*PresetsFile's are each used to keep a copy by **value**. They are used to update
 * the presets files when new presets are added.
 *
 * *presetsFilesIncluded is used to store the original presets files with included files.
 * They are used for expansion.
 *
 * expanded*PresetsFiles is used to cache the expanded presets files, without the VS dev env applied.
 */

// Map<fsPath, PresetsFile | undefined>
const originalPresetsFiles: Map<string, PresetsFile | undefined> = new Map();
const originalUserPresetsFiles: Map<string, PresetsFile | undefined> = new Map();
const presetsPlusIncluded: Map<string, PresetsFile | undefined> = new Map();
const userPresetsPlusIncluded: Map<string, PresetsFile | undefined> = new Map();
const expandedPresets: Map<string, PresetsFile | undefined> = new Map();
const expandedUserPresets: Map<string, PresetsFile | undefined> = new Map();

export function getOriginalPresetsFile(folder: string) {
    return originalPresetsFiles.get(folder);
}

export function getOriginalUserPresetsFile(folder: string) {
    return originalUserPresetsFiles.get(folder);
}

export function setOriginalPresetsFile(folder: string, presets: PresetsFile | undefined) {
    originalPresetsFiles.set(folder, presets);
}

export function setOriginalUserPresetsFile(folder: string, presets: PresetsFile | undefined) {
    originalUserPresetsFiles.set(folder, presets);
}

export function setPresetsPlusIncluded(folder: string, presets: PresetsFile | undefined) {
    presetsPlusIncluded.set(folder, presets);
}

export function setUserPresetsHelper(presets: PresetsFile | undefined) {
    if (presets) {
        // for each condition of `isUserPreset`, if we don't find file.path, then we default to true like before.
        if (presets.configurePresets) {
            for (const configPreset of presets.configurePresets) {
                configPreset.isUserPreset = configPreset.__file?.__path?.endsWith("CMakeUserPresets.json") ?? true;
            }
        }
        if (presets.buildPresets) {
            for (const buildPreset of presets.buildPresets) {
                buildPreset.isUserPreset = buildPreset.__file?.__path?.endsWith("CMakeUserPresets.json") ?? true;
            }
        }
        if (presets.testPresets) {
            for (const testPreset of presets.testPresets) {
                testPreset.isUserPreset = testPreset.__file?.__path?.endsWith("CMakeUserPresets.json") ?? true;
            }
        }
        if (presets.packagePresets) {
            for (const packagePreset of presets.packagePresets) {
                packagePreset.isUserPreset = packagePreset.__file?.__path?.endsWith("CMakeUserPresets.json") ?? true;
            }
        }
        if (presets.workflowPresets) {
            for (const workflowPreset of presets.workflowPresets) {
                workflowPreset.isUserPreset = workflowPreset.__file?.__path?.endsWith("CMakeUserPresets.json") ?? true;
            }
        }
    }
}

export function setUserPresetsPlusIncluded(folder: string, presets: PresetsFile | undefined) {
    setUserPresetsHelper(presets);
    userPresetsPlusIncluded.set(folder, presets);
}

export function setExpandedPresets(folder: string, presets: PresetsFile | undefined) {
    expandedPresets.set(folder, presets);
}

/**
 * This function updates the cache in both the regular presets cache and user presets cache.
 * However, this only updates the cache if the preset was already in the cache.
 * @param folder Folder to grab the cached expanded presets for
 * @param preset The updated preset to cache
 * @param presetType Type of the preset.
 */
export function updateCachedExpandedPreset(folder: string, preset: Preset, presetType: 'configurePresets' | 'buildPresets' | 'testPresets' | 'packagePresets' | 'workflowPresets') {
    const clonedPreset = lodash.cloneDeep(preset);
    const expanded = expandedPresets.get(folder);
    const userExpanded = expandedUserPresets.get(folder);
    updateCachedExpandedPresethelper(expanded, clonedPreset, presetType);
    updateCachedExpandedPresethelper(userExpanded, clonedPreset, presetType);
}

/**
 * Updates the cache only if the preset was already present in the cache.
 * Updates the cache in-place, the sorting of the list will remain the same.
 * @param cache The cache to update.
 * @param preset The updated preset to cache
 * @param presetType Type of the preset.
 * @returns void
 */
function updateCachedExpandedPresethelper(cache: PresetsFile | undefined, preset: Preset, presetType: 'configurePresets' | 'buildPresets' | 'testPresets' | 'packagePresets' | 'workflowPresets') {
    // Exit early if the cache or the list of presets is undefined.
    if (!cache || !cache[presetType]) {
        return;
    }

    // Exit early if the cache doesn't contain the preset.
    const index = cache[presetType]!.findIndex(p => p.name === preset.name);
    if (index === -1) {
        return;
    }

    // TODO: I'd like to try and figure out how to template this so that we don't have this logic duplicated for each if statement.
    // We know that the list exists so we use "!".
    // We use slice so that we can insert the updated preset in the same location it was previously in.
    if (presetType === 'configurePresets') {
        cache.configurePresets = [...cache.configurePresets!.slice(0, index), preset as ConfigurePreset, ...cache.configurePresets!.slice(index + 1)];
    } else if (presetType === "buildPresets") {
        cache.buildPresets = [...cache.buildPresets!.slice(0, index), preset as BuildPreset, ...cache.buildPresets!.slice(index + 1)];
    } else if (presetType === "testPresets") {
        cache.testPresets = [...cache.testPresets!.slice(0, index), preset as TestPreset, ...cache.testPresets!.slice(index + 1)];
    } else if (presetType === "packagePresets") {
        cache.packagePresets = [...cache.packagePresets!.slice(0, index), preset as PackagePreset, ...cache.packagePresets!.slice(index + 1)];
    } else if (presetType === "workflowPresets") {
        cache.workflowPresets = [...cache.workflowPresets!.slice(0, index), preset as WorkflowPreset, ...cache.workflowPresets!.slice(index + 1)];
    }
}

export function setExpandedUserPresetsFile(folder: string, presets: PresetsFile | undefined) {
    setUserPresetsHelper(presets);
    expandedUserPresets.set(folder, presets);
}

export function minCMakeVersion(folder: string) {
    const min1 = presetsPlusIncluded.get(folder)?.cmakeMinimumRequired;
    const min2 = presetsPlusIncluded.get(folder)?.cmakeMinimumRequired;
    if (!min1) {
        return min2;
    }
    if (!min2) {
        return min1;
    }
    // The combined minimum version is the higher version of the two
    return util.versionLess(min1, min2) ? min2 : min1;
}

export function configurePresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return presetsPlusIncluded.get(folder)?.configurePresets || [];
    }
    return expandedPresets.get(folder)?.configurePresets || [];
}

export function userConfigurePresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return userPresetsPlusIncluded.get(folder)?.configurePresets || [];
    }
    return expandedUserPresets.get(folder)?.configurePresets || [];
}

/**
 * Don't use this function if you need to keep any changes in the presets
 */
export function allConfigurePresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    return lodash.unionWith(configurePresets(folder, usePresetsPlusIncluded).concat(userConfigurePresets(folder, usePresetsPlusIncluded)), (a, b) => a.name === b.name);
}

export function buildPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return presetsPlusIncluded.get(folder)?.buildPresets || [];
    }
    return expandedPresets.get(folder)?.buildPresets || [];
}

export function userBuildPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return userPresetsPlusIncluded.get(folder)?.buildPresets || [];
    }
    return expandedUserPresets.get(folder)?.buildPresets || [];
}

/**
 * Don't use this function if you need to keep any changes in the presets
 */
export function allBuildPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    return lodash.unionWith(buildPresets(folder, usePresetsPlusIncluded).concat(userBuildPresets(folder, usePresetsPlusIncluded)), (a, b) => a.name === b.name);
}

export function testPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return presetsPlusIncluded.get(folder)?.testPresets || [];
    }
    return expandedPresets.get(folder)?.testPresets || [];
}

export function userTestPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return userPresetsPlusIncluded.get(folder)?.testPresets || [];
    }
    return expandedUserPresets.get(folder)?.testPresets || [];
}

/**
 * Don't use this function if you need to keep any changes in the presets
 */
export function allTestPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    return lodash.unionWith(testPresets(folder, usePresetsPlusIncluded).concat(userTestPresets(folder, usePresetsPlusIncluded)), (a, b) => a.name === b.name);
}

export function packagePresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return presetsPlusIncluded.get(folder)?.packagePresets || [];
    }
    return expandedPresets.get(folder)?.packagePresets || [];
}

export function userPackagePresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return userPresetsPlusIncluded.get(folder)?.packagePresets || [];
    }
    return expandedUserPresets.get(folder)?.packagePresets || [];
}

/**
* Don't use this function if you need to keep any changes in the presets
*/
export function allPackagePresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    return lodash.unionWith(packagePresets(folder, usePresetsPlusIncluded).concat(userPackagePresets(folder, usePresetsPlusIncluded)), (a, b) => a.name === b.name);
}

export function workflowPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return presetsPlusIncluded.get(folder)?.workflowPresets || [];
    }
    return expandedPresets.get(folder)?.workflowPresets || [];
}

export function userWorkflowPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    if (usePresetsPlusIncluded) {
        return userPresetsPlusIncluded.get(folder)?.workflowPresets || [];
    }
    return expandedUserPresets.get(folder)?.workflowPresets || [];
}

/**
* Don't use this function if you need to keep any changes in the presets
*/
export function allWorkflowPresets(folder: string, usePresetsPlusIncluded: boolean = false) {
    return lodash.unionWith(workflowPresets(folder, usePresetsPlusIncluded).concat(userWorkflowPresets(folder, usePresetsPlusIncluded)), (a, b) => a.name === b.name);
}

export function getPresetByName<T extends Preset>(presets: T[], name: string): T | null {
    return presets.find(preset => preset.name === name) ?? null;
}

function isInheritable(key: keyof ConfigurePreset | keyof BuildPreset | keyof TestPreset | keyof PackagePreset | keyof WorkflowPreset) {
    return key !== 'name' && key !== 'hidden' && key !== 'inherits' && key !== 'description' && key !== 'displayName';
}

export function inheritsFromUserPreset(preset: ConfigurePreset | BuildPreset | TestPreset | PackagePreset | WorkflowPreset,
    presetType: 'configurePresets' | 'buildPresets' | 'testPresets' | 'packagePresets' | 'workflowPresets', folderPath: string): boolean {

    const originalUserPresetsFile: PresetsFile = getOriginalUserPresetsFile(folderPath) || { version: 8 };
    const presetInherits = (presets: Preset[] | undefined, inherits: string | string[] | undefined) => presets?.find(p =>
        Array.isArray(inherits)
            ? inherits.some(inherit => inherit === p.name)
            : inherits === p.name
    );

    if (presetType !== 'workflowPresets' && (preset as Preset).inherits &&
        presetInherits(originalUserPresetsFile[presetType], (preset as Preset).inherits)) {
        return true;
    }

    // first step of a Workflow Preset must be a configure preset
    const inheritedConfigurePreset = presetType === 'workflowPresets' ? (preset as WorkflowPreset).steps[0]?.name :
        presetType !== 'configurePresets' ? (preset as InheritsConfigurePreset).configurePreset : undefined;

    return inheritedConfigurePreset ?
        !!originalUserPresetsFile.configurePresets?.find(p => p.name === inheritedConfigurePreset) : false;
}

/**
 * Shallow copy if a key in base doesn't exist in target
 */
function merge<T extends Object>(target: T, base: T) {
    Object.keys(base).forEach(key => {
        const field = key as keyof T;
        if (!target.hasOwnProperty(field)) {
            target[field] = base[field] as never;
        }
    });
}

/**
 * Used for both expandConfigurePreset and expandVendorForConfigurePreset
 * Map<fsPath, Set<referencedPresets>>
 */
const referencedConfigurePresets: Map<string, Set<string>> = new Map();

async function getVendorForConfigurePreset(folder: string, name: string, sourceDir: string, workspaceFolder: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler): Promise<VendorType | VendorVsSettings | null> {
    const refs = referencedConfigurePresets.get(folder);
    if (!refs) {
        referencedConfigurePresets.set(folder, new Set());
    } else {
        refs.clear();
    }
    return getVendorForConfigurePresetImpl(folder, name, sourceDir, workspaceFolder, allowUserPreset, usePresetsPlusIncluded, errorHandler);
}

async function getVendorForConfigurePresetImpl(folder: string, name: string, sourceDir: string, workspaceFolder: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler): Promise<VendorType | VendorVsSettings | null> {
    let preset = getPresetByName(configurePresets(folder, usePresetsPlusIncluded), name);
    if (preset) {
        return getVendorForConfigurePresetHelper(folder, preset, sourceDir, workspaceFolder, allowUserPreset, usePresetsPlusIncluded, errorHandler);
    }

    if (allowUserPreset) {
        preset = getPresetByName(userConfigurePresets(folder, usePresetsPlusIncluded), name);
        if (preset) {
            return getVendorForConfigurePresetHelper(folder, preset, sourceDir, workspaceFolder, allowUserPreset, usePresetsPlusIncluded, errorHandler);
        }
    }

    return null;
}

async function getVendorForConfigurePresetHelper(folder: string, preset: ConfigurePreset, sourceDir: string, workspaceFolder: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler): Promise<VendorType | VendorVsSettings | null> {
    if (preset.__expanded) {
        return preset.vendor || null;
    }

    const refs = referencedConfigurePresets.get(folder)!;

    if (refs.has(preset.name)) {
        // Referenced this preset before, but it doesn't have a configure preset. This is a circular inheritance.
        log.error(localize('circular.inherits.in.config.preset', 'Circular inherits in configure preset {0}', preset.name));
        errorHandler?.errorList.push([localize('circular.inherits.in.config.preset', 'Circular inherits in configure preset'), preset.name]);
        return null;
    }

    refs.add(preset.name);

    preset.vendor = preset.vendor || {};

    if (preset.inherits) {
        if (util.isString(preset.inherits)) {
            preset.inherits = [preset.inherits];
        }
        for (const parent of preset.inherits) {
            const parentVendor = await getVendorForConfigurePresetImpl(folder, parent, sourceDir, workspaceFolder, usePresetsPlusIncluded, allowUserPreset);
            if (parentVendor) {
                for (const key in parentVendor) {
                    if (preset.vendor[key] === undefined) {
                        preset.vendor[key] = parentVendor[key];
                    }
                }
            }
        }
    }

    return preset.vendor || null;
}

async function getExpansionOptions(workspaceFolder: string, sourceDir: string, preset: ConfigurePreset | BuildPreset | TestPreset | PackagePreset, envOverride?: EnvironmentWithNull, penvOverride?: EnvironmentWithNull, includeGenerator: boolean = true) {
    const generator = includeGenerator ? 'generator' in preset
        ? preset.generator
        : ('__generator' in preset ? preset.__generator : undefined) : undefined;

    const expansionOpts: ExpansionOptions = {
        vars: {
            generator: generator || 'null',
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
        envOverride: envOverride ?? preset.environment,
        penvOverride: penvOverride,
        recursive: true,
        // Don't support commands since expansion might be called on activation. If there is
        // an extension depending on us, and there is a command in this extension is invoked,
        // this would be a deadlock. This could be avoided but at a huge cost.
        doNotSupportCommands: true
    };

    if (preset.__file && preset.__file.version >= 3) {
        expansionOpts.vars.hostSystemName = await util.getHostSystemNameMemo();
    }
    if (preset.__file && preset.__file.version >= 4) {
        expansionOpts.vars.fileDir = path.dirname(preset.__file!.__path!);
    }
    if (preset.__file && preset.__file.version >= 5) {
        expansionOpts.vars.pathListSep = path.delimiter;
    }

    return expansionOpts;
}

async function expandCondition(condition: boolean | Condition | null | undefined, expansionOpts: ExpansionOptions, errorHandler?: ExpansionErrorHandler): Promise<boolean | Condition | undefined> {
    if (util.isNullOrUndefined(condition)) {
        return undefined;
    }
    if (util.isBoolean(condition)) {
        return condition;
    }
    if (condition.type) {
        const result: Condition = { type: condition.type };
        if (condition.lhs) {
            result.lhs = await expandString(condition.lhs, expansionOpts, errorHandler);
        }
        if (condition.rhs) {
            result.rhs = await expandString(condition.rhs, expansionOpts, errorHandler);
        }
        if (condition.string) {
            result.string = await expandString(condition.string, expansionOpts, errorHandler);
        }
        if (condition.list) {
            result.list = [];
            for (const value of condition.list) {
                result.list.push(await expandString(value, expansionOpts, errorHandler));
            }
        }
        if (condition.condition) {
            const expanded = await expandCondition(condition.condition, expansionOpts);
            if (!util.isBoolean(expanded)) {
                result.condition = expanded;
            }
        }
        if (condition.conditions) {
            result.conditions = [];
            for (const value of condition.conditions) {
                const expanded = await expandCondition(value, expansionOpts);
                if (expanded && !util.isBoolean(expanded)) {
                    result.conditions.push(expanded);
                }
            }
        }
        merge(result, condition); // Copy the remaining fields;
        return result;
    }
    return undefined;
}

export function getArchitecture(preset: ConfigurePreset) {
    if (util.isString(preset.architecture)) {
        return preset.architecture;
    } else if (preset.architecture && preset.architecture.value) {
        return preset.architecture.value;
    }
    const fallbackArchitecture = util.getHostArchitecture();
    log.warning(localize('no.cl.arch', 'Configure preset {0}: No architecture specified for cl.exe, using {1} by default', preset.name, fallbackArchitecture));
    return fallbackArchitecture;
}

export function getToolset(preset: ConfigurePreset): Toolset {
    let result: Toolset | undefined;
    if (util.isString(preset.toolset)) {
        result = parseToolset(preset.toolset);
    } else if (preset.toolset && util.isString(preset.toolset.value)) {
        result = parseToolset(preset.toolset.value);
    }

    const fallbackArchitecture = util.getHostArchitecture();
    const noToolsetArchWarning = localize('no.cl.toolset.arch', "Configure preset {0}: No toolset architecture specified for cl.exe, using {1} by default", preset.name, `"host=${fallbackArchitecture}"`);
    if (result) {
        if (result.name === 'x86' || result.name === 'x64') {
            log.warning(localize('invalid.cl.toolset.arch', "Configure preset {0}: Unexpected toolset architecture specified {1}, did you mean {2}?", preset.name, `"${result.name}"`, `"host=${result.name}"`));
        }
        if (!result.host) {
            log.warning(noToolsetArchWarning);
            result.host = fallbackArchitecture;
        }
        if (!result.version && result.name !== latestToolsetName) {
            log.warning(localize('no.cl.toolset.version', 'Configure preset {0}: No toolset version specified for cl.exe, using latest by default', preset.name));
        }
    } else {
        log.warning(noToolsetArchWarning);
        result = { host: fallbackArchitecture };
    }
    return result;
}

const toolsetToVersion: { [key: string]: string } = {
    'v100': '10.0',
    'v110': '11.0',
    'v120': '12.0',
    'v140': '14.0',
    'v141': '14.16',
    'v142': '14.29'
    // don't include the latest version - the compiler version changes frequently and it will be picked by default anyway.
    // NOTE: the latest toolset name (below) should be kept up to date.
};
const latestToolsetName = 'v143';

// We don't support all of these options for Kit lookup right now, but might in the future.
function parseToolset(toolset: string): Toolset {
    const toolsetOptions = toolset.split(',');

    const result: Toolset = {};
    for (const option of toolsetOptions) {
        if (option.indexOf('=') < 0) {
            const version = toolsetToVersion[option];
            if (version) {
                result.version = version;
            } else {
                result.name = option;
            }
        } else {
            const keyValue = option.split('=');
            switch (keyValue[0].toLowerCase()) {
                case 'cuda':
                    result.cuda = keyValue[1];
                    break;
                case 'host':
                    result.host = keyValue[1];
                    break;
                case 'version':
                    result.version = keyValue[1];
                    break;
                case 'vctargetspath':
                    result.VCTargetsPath = keyValue[1];
                    break;
                default:
                    log.warning(localize('unknown.toolset.option', "Unrecognized toolset option will be ignored: {0}", option));
                    break;
            }
        }
    }
    return result;
}

export interface VsDevEnvOptions {
    preset: ConfigurePreset;
    shouldInterrogateForNinja: boolean;
    compilerName?: string; // Only will have a value when `useVsDeveloperEnvironmentMode` is "auto"
}

/**
 * @param opts Options to control the behavior of obtaining the VS developer environment.
 * @returns Either the VS developer environment or undefined if it could not be obtained.
 */
async function getVsDevEnv(opts: VsDevEnvOptions): Promise<EnvironmentWithNull | undefined> {
    const arch = getArchitecture(opts.preset);
    const toolset = getToolset(opts.preset);

    // Get version info for all VS instances.
    const vsInstalls = await vsInstallations();

    // The VS installation to grab developer environment from.
    let vsInstall: VSInstallation | undefined;

    // VS generators starting with Visual Studio 15 2017 support CMAKE_GENERATOR_INSTANCE.
    // If supported, we should respect this value when defined. If not defined, we should
    // set it to ensure CMake chooses the same VS instance as we use here.
    // Note that if the user sets this in a toolchain file we won't know about it,
    // which could cause configuration to fail. However the user can workaround this by launching
    // vscode from the dev prompt of their desired instance.
    // https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_INSTANCE.html
    let vsGeneratorVersion: number | undefined;
    const matches = opts.preset.generator?.match(/Visual Studio (?<version>\d+)/);
    if (opts.preset.cacheVariables && matches && matches.groups?.version) {
        vsGeneratorVersion = parseInt(matches.groups.version);
        const useCMakeGeneratorInstance = !isNaN(vsGeneratorVersion) && vsGeneratorVersion >= 15;
        const cmakeGeneratorInstance = getStringValueFromCacheVar(opts.preset.cacheVariables['CMAKE_GENERATOR_INSTANCE']);
        if (useCMakeGeneratorInstance && cmakeGeneratorInstance) {
            const cmakeGeneratorInstanceNormalized = path.normalize(cmakeGeneratorInstance);
            vsInstall = vsInstalls.find((vs) => vs.installationPath
                                        && path.normalize(vs.installationPath) === cmakeGeneratorInstanceNormalized);

            if (!vsInstall) {
                log.warning(localize('specified.vs.not.found',
                    "Configure preset {0}: Visual Studio instance specified by {1} was not found, falling back on default instance lookup behavior.",
                    opts.preset.name, `CMAKE_GENERATOR_INSTANCE="${cmakeGeneratorInstance}"`));
            }
        }
    }

    // If VS instance wasn't chosen using CMAKE_GENERATOR_INSTANCE, look up a matching instance
    // that supports the specified toolset.
    if (!vsInstall) {
        // sort VS installs in order of descending version. This ensures we choose the latest supported install first.
        vsInstalls.sort((a, b) => {
            if (a.isPrerelease && !b.isPrerelease) {
                return 1;
            } else if (!a.isPrerelease && b.isPrerelease) {
                return -1;
            }
            return -compareVersions(a.installationVersion, b.installationVersion);
        });

        for (const vs of vsInstalls) {
            // Check for existence of vcvars script to determine whether desired host/target architecture is supported.
            // toolset.host will be set by getToolset.
            if (await getVcVarsBatScript(vs, toolset.host!, arch)) {
                // If a toolset version is specified then check to make sure this vs instance has it installed.
                if (toolset.version) {
                    const availableToolsets = await enumerateMsvcToolsets(vs.installationPath, vs.installationVersion);
                    // forcing non-null due to false positive (toolset.version is checked in conditional)
                    if (availableToolsets?.find(t => t.startsWith(toolset.version!))) {
                        vsInstall = vs;
                        break;
                    }
                } else if (!vsGeneratorVersion || vs.installationVersion.startsWith(vsGeneratorVersion.toString())) {
                    // If no toolset version specified then choose the latest VS instance for the given generator
                    vsInstall = vs;
                    break;
                }
            }
        }
    }

    if (!vsInstall) {
        if (opts.compilerName) {
            log.error(localize('specified.cl.not.found',
                "Configure preset {0}: Compiler {1} with toolset {2} and architecture {3} was not found, you may need to run the 'CMake: Scan for Compilers' command if this toolset exists on your computer.",
                opts.preset.name, `"${opts.compilerName}.exe"`, toolset.version ? `"${toolset.version},${toolset.host}"` : `"${toolset.host}"`, `"${arch}"`));
        } else {
            log.error(localize('vs.not.found', "Configure preset {0}: No Visual Studio installation found that supports the specified toolset {1} and architecture {2}, you may need to run the 'CMake: Scan for Compilers' command if this toolset exists on your computer.",
                opts.preset.name, toolset.version ? `"${toolset.version},${toolset.host}"` : `"${toolset.host}"`, `"${arch}"`));
        }
    } else {
        log.info(localize('using.vs.instance', "Using developer environment from Visual Studio (instance {0}, version {1}, installed at {2})", vsInstall.instanceId, vsInstall.installationVersion, `"${vsInstall.installationPath}"`));
        const vsEnv = await varsForVSInstallation(vsInstall, toolset.host!, arch, toolset.version);
        const compilerEnv = vsEnv ?? EnvironmentUtils.create();

        if (opts.shouldInterrogateForNinja) {
            const vsCMakePaths = await paths.vsCMakePaths(vsInstall.instanceId);
            if (vsCMakePaths.ninja) {
                log.warning(localize('ninja.not.set', 'Ninja is not set on PATH, trying to use {0}', vsCMakePaths.ninja));
                compilerEnv['PATH'] = `${path.dirname(vsCMakePaths.ninja)};${compilerEnv['PATH']}`;
            }
        }

        return compilerEnv;
    }
}

/**
 * This method tries to apply, based on the useVsDeveloperEnvironment setting value and, in "auto" mode, whether certain preset compilers/generators are used and not found, the VS Dev Env.
 * @param preset Preset to modify the parentEnvironment of. If the developer environment should be applied, the preset.environment is modified by reference.
 * @param workspaceFolder The workspace folder of the CMake project.
 * @param sourceDir The source dir of the CMake project.
 * @returns Void. We don't return as we are modifying the preset by reference.
 */
export async function tryApplyVsDevEnv(preset: ConfigurePreset, workspaceFolder: string, sourceDir: string): Promise<void> {
    const useVsDeveloperEnvironmentMode = vscode.workspace.getConfiguration("cmake", vscode.Uri.file(workspaceFolder)).get("useVsDeveloperEnvironment") as UseVsDeveloperEnvironment;
    if (useVsDeveloperEnvironmentMode === "never") {
        preset.__parentEnvironment = process.env;
        return;
    }

    let developerEnvironment: EnvironmentWithNull | undefined;
    // [Windows Only] We only support VS Dev Env on Windows.
    if (!preset.__parentEnvironment && process.platform === "win32") {
        if (useVsDeveloperEnvironmentMode === "auto") {
            if (preset.cacheVariables) {
                const cxxCompiler = getStringValueFromCacheVar(preset.cacheVariables['CMAKE_CXX_COMPILER'])?.toLowerCase();
                const cCompiler = getStringValueFromCacheVar(preset.cacheVariables['CMAKE_C_COMPILER'])?.toLowerCase();
                // The env variables for the supported compilers are the same.
                const compilerName: string | undefined = util.isSupportedCompiler(cxxCompiler) || util.isSupportedCompiler(cCompiler);

                // find where.exe using process.env since we're on windows.
                let whereExecutable;
                // assume in this call that it exists
                const whereOutput = await execute('where.exe', ['where.exe'], null, {
                    environment: process.env,
                    silent: true,
                    encoding: 'utf-8',
                    shell: true
                }).result;

                // now we have a valid where.exe

                if (whereOutput.stdout) {
                    const locations = whereOutput.stdout.split('\r\n');
                    if (locations.length > 0) {
                        whereExecutable = locations[0];
                    }
                }

                if (compilerName && whereExecutable) {
                    // We need to construct and temporarily expand the environment in order to accurately determine if this preset has the compiler / ninja on PATH.
                    // This puts the preset.environment on top of process.env, then expands with process.env as the penv and preset.environment as the envOverride
                    const env = EnvironmentUtils.mergePreserveNull([process.env, preset.environment]);
                    const expansionOpts: ExpansionOptions = await getExpansionOptions(workspaceFolder, sourceDir, preset, env);

                    const presetEnv = lodash.cloneDeep(preset.environment);
                    if (presetEnv) {
                        for (const key in presetEnv) {
                            if (presetEnv[key]) {
                                presetEnv[key] = await expandString(presetEnv[key]!, expansionOpts);
                            }
                        }
                    }

                    const compilerLocation = await execute(whereExecutable, [compilerName], null, {
                        environment: EnvironmentUtils.create(presetEnv),
                        silent: true,
                        encoding: 'utf8',
                        shell: true
                    }).result;

                    // if ninja isn't on path, try to look for it in a VS install
                    const ninjaLoc = await execute(whereExecutable, ['ninja'], null, {
                        environment: EnvironmentUtils.create(presetEnv),
                        silent: true,
                        encoding: 'utf8',
                        shell: true
                    }).result;

                    const generatorIsNinja = preset.generator?.toLowerCase().includes("ninja");
                    const shouldInterrogateForNinja = (generatorIsNinja ?? false) && !ninjaLoc.stdout;

                    if (!compilerLocation.stdout || shouldInterrogateForNinja) {
                        developerEnvironment = await getVsDevEnv({
                            preset,
                            shouldInterrogateForNinja,
                            compilerName
                        });
                    }
                }
            }
        } else if (useVsDeveloperEnvironmentMode === "always") {
            developerEnvironment = await getVsDevEnv({
                preset,
                shouldInterrogateForNinja: true
            });
        }
    }

    if (developerEnvironment) {
        preset.__developerEnvironmentArchitecture = getArchitecture(preset);
    }

    preset.__parentEnvironment = EnvironmentUtils.mergePreserveNull([process.env, preset.__parentEnvironment, developerEnvironment]);
}

/**
 * @param usePresetsPlusIncluded is used to determine whether to get the preset from the presets plus included map or the expanded presets map when
 * calling configurePresets() or userConfigurePresets(). Getting the presets plus included map is useful on Select Preset when we want to be able to
 * apply the Vs Dev Env to the preset and want the entire list of unexpanded presets, including the inlcuded presets.
 */
export async function getConfigurePresetInherits(folder: string, name: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler): Promise<ConfigurePreset | null> {
    // TODO: We likely need to refactor to include these refs, for configure, build, test, etc Presets.
    const refs = referencedConfigurePresets.get(folder);
    if (!refs) {
        referencedConfigurePresets.set(folder, new Set());
    } else {
        refs.clear();
    }

    const preset = await getConfigurePresetInheritsImpl(folder, name, allowUserPreset, usePresetsPlusIncluded, errorHandler);
    errorHandlerHelper(name, errorHandler);

    return preset;
}

async function getConfigurePresetInheritsImpl(folder: string, name: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: ConfigurePreset): Promise<ConfigurePreset | null> {
    let preset = getPresetByName(configurePresets(folder, usePresetsPlusIncluded), name);
    if (preset) {
        const presetList = inheritedByPreset ? inheritedByPreset.__file!.configurePresets : configurePresets(folder, usePresetsPlusIncluded);
        const validInherit = presetList !== undefined && presetList.filter(p => p.name === name).length > 0;
        if (validInherit) {
            return getConfigurePresetInheritsHelper(folder, preset, false, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (allowUserPreset) {
        preset = getPresetByName(userConfigurePresets(folder, usePresetsPlusIncluded), name);
        if (preset) {
            return getConfigurePresetInheritsHelper(folder, preset, true, usePresetsPlusIncluded, errorHandler);
        }
    }

    log.error(localize('config.preset.not.found.full', 'Could not find configure preset with name {0}', name));
    errorHandler?.errorList.push([localize('config.preset.not.found', 'Could not find configure preset'), name]);
    return null;
}

// This function modifies the preset parameter in-place. This means that the cache will be updated if the preset was retreived from the cache and not cloned.
async function getConfigurePresetInheritsHelper(folder: string, preset: ConfigurePreset, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler) {
    if (preset.__expanded) {
        return preset;
    }

    if (preset.__file) {
        if (preset.__file.version <= 2) {
            // toolchainFile and installDir added in presets v3
            if (preset.toolchainFile) {
                log.error(localize('property.unsupported.v2', 'Configure preset {0}: Property {1} is unsupported in presets v2', preset.name, '"toolchainFile"'));
                errorHandler?.errorList.push([localize('property.unsupported.v2', 'Property "toolchainFile" is unsupported in presets v2'), preset.name]);
                return null;
            }
            if (preset.installDir) {
                log.error(localize('property.unsupported.v2', 'Configure preset {0}: Property {1} is unsupported in presets v2', preset.name, '"installDir"'));
                errorHandler?.errorList.push([localize('property.unsupported.v2', 'Configure preset {0}: Property "installDir" is unsupported in presets v2'), preset.name]);
                return null;
            }
        }
    }

    const refs = referencedConfigurePresets.get(folder)!;

    if (refs.has(preset.name) && !preset.__expanded) {
        // Referenced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
        log.error(localize('circular.inherits.in.config.preset', 'Circular inherits in configure preset {0}', preset.name));
        errorHandler?.errorList.push([localize('circular.inherits.in.config.preset', 'Circular inherits in configure preset'), preset.name]);
        return null;
    }

    refs.add(preset.name);

    // Init env and cacheVar to empty if not specified to avoid null checks later
    if (!preset.environment) {
        preset.environment = EnvironmentUtils.createPreserveNull();
    }
    if (!preset.cacheVariables) {
        preset.cacheVariables = {};
    }

    // Expand inherits
    let inheritedEnv = EnvironmentUtils.createPreserveNull();
    if (preset.inherits) {
        if (util.isString(preset.inherits)) {
            preset.inherits = [preset.inherits];
        }
        for (const parentName of preset.inherits) {
            const parent = await getConfigurePresetInheritsImpl(folder, parentName, allowUserPreset, usePresetsPlusIncluded, errorHandler, preset);
            if (parent) {
                // Inherit environment
                inheritedEnv = EnvironmentUtils.mergePreserveNull([parent.environment, inheritedEnv]);
                // Inherit cache vars
                for (const name in parent.cacheVariables) {
                    if (preset.cacheVariables[name] === undefined) {
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

    preset.environment = EnvironmentUtils.mergePreserveNull([inheritedEnv, preset.environment]);

    preset.__expanded = true;
    return preset;
}

// This function does not modify the preset in place, it constructs a new expanded preset and returns it.
export async function expandConfigurePresetVariables(preset: ConfigurePreset, folder: string, name: string,  workspaceFolder: string, sourceDir: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = false, errorHandler?: ExpansionErrorHandler): Promise<ConfigurePreset> {

    // Put the preset.environment on top of combined environment in the `__parentEnvironment` field.
    // If for some reason the preset.__parentEnvironment is undefined, default to process.env.
    // NOTE: Based on logic in `tryApplyVsDevEnv`, `preset.__parentEnvironment` should never be undefined at this point.
    const env = EnvironmentUtils.mergePreserveNull([preset.__parentEnvironment ?? process.env, preset.environment]);

    // Expand strings under the context of current preset, also, pass preset.__parentEnvironment as a penvOverride so we include devenv if present.
    // `preset.__parentEnvironment` is allowed to be undefined here because in expansion, it will default to process.env.
    const expandedPreset: ConfigurePreset = { name };
    const expansionOpts: ExpansionOptions = await getExpansionOptions(workspaceFolder, sourceDir, preset, env, preset.__parentEnvironment);

    // Expand environment vars first since other fields may refer to them
    if (preset.environment) {
        expandedPreset.environment = EnvironmentUtils.createPreserveNull();
        for (const key in preset.environment) {
            if (preset.environment[key]) {
                expandedPreset.environment[key] = await expandString(preset.environment[key]!, expansionOpts, errorHandler);
            }
        }
    }

    expansionOpts.envOverride = EnvironmentUtils.mergePreserveNull([env, expandedPreset.environment]);

    expandedPreset.binaryDir = preset.binaryDir;

    if (preset.__file && preset.__file.version >= 3) {
        // For presets v3+ binaryDir is optional, but cmake-tools needs a value. Default to something reasonable.
        if (!preset.binaryDir) {
            const defaultValue = '${sourceDir}/out/build/${presetName}';

            log.debug(localize('binaryDir.undefined', 'Configure preset {0}: No binaryDir specified, using default value {1}', preset.name, `"${defaultValue}"`));
            // Modify the expandedPreset binary dir so that we don't modify the cache in place.
            expandedPreset.binaryDir = defaultValue;
        }
    }

    // Expand other fields
    if (expandedPreset.binaryDir) {
        expandedPreset.binaryDir = util.lightNormalizePath(await expandString(expandedPreset.binaryDir, expansionOpts, errorHandler));
        if (!path.isAbsolute(expandedPreset.binaryDir)) {
            expandedPreset.binaryDir = util.resolvePath(expandedPreset.binaryDir, sourceDir);
        }
    }

    if (preset.cmakeExecutable) {
        expandedPreset.cmakeExecutable = util.lightNormalizePath(await expandString(preset.cmakeExecutable, expansionOpts, errorHandler));
    }

    if (preset.installDir) {
        expandedPreset.installDir = util.resolvePath(await expandString(preset.installDir, expansionOpts), sourceDir);
    }

    if (preset.toolchainFile) {
        expandedPreset.toolchainFile = util.lightNormalizePath(await expandString(preset.toolchainFile, expansionOpts, errorHandler));
    }

    if (preset.cacheVariables) {
        expandedPreset.cacheVariables = {};
        for (const cacheVarName in preset.cacheVariables) {
            const cacheVar = preset.cacheVariables[cacheVarName];
            if (typeof cacheVar === 'boolean') {
                expandedPreset.cacheVariables[cacheVarName] = cacheVar;
            } else if (cacheVar || cacheVar === "") {
                if (util.isString(cacheVar)) {
                    expandedPreset.cacheVariables[cacheVarName] = await expandString(cacheVar, expansionOpts, errorHandler);
                } else if (util.isString(cacheVar.value)) {
                    expandedPreset.cacheVariables[cacheVarName] = { type: cacheVar.type, value: await expandString(cacheVar.value, expansionOpts, errorHandler) };
                } else {
                    expandedPreset.cacheVariables[cacheVarName] = { type: cacheVar.type, value: cacheVar.value };
                }
            }
        }
    }

    if (preset.condition) {
        expandedPreset.condition = await expandCondition(preset.condition, expansionOpts, errorHandler);
    }
    if (preset.vendor) {
        await getVendorForConfigurePreset(folder, expandedPreset.name, sourceDir, workspaceFolder, allowUserPreset, usePresetsPlusIncluded, errorHandler);
    }

    errorHandlerHelper(preset.name, errorHandler);

    // Other fields can be copied by reference for simplicity
    merge(expandedPreset, preset);

    return expandedPreset;
}

// Used for both getConfigurePreset and expandBuildPreset.
// Map<fsPath, Set<referencedPresets>>
const referencedBuildPresets: Map<string, Set<string>> = new Map();

/**
 * This is actually a very limited version of expandBuildPreset/expandTestPreset.
 * Use expandBuildPreset/expandTestPreset if other fields are needed.
 * They should NOT be used together.
 * They should Not call each other.
 */
export function expandConfigurePresetForPresets(folder: string, presetType: 'build' | 'test' | 'package' | 'workflow'): void {
    if (presetType === 'build') {
        for (const preset of buildPresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType);
        }
        for (const preset of userBuildPresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType, true);
        }
    } else if (presetType === 'test') {
        for (const preset of testPresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType);
        }
        for (const preset of userTestPresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType, true);
        }
    } else if (presetType === 'package') {
        for (const preset of packagePresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType);
        }
        for (const preset of userPackagePresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType, true);
        }
    } else if (presetType === 'workflow') {
        for (const preset of workflowPresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType);
        }
        for (const preset of userWorkflowPresets(folder)) {
            getConfigurePresetForPreset(folder, preset.name, presetType, true);
        }
    }
}

function getConfigurePresetForPreset(folder: string, name: string, presetType: 'build' | 'test' | 'package' | 'workflow', allowUserPreset: boolean = false): string | null {
    if (presetType === 'build') {
        const refs = referencedBuildPresets.get(folder);
        if (!refs) {
            referencedBuildPresets.set(folder, new Set());
        } else {
            refs.clear();
        }
    } else if (presetType === 'test') {
        const refs = referencedTestPresets.get(folder);
        if (!refs) {
            referencedTestPresets.set(folder, new Set());
        } else {
            refs.clear();
        }
    } else if (presetType === 'package') {
        const refs = referencedPackagePresets.get(folder);
        if (!refs) {
            referencedPackagePresets.set(folder, new Set());
        } else {
            refs.clear();
        }
    } else if (presetType === 'workflow') {
        const refs = referencedWorkflowPresets.get(folder);
        if (!refs) {
            referencedWorkflowPresets.set(folder, new Set());
        } else {
            refs.clear();
        }
    }

    return getConfigurePresetForPresetImpl(folder, name, presetType, allowUserPreset);
}

function getConfigurePresetForPresetImpl(folder: string, name: string, presetType: 'build' | 'test' | 'package' | 'workflow', allowUserPreset: boolean = false): string | null {
    let preset: BuildPreset | TestPreset | PackagePreset | WorkflowPreset | null = null;
    if (presetType === 'build') {
        preset = getPresetByName(buildPresets(folder), name);
    } else if (presetType === 'test') {
        preset = getPresetByName(testPresets(folder), name);
    } else if (presetType === 'package') {
        preset = getPresetByName(packagePresets(folder), name);
    } else if (presetType === 'workflow') {
        preset = getPresetByName(workflowPresets(folder), name);
    }

    if (preset) {
        return getConfigurePresetForPresetHelper(folder, preset, presetType);
    }

    if (allowUserPreset) {
        if (presetType === 'build') {
            preset = getPresetByName(userBuildPresets(folder), name);
        } else {
            preset = getPresetByName(userTestPresets(folder), name);
        }
        if (preset) {
            return getConfigurePresetForPresetHelper(folder, preset, presetType, true);
        }
    }

    return null;
}

function getConfigurePresetForPresetHelper(folder: string, preset: BuildPreset | TestPreset, presetType: 'build' | 'test' | 'package' | 'workflow', allowUserPreset: boolean = false): string | null {
    if (preset.configurePreset) {
        return preset.configurePreset;
    }

    if (preset.__expanded) {
        return preset.configurePreset || null;
    }

    if (presetType === 'build') {
        const refs = referencedBuildPresets.get(folder)!;
        if (refs.has(preset.name)) {
            // Referenced this preset before, but it doesn't have a configure preset. This is a circular inheritance.
            log.error(localize('circular.inherits.in.build.preset', 'Circular inherits in build preset {0}', preset.name));
            return null;
        }

        refs.add(preset.name);
    } else if (presetType === 'test') {
        const refs = referencedTestPresets.get(folder)!;
        if (refs.has(preset.name)) {
            log.error(localize('circular.inherits.in.test.preset', 'Circular inherits in test preset {0}', preset.name));
            return null;
        }

        refs.add(preset.name);
    } else if (presetType === 'package') {
        const refs = referencedPackagePresets.get(folder)!;
        if (refs.has(preset.name)) {
            log.error(localize('circular.inherits.in.package.preset', 'Circular inherits in package preset {0}', preset.name));
            return null;
        }

        refs.add(preset.name);
    } else if (presetType === 'workflow') {
        const refs = referencedWorkflowPresets.get(folder)!;
        if (refs.has(preset.name)) {
            log.error(localize('circular.inherits.in.workflow.preset', 'Circular inherits in workflow preset {0}', preset.name));
            return null;
        }

        refs.add(preset.name);
    }

    if (preset.inherits) {
        if (util.isString(preset.inherits)) {
            preset.inherits = [preset.inherits];
        }
        for (const parent of preset.inherits) {
            const parentConfigurePreset = getConfigurePresetForPresetImpl(folder, parent, presetType, allowUserPreset);
            if (parentConfigurePreset) {
                preset.configurePreset = parentConfigurePreset;
                return parentConfigurePreset;
            }
        }
    }

    return null;
}

export async function getBuildPresetInherits(folder: string, name: string, workspaceFolder: string, sourceDir: string, parallelJobs?: number, preferredGeneratorName?: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: BuildPreset): Promise<BuildPreset | null> {
    const refs = referencedBuildPresets.get(folder);
    if (!refs) {
        referencedBuildPresets.set(folder, new Set());
    } else {
        refs.clear();
    }

    const preset = await getBuildPresetInheritsImpl(folder, name, workspaceFolder, sourceDir, parallelJobs, preferredGeneratorName, allowUserPreset, configurePreset, usePresetsPlusIncluded, errorHandler, inheritedByPreset);
    errorHandlerHelper(name, errorHandler);

    return preset;
}

async function getBuildPresetInheritsImpl(folder: string, name: string, workspaceFolder: string, sourceDir: string, parallelJobs?: number, preferredGeneratorName?: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: BuildPreset): Promise<BuildPreset | null> {
    let preset = getPresetByName(buildPresets(folder, usePresetsPlusIncluded), name);
    if (preset) {
        const presetList = inheritedByPreset ? inheritedByPreset.__file!.buildPresets : buildPresets(folder, usePresetsPlusIncluded);
        const validInherit = presetList !== undefined && presetList.filter(p => p.name === name).length > 0;
        if (validInherit) {
            return getBuildPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, parallelJobs, preferredGeneratorName, false, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (allowUserPreset) {
        preset = getPresetByName(userBuildPresets(folder, usePresetsPlusIncluded), name);
        if (preset) {
            return getBuildPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, parallelJobs, preferredGeneratorName, true, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (name === defaultBuildPreset.name) {
        // Construct the default build preset every time since it should NOT be cached
        preset = {
            name: defaultBuildPreset.name,
            displayName: defaultBuildPreset.displayName,
            description: defaultBuildPreset.description,
            jobs: parallelJobs || defaultNumJobs(),
            configurePreset
        };
        return getBuildPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, parallelJobs, preferredGeneratorName, true, usePresetsPlusIncluded, errorHandler);
    }

    log.error(localize('build.preset.not.found.full', 'Could not find build preset with name {0}', name));
    errorHandler?.errorList.push([localize('build.preset.not.found', 'Could not find build preset'), name]);
    return null;
}

async function getBuildPresetInheritsHelper(folder: string, preset: BuildPreset, workspaceFolder: string, sourceDir: string, parallelJobs?: number, preferredGeneratorName?: string, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler) {
    if (preset.__expanded) {
        return preset;
    }

    const refs = referencedBuildPresets.get(folder)!;

    if (refs.has(preset.name) && !preset.__expanded) {
        // Referenced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
        // Notice that we check !preset.__expanded here but not in getConfigurePresetForBuildPresetHelper because
        // multiple parents could all point to the same parent.
        log.error(localize('circular.inherits.in.build.preset', 'Circular inherits in build preset {0}', preset.name));
        errorHandler?.errorList.push([localize('circular.inherits.in.build.preset', 'Circular inherits in build preset'), preset.name]);
        return null;
    }

    refs.add(preset.name);

    // Init env to empty if not specified to avoid null checks later
    if (!preset.environment) {
        preset.environment = EnvironmentUtils.createPreserveNull();
    }
    let inheritedEnv = EnvironmentUtils.createPreserveNull();
    let inheritedParentEnv = EnvironmentUtils.createPreserveNull();

    // Expand inherits
    if (preset.inherits) {
        if (util.isString(preset.inherits)) {
            preset.inherits = [preset.inherits];
        }
        for (const parentName of preset.inherits) {
            const parent = await getBuildPresetInheritsImpl(folder, parentName, workspaceFolder, sourceDir, parallelJobs, preferredGeneratorName, allowUserPreset, undefined, usePresetsPlusIncluded, errorHandler, preset);
            if (parent) {
                // Inherit environment
                inheritedEnv = EnvironmentUtils.mergePreserveNull([parent.environment, inheritedEnv]);
                inheritedParentEnv = EnvironmentUtils.mergePreserveNull([parent.__parentEnvironment, inheritedParentEnv]);
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
        let expandedConfigurePreset = getPresetByName(configurePresets(folder), preset.configurePreset);
        if (!expandedConfigurePreset && allowUserPreset) {
            expandedConfigurePreset = getPresetByName(userConfigurePresets(folder), preset.configurePreset);
        }

        if (!expandedConfigurePreset) {
            log.error(localize('configure.preset.not.found.full', 'Could not find configure preset with name {0}', preset.configurePreset));
            errorHandler?.errorList.push([localize('configure.preset.not.found', 'Could not find configure preset'), preset.configurePreset]);
            return null;
        }

        preset.__binaryDir = expandedConfigurePreset.binaryDir;
        preset.__generator = expandedConfigurePreset.generator;

        if (preset.inheritConfigureEnvironment !== false) { // Check false explicitly since defaults to true
            inheritedEnv = EnvironmentUtils.mergePreserveNull([inheritedEnv, expandedConfigurePreset.environment]);
            inheritedParentEnv = EnvironmentUtils.mergePreserveNull([inheritedParentEnv, expandedConfigurePreset.__parentEnvironment]);
        }
    }

    // the preset.environment is applied after the configurePreset.environment
    // same for parentenv and its getting ALL of processenv
    preset.environment = EnvironmentUtils.mergePreserveNull([inheritedEnv, preset.environment]);
    preset.__parentEnvironment = EnvironmentUtils.mergePreserveNull([inheritedParentEnv, preset.__parentEnvironment]);

    preset.__expanded = true;
    return preset;
}

export async function expandBuildPresetVariables(preset: BuildPreset, name: string, workspaceFolder: string, sourceDir: string, errorHandler?: ExpansionErrorHandler): Promise<BuildPreset> {
    const env = EnvironmentUtils.mergePreserveNull([preset.__parentEnvironment ?? process.env, preset.environment]);

    // Expand strings under the context of current preset
    const expandedPreset: BuildPreset = { name };
    const expansionOpts: ExpansionOptions = await getExpansionOptions(workspaceFolder, sourceDir, preset, env, preset.__parentEnvironment);

    // Expand environment vars first since other fields may refer to them
    if (preset.environment) {
        expandedPreset.environment = EnvironmentUtils.createPreserveNull();
        for (const key in preset.environment) {
            if (preset.environment[key]) {
                expandedPreset.environment[key] = await expandString(preset.environment[key]!, expansionOpts, errorHandler);
            }
        }
    }

    expansionOpts.envOverride = EnvironmentUtils.mergePreserveNull([env, expandedPreset.environment]);

    // Expand other fields
    if (preset.targets) {
        if (util.isString(preset.targets)) {
            expandedPreset.targets = await expandString(preset.targets, expansionOpts, errorHandler);
        } else {
            expandedPreset.targets = [];
            for (let index = 0; index < preset.targets.length; index++) {
                expandedPreset.targets[index] = await expandString(preset.targets[index], expansionOpts, errorHandler);
            }
        }
    }
    if (preset.nativeToolOptions) {
        expandedPreset.nativeToolOptions = [];
        for (let index = 0; index < preset.nativeToolOptions.length; index++) {
            expandedPreset.nativeToolOptions[index] = await expandString(preset.nativeToolOptions[index], expansionOpts, errorHandler);
        }
    }

    if (preset.condition) {
        expandedPreset.condition = await expandCondition(preset.condition, expansionOpts, errorHandler);
    }

    errorHandlerHelper(preset.name, errorHandler);

    // Other fields can be copied by reference for simplicity
    merge(expandedPreset, preset);

    return expandedPreset;
}

// Map<fsPath, Set<referencedPresets>>
const referencedTestPresets: Map<string, Set<string>> = new Map();

export async function getTestPresetInherits(folder: string, name: string, workspaceFolder: string, sourceDir: string, preferredGeneratorName?: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: TestPreset): Promise<TestPreset | null> {
    const refs = referencedTestPresets.get(folder);
    if (!refs) {
        referencedTestPresets.set(folder, new Set());
    } else {
        refs.clear();
    }

    const preset = await getTestPresetInheritsImpl(folder, name, workspaceFolder, sourceDir, preferredGeneratorName, allowUserPreset, configurePreset, usePresetsPlusIncluded, errorHandler, inheritedByPreset);
    errorHandlerHelper(name, errorHandler);

    return preset;
}

async function getTestPresetInheritsImpl(folder: string, name: string, workspaceFolder: string, sourceDir: string, preferredGeneratorName?: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: TestPreset): Promise<TestPreset | null> {
    let preset = getPresetByName(testPresets(folder, usePresetsPlusIncluded), name);
    if (preset) {
        const presetList = inheritedByPreset ? inheritedByPreset.__file!.testPresets : testPresets(folder, usePresetsPlusIncluded);
        const validInherit = presetList !== undefined && presetList.filter(p => p.name === name).length > 0;
        if (validInherit) {
            return getTestPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, preferredGeneratorName, false, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (allowUserPreset) {
        preset = getPresetByName(userTestPresets(folder, usePresetsPlusIncluded), name);
        if (preset) {
            return getTestPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, preferredGeneratorName, true, usePresetsPlusIncluded, errorHandler);
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
        return getTestPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, preferredGeneratorName, true, usePresetsPlusIncluded, errorHandler);
    }

    log.error(localize('test.preset.not.found.full', 'Could not find test preset with name {0}', name));
    errorHandler?.errorList.push([localize('test.preset.not.found', 'Could not find test preset'), name]);
    return null;
}

async function getTestPresetInheritsHelper(folder: string, preset: TestPreset, workspaceFolder: string, sourceDir: string, preferredGeneratorName: string | undefined, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler) {
    if (preset.__expanded) {
        return preset;
    }

    const refs = referencedTestPresets.get(folder)!;

    if (refs.has(preset.name) && !preset.__expanded) {
        // Referenced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
        log.error(localize('circular.inherits.in.test.preset', 'Circular inherits in test preset {0}', preset.name));
        errorHandler?.errorList.push([localize('circular.inherits.in.test.preset', 'Circular inherits in test preset'), preset.name]);
        return null;
    }

    refs.add(preset.name);

    // Init env to empty if not specified to avoid null checks later
    if (!preset.environment) {
        preset.environment = EnvironmentUtils.createPreserveNull();
    }
    let inheritedEnv = EnvironmentUtils.createPreserveNull();
    let inheritedParentEnv = EnvironmentUtils.createPreserveNull();

    // Expand inherits
    if (preset.inherits) {
        if (util.isString(preset.inherits)) {
            preset.inherits = [preset.inherits];
        }
        for (const parentName of preset.inherits) {
            const parent = await getTestPresetInheritsImpl(folder, parentName, workspaceFolder, sourceDir, preferredGeneratorName, allowUserPreset,  undefined, usePresetsPlusIncluded, errorHandler, preset);
            if (parent) {
                // Inherit environment
                inheritedEnv = EnvironmentUtils.mergePreserveNull([parent.environment, inheritedEnv]);
                inheritedParentEnv = EnvironmentUtils.mergePreserveNull([parent.__parentEnvironment, inheritedParentEnv]);
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
        let expandedConfigurePreset = getPresetByName(configurePresets(folder), preset.configurePreset);
        if (!expandedConfigurePreset && allowUserPreset) {
            expandedConfigurePreset = getPresetByName(userConfigurePresets(folder), preset.configurePreset);
        }

        if (!expandedConfigurePreset) {
            log.error(localize('configure.preset.not.found.full', 'Could not find configure preset with name {0}', preset.configurePreset));
            errorHandler?.errorList.push([localize('configure.preset.not.found', 'Could not find configure preset'), preset.configurePreset]);
            return null;
        }

        preset.__binaryDir = expandedConfigurePreset.binaryDir;
        preset.__generator = expandedConfigurePreset.generator;

        if (preset.inheritConfigureEnvironment !== false) { // Check false explicitly since defaults to true
            inheritedEnv = EnvironmentUtils.mergePreserveNull([inheritedEnv, expandedConfigurePreset.environment]);
            inheritedParentEnv = EnvironmentUtils.mergePreserveNull([inheritedParentEnv, expandedConfigurePreset.__parentEnvironment]);
        }
    }

    // the preset.environment is applied after the configurePreset.environment
    // same for parentenv and its getting ALL of processenv
    preset.environment = EnvironmentUtils.mergePreserveNull([inheritedEnv, preset.environment]);
    preset.__parentEnvironment = EnvironmentUtils.mergePreserveNull([inheritedParentEnv, preset.__parentEnvironment]);

    preset.__expanded = true;
    return preset;
}

export async function expandTestPresetVariables(preset: TestPreset, name: string, workspaceFolder: string, sourceDir: string, errorHandler?: ExpansionErrorHandler): Promise<TestPreset> {
    const env = EnvironmentUtils.mergePreserveNull([preset.__parentEnvironment ?? process.env, preset.environment]);

    const expandedPreset: TestPreset = { name };
    const expansionOpts: ExpansionOptions = await getExpansionOptions(workspaceFolder, sourceDir, preset, env, preset.__parentEnvironment);

    // Expand environment vars first since other fields may refer to them
    if (preset.environment) {
        expandedPreset.environment = EnvironmentUtils.createPreserveNull();
        for (const key in preset.environment) {
            if (preset.environment[key]) {
                expandedPreset.environment[key] = await expandString(preset.environment[key]!, expansionOpts, errorHandler);
            }
        }
    }

    expansionOpts.envOverride = EnvironmentUtils.mergePreserveNull([env, expandedPreset.environment]);

    // Expand other fields
    if (preset.overwriteConfigurationFile) {
        expandedPreset.overwriteConfigurationFile = [];
        for (let index = 0; index < preset.overwriteConfigurationFile.length; index++) {
            expandedPreset.overwriteConfigurationFile[index] = await expandString(preset.overwriteConfigurationFile[index], expansionOpts, errorHandler);
        }
    }
    if (preset.output?.outputLogFile) {
        expandedPreset.output = { outputLogFile: util.lightNormalizePath(await expandString(preset.output.outputLogFile, expansionOpts, errorHandler)) };
        merge(expandedPreset.output, preset.output);
    }
    if (preset.output?.outputJUnitFile) {
        expandedPreset.output = { outputJUnitFile: util.lightNormalizePath(await expandString(preset.output.outputJUnitFile, expansionOpts, errorHandler)) };
        merge(expandedPreset.output, preset.output);
    }
    if (preset.filter) {
        expandedPreset.filter = {};
        if (preset.filter.include) {
            expandedPreset.filter.include = {};
            if (preset.filter.include.name) {
                expandedPreset.filter.include.name = await expandString(preset.filter.include.name, expansionOpts, errorHandler);
            }
            if (util.isString(preset.filter.include.index)) {
                expandedPreset.filter.include.index = await expandString(preset.filter.include.index, expansionOpts, errorHandler);
            }
            merge(expandedPreset.filter.include, preset.filter.include);
        }
        if (preset.filter.exclude) {
            expandedPreset.filter.exclude = {};
            if (preset.filter.exclude.label) {
                expandedPreset.filter.exclude.label = await expandString(preset.filter.exclude.label, expansionOpts, errorHandler);
            }
            if (preset.filter.exclude.name) {
                expandedPreset.filter.exclude.name = await expandString(preset.filter.exclude.name, expansionOpts, errorHandler);
            }
            if (preset.filter.exclude.fixtures) {
                expandedPreset.filter.exclude.fixtures = {};
                if (preset.filter.exclude.fixtures.any) {
                    expandedPreset.filter.exclude.fixtures.any = await expandString(preset.filter.exclude.fixtures.any, expansionOpts, errorHandler);
                }
                if (preset.filter.exclude.fixtures.setup) {
                    expandedPreset.filter.exclude.fixtures.setup = await expandString(preset.filter.exclude.fixtures.setup, expansionOpts, errorHandler);
                }
                if (preset.filter.exclude.fixtures.cleanup) {
                    expandedPreset.filter.exclude.fixtures.cleanup = await expandString(preset.filter.exclude.fixtures.cleanup, expansionOpts, errorHandler);
                }
                merge(expandedPreset.filter.exclude.fixtures, preset.filter.exclude.fixtures);
            }
            merge(expandedPreset.filter.exclude, preset.filter.exclude);
        }
        merge(expandedPreset.filter, preset.filter);
    }
    if (preset.execution?.resourceSpecFile) {
        expandedPreset.execution = { resourceSpecFile: util.lightNormalizePath(await expandString(preset.execution.resourceSpecFile, expansionOpts, errorHandler)) };
        merge(expandedPreset.execution, preset.execution);
    }

    if (preset.condition) {
        expandedPreset.condition = await expandCondition(preset.condition, expansionOpts, errorHandler);
    }

    errorHandlerHelper(preset.name, errorHandler);

    // Other fields can be copied by reference for simplicity
    merge(expandedPreset, preset);

    return expandedPreset;
}

// Map<fsPath, Set<referencedPresets>>
const referencedPackagePresets: Map<string, Set<string>> = new Map();

export async function getPackagePresetInherits(folder: string, name: string, workspaceFolder: string, sourceDir: string, preferredGeneratorName?: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: PackagePreset): Promise<PackagePreset | null> {
    const refs = referencedPackagePresets.get(folder);
    if (!refs) {
        referencedPackagePresets.set(folder, new Set());
    } else {
        refs.clear();
    }

    const preset = await getPackagePresetInheritsImpl(folder, name, workspaceFolder, sourceDir, preferredGeneratorName, allowUserPreset, configurePreset, usePresetsPlusIncluded, errorHandler, inheritedByPreset);
    errorHandlerHelper(name, errorHandler);

    return preset;
}

async function getPackagePresetInheritsImpl(folder: string, name: string, workspaceFolder: string, sourceDir: string, preferredGeneratorName?: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: PackagePreset): Promise<PackagePreset | null> {
    let preset = getPresetByName(packagePresets(folder, usePresetsPlusIncluded), name);
    if (preset) {
        const presetList = inheritedByPreset ? inheritedByPreset.__file!.packagePresets : packagePresets(folder, usePresetsPlusIncluded);
        const validInherit = presetList !== undefined && presetList.filter(p => p.name === name).length > 0;
        if (validInherit) {
            return getPackagePresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, preferredGeneratorName, false, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (allowUserPreset) {
        preset = getPresetByName(userPackagePresets(folder, usePresetsPlusIncluded), name);
        if (preset) {
            return getPackagePresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, preferredGeneratorName, true, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (name === defaultPackagePreset.name) {
        // Construct the default package preset every time since it should NOT be cached
        preset = {
            name: defaultPackagePreset.name,
            displayName: defaultPackagePreset.displayName,
            description: defaultPackagePreset.description,
            configurePreset
        };
        return getPackagePresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, preferredGeneratorName, true, usePresetsPlusIncluded, errorHandler);
    }

    log.error(localize('package.preset.not.found.full', 'Could not find package preset with name {0}', name));
    errorHandler?.errorList.push([localize('package.preset.not.found', 'Could not find package preset'), name]);
    return null;
}

async function getPackagePresetInheritsHelper(folder: string, preset: PackagePreset, workspaceFolder: string, sourceDir: string, preferredGeneratorName: string | undefined, allowUserPreset: boolean = false, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler) {
    if (preset.__expanded) {
        return preset;
    }

    const refs = referencedPackagePresets.get(folder)!;

    if (refs.has(preset.name) && !preset.__expanded) {
        // Referenced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
        log.error(localize('circular.inherits.in.package.preset', 'Circular inherits in package preset {0}', preset.name));
        errorHandler?.errorList.push([localize('circular.inherits.in.package.preset', 'Circular inherits in package preset'), preset.name]);
        return null;
    }

    refs.add(preset.name);

    // Init env to empty if not specified to avoid null checks later
    if (!preset.environment) {
        preset.environment = EnvironmentUtils.createPreserveNull();
    }
    let inheritedEnv = EnvironmentUtils.createPreserveNull();
    let inheritedParentEnv = EnvironmentUtils.createPreserveNull();

    // Expand inherits
    if (preset.inherits) {
        if (util.isString(preset.inherits)) {
            preset.inherits = [preset.inherits];
        }
        for (const parentName of preset.inherits) {
            const parent = await getPackagePresetInheritsImpl(folder, parentName, workspaceFolder, sourceDir, preferredGeneratorName, allowUserPreset, undefined, usePresetsPlusIncluded, errorHandler, preset);
            if (parent) {
                // Inherit environment
                inheritedEnv = EnvironmentUtils.mergePreserveNull([parent.environment, inheritedEnv]);
                inheritedParentEnv = EnvironmentUtils.mergePreserveNull([parent.__parentEnvironment, inheritedParentEnv]);
                // Inherit other fields
                let key: keyof PackagePreset;
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
        let expandedConfigurePreset = getPresetByName(configurePresets(folder), preset.configurePreset);
        if (!expandedConfigurePreset && allowUserPreset) {
            expandedConfigurePreset = getPresetByName(userConfigurePresets(folder), preset.configurePreset);
        }

        if (!expandedConfigurePreset) {
            log.error(localize('configure.preset.not.found.full', 'Could not find configure preset with name {0}', preset.configurePreset));
            errorHandler?.errorList.push([localize('configure.preset.not.found', 'Could not find configure preset'), preset.configurePreset]);
            return null;
        }

        preset.__binaryDir = expandedConfigurePreset.binaryDir;
        preset.__generator = expandedConfigurePreset.generator;

        if (preset.inheritConfigureEnvironment !== false) { // Check false explicitly since defaults to true
            inheritedEnv = EnvironmentUtils.mergePreserveNull([inheritedEnv, expandedConfigurePreset.environment]);
            inheritedParentEnv = EnvironmentUtils.mergePreserveNull([inheritedParentEnv, expandedConfigurePreset.__parentEnvironment]);
        }
    }

    // the preset.environment is applied after the configurePreset.environment
    // same for parentenv and its getting ALL of processenv
    preset.environment = EnvironmentUtils.mergePreserveNull([inheritedEnv, preset.environment]);
    preset.__parentEnvironment = EnvironmentUtils.mergePreserveNull([inheritedParentEnv, preset.__parentEnvironment]);

    preset.__expanded = true;
    return preset;
}

export async function expandPackagePresetVariables(preset: PackagePreset, name: string, workspaceFolder: string, sourceDir: string, errorHandler?: ExpansionErrorHandler): Promise<PackagePreset> {
    const env = EnvironmentUtils.mergePreserveNull([preset.__parentEnvironment ?? process.env, preset.environment]);

    const expandedPreset: PackagePreset = { name };
    // Package presets cannot expand the macro ${generator} so this can't be included in opts
    const expansionOpts: ExpansionOptions = await getExpansionOptions(workspaceFolder, sourceDir, preset, env, preset.__parentEnvironment, false);

    // Expand environment vars first since other fields may refer to them
    if (preset.environment) {
        expandedPreset.environment = EnvironmentUtils.createPreserveNull();
        for (const key in preset.environment) {
            if (preset.environment[key]) {
                expandedPreset.environment[key] = await expandString(preset.environment[key]!, expansionOpts, errorHandler);
            }
        }
    }

    expansionOpts.envOverride = EnvironmentUtils.mergePreserveNull([env, expandedPreset.environment]);

    if (preset.condition) {
        expandedPreset.condition = await expandCondition(preset.condition, expansionOpts, errorHandler);
    }

    errorHandlerHelper(preset.name, errorHandler);
    // According to CMake docs, no other fields support macro expansion in a package preset.
    merge(expandedPreset, preset);

    return expandedPreset;
}

// Map<fsPath, Set<referencedPresets>>
const referencedWorkflowPresets: Map<string, Set<string>> = new Map();

export async function getWorkflowPresetInherits(folder: string, name: string, workspaceFolder: string, sourceDir: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler): Promise<WorkflowPreset | null> {
    const refs = referencedWorkflowPresets.get(folder);
    if (!refs) {
        referencedWorkflowPresets.set(folder, new Set());
    } else {
        refs.clear();
    }

    const preset = await getWorkflowPresetInheritsImpl(folder, name, workspaceFolder, sourceDir, allowUserPreset, configurePreset, usePresetsPlusIncluded, errorHandler);
    if (!preset) {
        return null;
    }

    const expandedPreset: WorkflowPreset = { name, steps: [{type: "configure", name: "_placeholder_"}] };

    errorHandlerHelper(preset.name, errorHandler);

    // According to CMake docs, no other fields support macro expansion in a workflow preset.
    merge(expandedPreset, preset);
    expandedPreset.steps = preset.steps;
    return expandedPreset;
}

async function getWorkflowPresetInheritsImpl(folder: string, name: string, workspaceFolder: string, sourceDir: string, allowUserPreset: boolean = false, configurePreset?: string, usePresetsPlusIncluded: boolean = true, errorHandler?: ExpansionErrorHandler, inheritedByPreset?: WorkflowPreset): Promise<WorkflowPreset | null> {
    let preset = getPresetByName(workflowPresets(folder, usePresetsPlusIncluded), name);
    if (preset) {
        const presetList = inheritedByPreset ? inheritedByPreset.__file!.workflowPresets : workflowPresets(folder, usePresetsPlusIncluded);
        const validInherit = presetList !== undefined && presetList.filter(p => p.name === name).length > 0;
        if (validInherit) {
            return getWorkflowPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, false, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (allowUserPreset) {
        preset = getPresetByName(userWorkflowPresets(folder, usePresetsPlusIncluded), name);
        if (preset) {
            return getWorkflowPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, true, usePresetsPlusIncluded, errorHandler);
        }
    }

    if (name === defaultWorkflowPreset.name) {
        // Construct the default workflow preset every time since it should NOT be cached
        preset = {
            name: defaultWorkflowPreset.name,
            displayName: defaultWorkflowPreset.displayName,
            description: defaultWorkflowPreset.description,
            steps: [
                {
                    type: "Configure",
                    name: configurePreset ? configurePreset : "_placeholder_configure_preset_"
                }
            ]
        };
        return getWorkflowPresetInheritsHelper(folder, preset, workspaceFolder, sourceDir, true, usePresetsPlusIncluded, errorHandler);
    }
    log.error(localize('workflow.preset.not.found', 'Could not find workflow preset with name {0}', name));
    errorHandler?.errorList.push([localize('workflow.preset.not.found', 'Could not find workflow preset'), name]);
    return null;
}

async function getWorkflowPresetInheritsHelper(folder: string, preset: WorkflowPreset, workspaceFolder: string, sourceDir: string, allowUserPreset: boolean = false, enableTryApplyDevEnv: boolean = true, errorHandler?: ExpansionErrorHandler) {
    if (preset.__expanded) {
        return preset;
    }

    const refs = referencedWorkflowPresets.get(folder)!;

    if (refs.has(preset.name) && !preset.__expanded) {
        // Referenced this preset before, but it still hasn't been expanded. So this is a circular inheritance.
        log.error(localize('circular.inherits.in.workflow.preset', 'Circular inherits in workflow preset {0}', preset.name));
        errorHandler?.errorList.push([localize('circular.inherits.in.workflow.preset', 'Circular inherits in workflow preset'), preset.name]);
        return null;
    }

    refs.add(preset.name);

    // Expand configure preset. Evaluate this after inherits since it may come from parents
    const workflowConfigurePreset = preset.steps[0].name;
    if (workflowConfigurePreset) {
        // We need to still do this for workflow presets because the configure preset could be different than the one selected for the project.
        let expandedConfigurePreset: ConfigurePreset | null = null;
        if (enableTryApplyDevEnv) {
            const configurePresetInherits = await getConfigurePresetInherits(folder, workflowConfigurePreset, allowUserPreset, true, errorHandler);
            if (!configurePresetInherits) {
                return null;
            }
            await tryApplyVsDevEnv(configurePresetInherits, workspaceFolder, sourceDir);

            expandedConfigurePreset = await expandConfigurePresetVariables(configurePresetInherits,
                folder,
                workflowConfigurePreset,
                workspaceFolder,
                sourceDir,
                allowUserPreset,
                enableTryApplyDevEnv,
                errorHandler);
        }  else {
            expandedConfigurePreset = getPresetByName(configurePresets(folder), workflowConfigurePreset);
            if (!expandedConfigurePreset && allowUserPreset) {
                expandedConfigurePreset = getPresetByName(userConfigurePresets(folder), workflowConfigurePreset);
            }
        }
        if (!expandedConfigurePreset) {
            log.error(localize('configure.preset.not.found.full', 'Could not find configure preset with name {0}', workflowConfigurePreset));
            errorHandler?.errorList.push([localize('configure.preset.not.found', 'Could not find configure preset'), workflowConfigurePreset]);
            return null;
        }
        // The below is critical when the workflow step0 configure preset is different than the
        // configure preset selected for the project.
        // Something that occurs during the usual configure of the project does not happen
        // when we configure on the fly and temporary for step0.
        for (const step of preset.steps) {
            switch (step.type) {
                case "build":
                    const buildStepPr = getPresetByName(allBuildPresets(folder), step.name);
                    if (buildStepPr) {
                        buildStepPr.__binaryDir = expandedConfigurePreset.binaryDir;
                        buildStepPr.__generator = expandedConfigurePreset.generator;
                    }
                    break;
                case "test":
                    const testStepPr = getPresetByName(allTestPresets(folder), step.name);
                    if (testStepPr) {
                        testStepPr.__binaryDir = expandedConfigurePreset.binaryDir;
                        testStepPr.__generator = expandedConfigurePreset.generator;
                    }
                    break;
                case "package":
                    const packageStepPr = getPresetByName(allPackagePresets(folder), step.name);
                    if (packageStepPr) {
                        packageStepPr.__binaryDir = expandedConfigurePreset.binaryDir;
                        packageStepPr.__generator = expandedConfigurePreset.generator;
                    }
                    break;
            }
        };
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

    if (preset.toolchainFile) {
        result.push(`-DCMAKE_TOOLCHAIN_FILE=${preset.toolchainFile}`);
    }
    if (preset.installDir) {
        result.push(`-DCMAKE_INSTALL_PREFIX=${preset.installDir}`);
    }

    // Warnings
    if (preset.warnings) {
        if (preset.warnings.dev !== undefined) {
            result.push(preset.warnings.dev ? '-Wdev' : '-Wno-dev');
        }
        if (preset.warnings.deprecated !== undefined) {
            result.push(preset.warnings.deprecated ? '-Wdeprecated' : '-Wno-deprecated');
        }

        preset.warnings.uninitialized && result.push('--warn-uninitialized');
        preset.warnings.unusedCli === false && result.push('--no-warn-unused-cli');
        preset.warnings.systemVars && result.push('--check-system-vars');
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
        preset.debug.output && result.push('--debug-output');
        preset.debug.tryCompile && result.push('--debug-trycompile');
        preset.debug.find && result.push('--debug-find');
    }

    // Trace
    if (preset.trace) {
        preset.trace.mode && (preset.trace.mode === TraceMode.On ? result.push('--trace') : preset.trace.mode === TraceMode.Expand ? result.push('--trace-expand') : false);
        preset.trace.format && (preset.trace.format === FormatMode.Human ? result.push('--trace-format=human') : preset.trace.format === FormatMode.Json ? result.push('--trace-format=json-v1') : false);
        preset.trace.source && preset.trace.source.length > 0 && preset.trace.source.forEach(s => {
            if (s.trim().length > 0) {
                result.push(`--trace-source=${s}`);
            }
        });
        preset.trace.redirect && preset.trace.redirect.length > 0 && result.push(`--trace-redirect=${preset.trace.redirect}`);
    }

    return result;
}

export function buildArgs(preset: BuildPreset, tempOverrideArgs?: string[], tempOverrideBuildToolArgs?: string[]): string[] {
    const result: string[] = [];

    preset.__binaryDir && result.push('--build', preset.__binaryDir);
    preset.jobs && result.push('--parallel', preset.jobs.toString());
    preset.configuration && result.push('--config', preset.configuration);
    preset.cleanFirst && result.push('--clean-first');
    preset.verbose && result.push('--verbose');

    if (util.isString(preset.__targets)) {
        result.push('--target', preset.__targets);
    } else if (util.isArrayOfString(preset.__targets)) {
        result.push('--target', ...preset.__targets);
    }

    tempOverrideArgs && result.push(...tempOverrideArgs);
    if (preset.nativeToolOptions || tempOverrideBuildToolArgs) {
        result.push('--');
        preset.nativeToolOptions && result.push(...preset.nativeToolOptions);
        tempOverrideBuildToolArgs && result.push(...tempOverrideBuildToolArgs);
    }

    return result;
}

export function testArgs(preset: TestPreset): string[] {
    const result: string[] = [];

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
        preset.output.outputJUnitFile && result.push('--output-junit', preset.output.outputJUnitFile);
        preset.output.labelSummary === false && result.push('--no-label-summary');
        preset.output.subprojectSummary === false && result.push('--no-subproject-summary');
        preset.output.maxPassedTestOutputSize && result.push('--test-output-size-passed', preset.output.maxPassedTestOutputSize.toString());
        preset.output.maxFailedTestOutputSize && result.push('--test-output-size-failed', preset.output.maxFailedTestOutputSize.toString());
        preset.output.testOutputTruncation && result.push('--test-output-truncation', preset.output.testOutputTruncation.toString());
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
        preset.execution.interactiveDebugging && result.push('--interactive-debug-mode 1');
        preset.execution.interactiveDebugging === false && result.push('--interactive-debug-mode 0');
        preset.execution.scheduleRandom && result.push('--schedule-random');
        preset.execution.timeout && result.push('--timeout', preset.execution.timeout.toString());
        preset.execution.noTestsAction && preset.execution.noTestsAction !== 'default' && result.push('--no-tests=' + preset.execution.noTestsAction);
    }

    return result;
}

export function packageArgs(preset: PackagePreset): string[] {
    const result: string[] = [];

    // -C semicolon;separated;list;of;configurations;to;pack
    const configurations: string | undefined = preset.configurations?.join(";");
    configurations && result.push(`-C ${configurations}`); // should this be 2 args or 1 with space in between -C and configurations list?
    // -G semicolon;separated;list;of;generators;used
    const generators: string | undefined = preset.generators?.join(";");
    generators && result.push(`-G ${generators}`); // should this be 2 args or 1 with space in between -G and generators list?

    // cpack variables: -D var=val
    if (preset.variables) {
        util.objectPairs(preset.variables).forEach(([key, value]) => {
            result.push(`-D ${key}=${value}`);
        });
    }

    preset.configFile && result.push('--config', preset.configFile);
    preset.packageName && result.push('-P', preset.packageName);
    preset.packageVersion && result.push('-R', preset.packageVersion);
    preset.packageDirectory && result.push('-B', preset.packageDirectory);

    // Output
    if (preset.output) {
        preset.output.verbose && result.push('-V');
        preset.output.debug && result.push('--debug');
    }

    return result;
}

export function configurePresetChangeNeedsClean(newPreset: ConfigurePreset, oldPreset: ConfigurePreset | null): boolean {
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
    if (util.compare(new_imp, old_imp) !== util.Ordering.Equivalent) {
        log.debug(localize('clean.needed.config.preset.changed', 'Need clean: configure preset changed'));
        return true;
    } else {
        return false;
    }
}

export function getValue(value: string | ValueStrategy): string | undefined {
    if (util.isString(value)) {
        return value;
    } else if (value.strategy === 'set') {
        return value.value;
    }
}

export function getStringValueFromCacheVar(variable?: CacheVarType): string | null {
    if (util.isString(variable)) {
        return variable;
    } else if (variable && typeof variable === 'object') {
        return util.isString(variable.value) ? variable.value : null;
    }
    return null;
};
