import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from './util';

import {Maybe} from './util';

export class ConfigurationReader {
  public readConfig<T>(key: string, default_: Maybe<T> = null): Maybe<T> {
    const config = vscode.workspace.getConfiguration('cmake');
    const value = config.get(key);
    return (value !== undefined) ? value as T : default_;
  }

  private _escapePaths(obj: Object) {
    return Object.getOwnPropertyNames(obj).reduce(
      (acc, key: string) => {
        acc[key] = util.replaceVars(obj[key]);
        return acc;
      },
      {});
  }

  private _readPrefixed<T>(key): T|null {
    const platform = {win32: 'windows',
                      darwin: 'osx',
                      linux: 'linux'}[os.platform()];
    return this.readConfig<T>(
        `${platform}.${key}`, this.readConfig<T>(`${key}`));
  }

  get buildDirectory(): string {
    return this._readPrefixed<string>('buildDirectory')!;
  }

  get installPrefix(): Maybe<string> {
    return this._readPrefixed<string>('installPrefix')!;
  }

  get sourceDirectory(): string {
    return this._readPrefixed<string>('sourceDirectory') as string;
  }

  get buildBeforeRun(): boolean {
    return !!this._readPrefixed<boolean>('buildBeforeRun');
  }

  get saveBeforeBuild(): boolean {
    return !!this._readPrefixed<boolean>('saveBeforeBuild');
  }

  get clearOutputBeforeBuild(): boolean {
    return !!this._readPrefixed<boolean>('clearOutputBeforeBuild');
  }

  get configureSettings(): any {
    return this._readPrefixed<Object>('configureSettings');
  }

  get initialBuildType(): Maybe<string> {
    return this._readPrefixed<string>('initialBuildType');
  }

  get preferredGenerators(): string[] {
    return this._readPrefixed<string[]>('preferredGenerators') || [];
  }

  get generator(): Maybe<string> {
    return this._readPrefixed<string>('generator');
  }

  get toolset(): Maybe<string> {
    return this._readPrefixed<string>('toolset');
  }

  get platform(): Maybe<string> {
    return this._readPrefixed<string>('platform');
  }

  get configureArgs(): string[] {
    return this._readPrefixed<string[]>('configureArgs')!;
  }

  get buildArgs(): string[] {
    return this._readPrefixed<string[]>('buildArgs')!;
  }

  get buildToolArgs(): string[] {
    return this._readPrefixed<string[]>('buildToolArgs')!;
  }

  get parallelJobs(): Maybe<number> {
    return this._readPrefixed<number>('parallelJobs');
  }

  get ctest_parallelJobs(): Maybe<number> {
    return this._readPrefixed<number>('ctest.parallelJobs');
  }

  get parseBuildDiagnostics(): boolean {
    return !!this._readPrefixed<boolean>('parseBuildDiagnostics');
  }

  get enableOutputParsers(): Maybe<string[]> {
    return this._readPrefixed<string[]>('enableOutputParsers');
  }

  get cmakePath(): string {
    return this._readPrefixed<string>('cmakePath') || 'cmake';
  }

  get ctestPath(): string {
    const ctest_path = this._readPrefixed<string>('ctestPath');
    if (!ctest_path) {
      const cmake = this.cmakePath;
      if (cmake === 'cmake' || cmake === 'cmake.exe') {
        return 'ctest';
      }
      return path.join(path.dirname(cmake), 'ctest')
    }
    else {
      return ctest_path;
    }
  }

  get debugConfig(): any {
    return this._readPrefixed<any>('debugConfig');
  }

  get environment() {
    return this._escapePaths(this._readPrefixed<{[key: string]: string}>('environment') || {});
  }

  get configureEnvironment() {
    return this._escapePaths(this._readPrefixed<{[key: string]: string}>('configureEnvironment') || {});
  }

  get buildEnvironment() {
    return this._escapePaths(this._readPrefixed<{[key: string]: string}>('buildEnvironment') || {});
  }

  get testEnvironment() {
    return this._escapePaths(this._readPrefixed<{[key: string]: string}>('testEnvironment') || {});
  }

  get defaultVariants(): Object {
    return this._readPrefixed<Object>('defaultVariants') || {};
  }

  get ctestArgs(): string[] {
    return this._readPrefixed<string[]>('ctestArgs') || [];
  }

  get useCMakeServer(): boolean {
    return this._readPrefixed<boolean>('useCMakeServer') || false;
  }

  public get numJobs(): number {
    const jobs = this.parallelJobs;
    if (!!jobs) {
      return jobs;
    }
    return os.cpus().length + 2;
  }

  public get numCTestJobs(): number {
    const ctest_jobs = this.ctest_parallelJobs;
    if (!ctest_jobs) {
      return this.numJobs;
    }
    return ctest_jobs;
  }

  public get mingwSearchDirs(): string[] {
    return this._readPrefixed<string[]>('mingwSearchDirs') || [];
  }

  get cppToolsEnabled(): boolean {
    return this._readPrefixed<boolean>('cpptools.enabled') as boolean;
  }

  get cppToolsDatabaseFilename(): string {
    return this._readPrefixed<string>('cpptools.databaseFilename') as string;
  }

  get cppToolsIntelliSenseMode(): string {
    return this._readPrefixed<string>('cpptools.intelliSenseMode') as string;
  }

  get cppToolsLimitSymbolsToIncludedHeaders(): boolean {
    return this._readPrefixed<boolean>('cpptools.limitSymbolsToIncludedHeaders') as boolean;
  }

  get cppToolsDefaultTarget(): string {
    return this._readPrefixed<string>('cpptools.defaultTarget') as string;
  }

  get cppToolsAdditionalIncludePaths(): string[] {
    return this._readPrefixed<string[]>('cpptools.additionalIncludePaths') || [];
  }
}

export const config = new ConfigurationReader();
export default config;