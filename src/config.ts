/**
 * Provides a typed interface to CMake Tools' configuration options. You'll want
 * to import the `config` default export, which is an instance of the
 * `ConfigurationReader` class.
 */ /** */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from './util';
import rollbar from './rollbar';

export type LogLevelKey = 'trace' | 'debug' | 'info' | 'note' | 'warning' | 'error' | 'fatal';

/**
 * Read a config value from `settings.json`
 * @param key The configuration setting name
 * @param default_ The default value to return, if the setting is missing
 */
function readConfig<T>(key: string): T | null;
function readConfig<T>(key: string, default_: T): T;
function readConfig<T>(key: string, default_?: T): T | null {
  const config = vscode.workspace.getConfiguration('cmake');
  const value = config.get(key) as T | undefined;
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
function readPrefixedConfig<T>(key: string): T | null;
function readPrefixedConfig<T>(key: string, default_: T): T;
function readPrefixedConfig<T>(key: string, default_?: T): T | null {
  const platmap = {
    win32 : 'windows',
    darwin : 'osx',
    linux : 'linux',
  } as{[k: string] : string};
  const platform = platmap[process.platform];
  if (default_ === undefined) {
    return readConfig(`${platform}.${key}`, readConfig<T>(`${key}`));
  } else {
    return readConfig(`${platform}.${key}`, readConfig<T>(`${key}`, default_));
  }
}

/**
 * This class exposes a number of readonly properties which can be used to
 * access configuration options. Each property corresponds to a value in
 * `settings.json`. See `package.json` for CMake Tools to see the information
 * on each property. An underscore in a property name corresponds to a dot `.`
 * in the setting name.
 */
class ConfigurationReader {
  private _escapePaths(obj: {[k: string] : any}) {
    return Object.getOwnPropertyNames(obj).reduce(
        (acc, key: string) => {
          acc[key] = util.replaceVars(obj[key]);
          return acc;
        },
        {} as typeof obj);
  }

  get buildDirectory(): string { return readPrefixedConfig<string>('buildDirectory') !; }

  get installPrefix(): string | null { return readPrefixedConfig<string>('installPrefix') !; }

  get sourceDirectory(): string { return readPrefixedConfig<string>('sourceDirectory') as string; }

  get buildBeforeRun(): boolean { return !!readPrefixedConfig<boolean>('buildBeforeRun'); }

  get saveBeforeBuild(): boolean { return !!readPrefixedConfig<boolean>('saveBeforeBuild'); }

  get clearOutputBeforeBuild(): boolean {
    return !!readPrefixedConfig<boolean>('clearOutputBeforeBuild');
  }

  get configureSettings(): any { return readPrefixedConfig<Object>('configureSettings'); }

  get initialBuildType(): string | null { return readPrefixedConfig<string>('initialBuildType'); }

  get preferredGenerators(): string[] {
    return readPrefixedConfig<string[]>('preferredGenerators', []);
  }

  get generator(): string | null { return readPrefixedConfig<string>('generator'); }

  get toolset(): string | null { return readPrefixedConfig<string>('toolset'); }

  get platform(): string | null { return readPrefixedConfig<string>('platform'); }

  get configureArgs(): string[] { return readPrefixedConfig<string[]>('configureArgs') !; }

  get buildArgs(): string[] { return readPrefixedConfig<string[]>('buildArgs') !; }

  get buildToolArgs(): string[] { return readPrefixedConfig<string[]>('buildToolArgs') !; }

  get parallelJobs(): number | null { return readPrefixedConfig<number>('parallelJobs'); }

  get ctest_parallelJobs(): number | null {
    return readPrefixedConfig<number>('ctest.parallelJobs');
  }

  get parseBuildDiagnostics(): boolean {
    return !!readPrefixedConfig<boolean>('parseBuildDiagnostics');
  }

  get enableOutputParsers(): string[] | null {
    return readPrefixedConfig<string[]>('enableOutputParsers');
  }

  get cmakePath(): string { return readPrefixedConfig<string>('cmakePath', 'cmake'); }

  get ctestPath(): string {
    const ctest_path = readPrefixedConfig<string>('ctestPath');
    if (!ctest_path) {
      const cmake = this.cmakePath;
      if (cmake === 'cmake' || cmake === 'cmake.exe') {
        return 'ctest';
      }
      return path.join(path.dirname(cmake), 'ctest')
    } else {
      return ctest_path;
    }
  }

  get debugConfig(): any { return readPrefixedConfig<any>('debugConfig'); }

  get environment() {
    return this._escapePaths(readPrefixedConfig<{[key: string] : string}>('environment', {}));
  }

  get configureEnvironment() {
    return this._escapePaths(
        readPrefixedConfig<{[key: string] : string}>('configureEnvironment', {}));
  }

  get buildEnvironment() {
    return this._escapePaths(readPrefixedConfig<{[key: string] : string}>('buildEnvironment', {}));
  }

  get testEnvironment() {
    return this._escapePaths(readPrefixedConfig<{[key: string] : string}>('testEnvironment', {}));
  }

  get defaultVariants(): Object { return readPrefixedConfig<Object>('defaultVariants', {}); }

  get ctestArgs(): string[] { return readPrefixedConfig<string[]>('ctestArgs', []); }

  get useCMakeServer(): boolean { return readPrefixedConfig<boolean>('useCMakeServer', true); }

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

  get mingwSearchDirs(): string[] { return readPrefixedConfig<string[]>('mingwSearchDirs', []); }

  get emscriptenSearchDirs(): string[] {
    return readPrefixedConfig<string[]>('emscriptenSearchDirs', []);
  }

  get loggingLevel(): LogLevelKey {
    if (process.env['CMT_LOGGING_LEVEL']) {
      return process.env['CMT_LOGGING_LEVEL']! as LogLevelKey;
    }
    return readPrefixedConfig<LogLevelKey>('loggingLevel', 'info');
  }
  get enableTraceLogging(): boolean { return readPrefixedConfig<boolean>('enableTraceLogging', false); }

  /**
   * Watch for changes on a particular setting
   * @param setting The name of the setting to watch
   * @param cb A callback when the setting changes
   */
  onChange<K extends keyof ConfigurationReader>(setting: K,
                                                cb: (value: ConfigurationReader[K]) => void) {
    const state = { value: this[setting] };
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

const config = new ConfigurationReader();
export default config;
