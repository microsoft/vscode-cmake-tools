/**
 * Provides a typed interface to CMake Tools' configuration options. You'll want
 * to import the `config` default export, which is an instance of the
 * `ConfigurationReader` class.
 */ /** */

import * as logging from '@cmt/logging';
import * as util from '@cmt/util';
import * as os from 'os';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('config');

export type LogLevelKey = 'trace'|'debug'|'info'|'note'|'warning'|'error'|'fatal';

export type CMakeCommunicationMode = 'legacy'|'serverApi'|'fileApi'|'automatic';

export type StatusBarButtonVisibility = "default" | "compact" | "icon" | "hidden";

interface HardEnv {
  [key: string]: string;
}

export interface AdvancedStatusBarConfig {
  kit?: {
    visibility?: StatusBarButtonVisibility;
    length?: number;
  };
  status?: {
    visibility?: StatusBarButtonVisibility;
  };
  workspace?: {
    visibility?: StatusBarButtonVisibility;
  };
  buildTarget?: {
    visibility?: StatusBarButtonVisibility;
  };
  build?: {
    visibility?: StatusBarButtonVisibility;
  };
  launchTarget?: {
    visibility?: StatusBarButtonVisibility;
  };
  debug?: {
    visibility?: StatusBarButtonVisibility;
  };
  launch?: {
    visibility?: StatusBarButtonVisibility;
  };
  ctest?: {
    color?: boolean;
    visibility?: StatusBarButtonVisibility;
  };
}
export interface StatusBarConfig {
  advanced?: AdvancedStatusBarConfig;
  visibility: StatusBarButtonVisibility;
}

export interface ExtensionConfigurationSettings {
  autoSelectActiveFolder: boolean;
  cmakePath: string;
  buildDirectory: string;
  installPrefix: string|null;
  sourceDirectory: string;
  saveBeforeBuild: boolean;
  buildBeforeRun: boolean;
  clearOutputBeforeBuild: boolean;
  configureSettings: {[key: string]: any};
  cacheInit: string|string[]|null;
  preferredGenerators: string[];
  generator: string|null;
  toolset: string|null;
  platform: string|null;
  configureArgs: string[];
  buildArgs: string[];
  buildToolArgs: string[];
  parallelJobs: number;
  ctestPath: string;
  ctest: {parallelJobs: number;};
  parseBuildDiagnostics: boolean;
  enabledOutputParsers: string[];
  debugConfig: object;
  defaultVariants: object;
  ctestArgs: string[];
  environment: HardEnv;
  configureEnvironment: HardEnv;
  buildEnvironment: HardEnv;
  testEnvironment: HardEnv;
  mingwSearchDirs: string[];
  emscriptenSearchDirs: string[];
  copyCompileCommands: string|null;
  configureOnOpen: boolean|null;
  configureOnEdit: boolean;
  skipConfigureIfCachePresent: boolean|null;
  useCMakeServer: boolean;
  cmakeCommunicationMode: CMakeCommunicationMode;
  ignoreKitEnv: boolean;
  buildTask: boolean;
  outputLogEncoding: string;
  enableTraceLogging: boolean;
  loggingLevel: LogLevelKey;
  statusbar: StatusBarConfig;
}

type EmittersOf<T> = {
  readonly[Key in keyof T]: vscode.EventEmitter<T[Key]>;
};

/**
 * This class exposes a number of readonly properties which can be used to
 * access configuration options. Each property corresponds to a value in
 * `settings.json`. See `package.json` for CMake Tools to see the information
 * on each property. An underscore in a property name corresponds to a dot `.`
 * in the setting name.
 */
export class ConfigurationReader implements vscode.Disposable {
  private _updateSubscription?: vscode.Disposable;

  constructor(private readonly _configData: ExtensionConfigurationSettings) {}

  get configData() { return this._configData; }

  get statusbar() { return this._configData.statusbar; }

  dispose() {
    if (this._updateSubscription) {
      this._updateSubscription.dispose();
    }
  }

