import { compare, isArrayOfString, isString, objectPairs, Ordering } from '@cmt/util';
import * as logging from '@cmt/logging';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('preset');

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

export function configureArgs(preset: ConfigurePreset): string[] {
  const result: string[] = [];

  // CacheVariables
  if (preset.cacheVariables) {
    objectPairs(preset.cacheVariables).forEach(([key, value]) => {
      if (isString(value) || typeof value === 'boolean') {
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

  if (isString(preset.targets)) {
    result.push('--target', preset.targets);
  } else if (isArrayOfString(preset.targets)) {
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
      if (isString(preset.filter.include.index)) {
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
  if (compare(new_imp, old_imp) != Ordering.Equivalent) {
    log.debug(localize('clean.needed.config.preset.changed', 'Need clean: configure preset changed'));
    return true;
  } else {
    return false;
  }
}
