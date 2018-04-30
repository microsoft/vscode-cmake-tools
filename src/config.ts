/**
 * Provides a typed interface to CMake Tools' configuration options. You'll want
 * to import the `config` default export, which is an instance of the
 * `ConfigurationReader` class.
 */ /** */

import * as os from 'os';
import * as vscode from 'vscode';

import rollbar from './rollbar';

export type LogLevelKey = 'trace'|'debug'|'info'|'note'|'warning'|'error'|'fatal';

/**
 * This class exposes a number of readonly properties which can be used to
 * access configuration options. Each property corresponds to a value in
 * `settings.json`. See `package.json` for CMake Tools to see the information
 * on each property. An underscore in a property name corresponds to a dot `.`
 * in the setting name.
 */
export class ConfigurationReader {
  private constructor(readonly workspacePath: string) {}

  /**
   * Read a config value from `settings.json`
   * @param key The configuration setting name
   * @param default_ The default value to return, if the setting is missing
   */
  readConfig<T>(key: string): T|null;
  readConfig<T>(key: string, default_: T): T;
  readConfig<T>(key: string, default_?: T): T | null {
    const cmt_config = vscode.workspace.getConfiguration('cmake', vscode.Uri.file(this.workspacePath));
    const value = cmt_config.get(key) as T | undefined;
    if (value === undefined) {
      if (default_ === undefined) {
        return null;
      } else {
        return default_;
      }
    } else {
      return value;
    }
  }

  /**
   * Read a config value from `settings.json`, which may be prefixed by the
   * platform name.
   * @param key The configuration setting name
   */
  readPrefixedConfig<T>(key: string): T|null;
  readPrefixedConfig<T>(key: string, default_: T): T;
  readPrefixedConfig<T>(key: string, default_?: T): T|null {
    const platmap = {
      win32: 'windows',
      darwin: 'osx',
      linux: 'linux',
    } as {[k: string]: string};
    const platform = platmap[process.platform];
    if (default_ === undefined) {
      return this.readConfig(`${platform}.${key}`, this.readConfig<T>(`${key}`));
    } else {
      return this.readConfig(`${platform}.${key}`, this.readConfig<T>(`${key}`, default_));
    }
  }

  /**
   * Get a configuration object relevant to the given workspace directory. This
   * supports multiple workspaces having differing configs.
   *
   * @param workspacePath A directory to use for the config
   */
  static createForDirectory(workspacePath: string): ConfigurationReader {
    return new ConfigurationReader(workspacePath);
  }

  get buildDirectory(): string { return this.readPrefixedConfig<string>('buildDirectory')!; }

  get installPrefix(): string|null { return this.readPrefixedConfig<string>('installPrefix')!; }

  get sourceDirectory(): string { return this.readPrefixedConfig<string>('sourceDirectory') as string; }

  get saveBeforeBuild(): boolean { return !!this.readPrefixedConfig<boolean>('saveBeforeBuild'); }

  get clearOutputBeforeBuild(): boolean { return !!this.readPrefixedConfig<boolean>('clearOutputBeforeBuild'); }

  get autoRestartBuild(): boolean { return !!this.readPrefixedConfig<boolean>('autoRestartBuild'); }

  get configureSettings(): any { return this.readPrefixedConfig<Object>('configureSettings'); }

  get initialBuildType(): string|null { return this.readPrefixedConfig<string>('initialBuildType'); }

  get preferredGenerators(): string[] { return this.readPrefixedConfig<string[]>('preferredGenerators', []); }

  get generator(): string|null { return this.readPrefixedConfig<string>('generator'); }

  get toolset(): string|null { return this.readPrefixedConfig<string>('toolset'); }

  get platform(): string|null { return this.readPrefixedConfig<string>('platform'); }

  get configureArgs(): string[] { return this.readPrefixedConfig<string[]>('configureArgs')!; }

  get buildArgs(): string[] { return this.readPrefixedConfig<string[]>('buildArgs')!; }

  get buildToolArgs(): string[] { return this.readPrefixedConfig<string[]>('buildToolArgs')!; }

  get parallelJobs(): number|null { return this.readPrefixedConfig<number>('parallelJobs'); }

  get ctest_parallelJobs(): number|null { return this.readPrefixedConfig<number>('ctest.parallelJobs'); }

  get parseBuildDiagnostics(): boolean { return !!this.readPrefixedConfig<boolean>('parseBuildDiagnostics'); }

  get enableOutputParsers(): string[]|null { return this.readPrefixedConfig<string[]>('enableOutputParsers'); }

  get raw_cmakePath(): string { return this.readPrefixedConfig<string>('cmakePath', 'auto'); }

  get raw_ctestPath(): string { return this.readPrefixedConfig<string>('ctestPath', 'auto'); }

  get debugConfig(): any { return this.readPrefixedConfig<any>('debugConfig'); }

  get environment() { return this.readPrefixedConfig<{[key: string]: string}>('environment', {}); }

  get configureEnvironment() { return this.readPrefixedConfig<{[key: string]: string}>('configureEnvironment', {}); }

  get buildEnvironment() { return this.readPrefixedConfig<{[key: string]: string}>('buildEnvironment', {}); }

  get testEnvironment() { return this.readPrefixedConfig<{[key: string]: string}>('testEnvironment', {}); }

  get defaultVariants(): Object { return this.readPrefixedConfig<Object>('defaultVariants', {}); }

  get ctestArgs(): string[] { return this.readPrefixedConfig<string[]>('ctestArgs', []); }

  get useCMakeServer(): boolean { return this.readPrefixedConfig<boolean>('useCMakeServer', true); }

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

  get mingwSearchDirs(): string[] { return this.readPrefixedConfig<string[]>('mingwSearchDirs', []); }

  get emscriptenSearchDirs(): string[] { return this.readPrefixedConfig<string[]>('emscriptenSearchDirs', []); }

  get loggingLevel(): LogLevelKey {
    if (process.env['CMT_LOGGING_LEVEL']) {
      return process.env['CMT_LOGGING_LEVEL']! as LogLevelKey;
    }
    return this.readPrefixedConfig<LogLevelKey>('loggingLevel', 'info');
  }
  get enableTraceLogging(): boolean { return this.readPrefixedConfig<boolean>('enableTraceLogging', false); }

  /**
   * Watch for changes on a particular setting
   * @param setting The name of the setting to watch
   * @param cb A callback when the setting changes
   */
  onChange<K extends keyof ConfigurationReader>(setting: K, cb: (value: ConfigurationReader[K]) => void) {
    const state = {value: this[setting]};
    return vscode.workspace.onDidChangeConfiguration(() => {
      rollbar.invoke(`Callback changing setting: cmake.${setting}`, () => {
        const new_value = this[setting];
        if (new_value !== state.value) {
          state.value = new_value;
          cb(new_value);
        }
      });
    });
  }
}