  /**
   * Get a configuration object relevant to the given workspace directory. This
   * supports multiple workspaces having differing configs.
   *
   * @param workspacePath A directory to use for the config
   */
  static create(folder?: vscode.WorkspaceFolder): ConfigurationReader {
    const data = ConfigurationReader.loadConfig(folder);
    const reader = new ConfigurationReader(data);
    reader._updateSubscription = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cmake', folder?.uri)) {
        const new_data = ConfigurationReader.loadConfig(folder);
        reader.update(new_data);
      }
    });
    return reader;
  }

  static loadConfig(folder?: vscode.WorkspaceFolder): ExtensionConfigurationSettings {
    const data = vscode.workspace.getConfiguration('cmake', folder?.uri) as any as
        ExtensionConfigurationSettings;
    const platmap = {
      win32: 'windows',
      darwin: 'osx',
      linux: 'linux',
    } as {[k: string]: string};
    const platform = platmap[process.platform];
    const for_platform = (data as any)[platform] as ExtensionConfigurationSettings | undefined;
    return {...data, ...(for_platform || {})};
  }

  update(newData: ExtensionConfigurationSettings) { this.updatePartial(newData); }
  updatePartial(newData: Partial<ExtensionConfigurationSettings>) {
    const old_values = {...this.configData};
    Object.assign(this.configData, newData);
    for (const key_ of Object.getOwnPropertyNames(newData)) {
      const key = key_ as keyof ExtensionConfigurationSettings;
      if (!(key in this._emitters)) {
        continue;  // Extension config we load has some additional properties we don't care about.
      }
      const new_value = this.configData[key];
      const old_value = old_values[key];
      if (util.compare(new_value, old_value) !== util.Ordering.Equivalent) {
        const em: vscode.EventEmitter<ExtensionConfigurationSettings[typeof key]> = this._emitters[key];
        em.fire(newData[key]);
      }
    }
  }

  get autoSelectActiveFolder(): boolean { return this.configData.autoSelectActiveFolder; }

  get buildDirectory(): string { return this.configData.buildDirectory; }

  get installPrefix(): string|null { return this.configData.installPrefix; }

  get sourceDirectory(): string { return this.configData.sourceDirectory as string; }

  get saveBeforeBuild(): boolean { return !!this.configData.saveBeforeBuild; }

  get buildBeforeRun(): boolean { return this.configData.buildBeforeRun; }

  get clearOutputBeforeBuild(): boolean { return !!this.configData.clearOutputBeforeBuild; }

  get configureSettings(): any { return this.configData.configureSettings; }

  get cacheInit() { return this.configData.cacheInit; }

  get preferredGenerators(): string[] { return this.configData.preferredGenerators; }

  get generator(): string|null { return this.configData.generator; }

  get toolset(): string|null { return this.configData.toolset; }

  get platform(): string|null { return this.configData.platform; }

  get configureArgs(): string[] { return this.configData.configureArgs; }

  get buildArgs(): string[] { return this.configData.buildArgs; }

  get buildToolArgs(): string[] { return this.configData.buildToolArgs; }

  get parallelJobs(): number { return this.configData.parallelJobs; }

  get ctest_parallelJobs(): number|null { return this.configData.ctest.parallelJobs; }

  get parseBuildDiagnostics(): boolean { return !!this.configData.parseBuildDiagnostics; }

  get enableOutputParsers(): string[]|null { return this.configData.enabledOutputParsers; }

  get raw_cmakePath(): string { return this.configData.cmakePath; }

  get raw_ctestPath(): string { return this.configData.ctestPath; }

  get debugConfig(): any { return this.configData.debugConfig; }

  get environment() { return this.configData.environment; }

  get configureEnvironment() { return this.configData.configureEnvironment; }

  get buildEnvironment() { return this.configData.buildEnvironment; }

  get testEnvironment() { return this.configData.testEnvironment; }

  get defaultVariants(): Object { return this.configData.defaultVariants; }

  get ctestArgs(): string[] { return this.configData.ctestArgs; }

  get configureOnOpen() { return this.configData.configureOnOpen; }

  get configureOnEdit() { return this.configData.configureOnEdit; }

  get skipConfigureIfCachePresent() { return this.configData.skipConfigureIfCachePresent; }

  get useCMakeServer(): boolean { return this.configData.useCMakeServer; }

  get cmakeCommunicationMode(): CMakeCommunicationMode {
    let communicationMode = this.configData.cmakeCommunicationMode;
    if (communicationMode == "automatic" && this.useCMakeServer) {
      log.warning(localize(
          'please.upgrade.configuration',
          'The setting \'useCMakeServer\' is replaced by \'cmakeCommunicationMode\'. Please upgrade your configuration.'));
      communicationMode = 'serverApi';
    }
    return communicationMode;
  }

  get numJobs(): number {
    const jobs = this.parallelJobs;
    if (!!jobs) {
      return jobs;
    }
    return os.cpus().length + 2;
  }

  get numCTestJobs(): number {
    const ctest_jobs = this.ctest_parallelJobs;
    if (!ctest_jobs) {
      return this.numJobs;
    }
    return ctest_jobs;
  }

  get mingwSearchDirs(): string[] { return this.configData.mingwSearchDirs; }

  get emscriptenSearchDirs(): string[] { return this.configData.emscriptenSearchDirs; }

  get copyCompileCommands(): string|null { return this.configData.copyCompileCommands; }

  get loggingLevel(): LogLevelKey {
    if (process.env['CMT_LOGGING_LEVEL']) {
      return process.env['CMT_LOGGING_LEVEL']! as LogLevelKey;
    }
    return this.configData.loggingLevel;
  }
  get ignoreKitEnv(): boolean { return this.configData.ignoreKitEnv; }
  get buildTask(): boolean { return this.configData.buildTask; }
  get outputLogEncoding(): string { return this.configData.outputLogEncoding; }
  get enableTraceLogging(): boolean { return this.configData.enableTraceLogging; }

  private readonly _emitters: EmittersOf<ExtensionConfigurationSettings> = {
    autoSelectActiveFolder: new vscode.EventEmitter<boolean>(),
    cmakePath: new vscode.EventEmitter<string>(),
    buildDirectory: new vscode.EventEmitter<string>(),
    installPrefix: new vscode.EventEmitter<string|null>(),
    sourceDirectory: new vscode.EventEmitter<string>(),
    saveBeforeBuild: new vscode.EventEmitter<boolean>(),
    buildBeforeRun: new vscode.EventEmitter<boolean>(),
    clearOutputBeforeBuild: new vscode.EventEmitter<boolean>(),
    configureSettings: new vscode.EventEmitter<{[key: string]: any}>(),
    cacheInit: new vscode.EventEmitter<string|string[]|null>(),
    preferredGenerators: new vscode.EventEmitter<string[]>(),
    generator: new vscode.EventEmitter<string|null>(),
    toolset: new vscode.EventEmitter<string|null>(),
    platform: new vscode.EventEmitter<string|null>(),
    configureArgs: new vscode.EventEmitter<string[]>(),
    buildArgs: new vscode.EventEmitter<string[]>(),
    buildToolArgs: new vscode.EventEmitter<string[]>(),
    parallelJobs: new vscode.EventEmitter<number>(),
    ctestPath: new vscode.EventEmitter<string>(),
    ctest: new vscode.EventEmitter<{parallelJobs: number;}>(),
    parseBuildDiagnostics: new vscode.EventEmitter<boolean>(),
    enabledOutputParsers: new vscode.EventEmitter<string[]>(),
    debugConfig: new vscode.EventEmitter<object>(),
    defaultVariants: new vscode.EventEmitter<object>(),
    ctestArgs: new vscode.EventEmitter<string[]>(),
    environment: new vscode.EventEmitter<HardEnv>(),
    configureEnvironment: new vscode.EventEmitter<HardEnv>(),
    buildEnvironment: new vscode.EventEmitter<HardEnv>(),
    testEnvironment: new vscode.EventEmitter<HardEnv>(),
    mingwSearchDirs: new vscode.EventEmitter<string[]>(),
    emscriptenSearchDirs: new vscode.EventEmitter<string[]>(),
    copyCompileCommands: new vscode.EventEmitter<string|null>(),
    configureOnOpen: new vscode.EventEmitter<boolean|null>(),
    configureOnEdit: new vscode.EventEmitter<boolean>(),
    skipConfigureIfCachePresent: new vscode.EventEmitter<boolean|null>(),
    useCMakeServer: new vscode.EventEmitter<boolean>(),
    cmakeCommunicationMode: new vscode.EventEmitter<CMakeCommunicationMode>(),
    ignoreKitEnv: new vscode.EventEmitter<boolean>(),
    buildTask: new vscode.EventEmitter<boolean>(),
    outputLogEncoding: new vscode.EventEmitter<string>(),
    enableTraceLogging: new vscode.EventEmitter<boolean>(),
    loggingLevel: new vscode.EventEmitter<LogLevelKey>(),
    statusbar: new vscode.EventEmitter<StatusBarConfig>()

  };

  /**
   * Watch for changes on a particular setting
   * @param setting The name of the setting to watch
   * @param cb A callback when the setting changes
   */
  onChange<K extends keyof ExtensionConfigurationSettings>(setting: K,
                                                           cb: (value: ExtensionConfigurationSettings[K]) => void):
      vscode.Disposable {
    // Can't use vscode.EventEmitter<ExtensionConfigurationSettings[K]> here, potentially because K and keyof ExtensionConfigurationSettings
    // may not be the same...
    const emitter: vscode.EventEmitter<any> = this._emitters[setting];
    return emitter.event(cb);
  }
}
