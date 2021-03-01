interface Preset {
  name: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  inherits?: string;
  environment?: { [key: string]: null | string }
  vendor?: object;
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
  cacheVariables?: { [key: string]: null | boolean | string | { type: string, value: boolean | string } }
  warnings?: WarningOptions;
  errors?: ErrorOptions;
  debug?: DebugOptions;
}

export interface BuildPreset extends Preset {
  configurePreset?: string;
  inheritConfigureEnvironment?: boolean;
  jobs?: number;
  targets?: string | string[];
  configuration?: string;
  cleanFirst?: boolean;
  verbose?: boolean;
  nativeToolOptions?: string[];
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
  index?: string | { start: number, end: number, stride: number, specificTests: number[] };
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
  inheritConfigureEnvironment?: boolean;
  configuration?: string;
  overwriteConfigurationFile?: string[];
  output?: OutputOptions;
  filter?: TestFilter;
  execution?: ExecutionOptions;
}
