import * as os from 'os';
import * as vscode from 'vscode';

import {Maybe} from './util';

export class ConfigurationReader {
  public readConfig<T>(key: string, default_: Maybe<T> = null): Maybe<T> {
    const config = vscode.workspace.getConfiguration('cmake');
    const value = config.get(key);
    return (value !== undefined) ? value as T : default_;
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
    return this._readPrefixed<string>('cmakePath')!;
  }

  get debugConfig(): any {
    return this._readPrefixed<any>('debugConfig');
  }

  get environment(): Object {
    return this._readPrefixed<Object>('environment') || {};
  }

  get configureEnvironment(): Object {
    return this._readPrefixed<Object>('configureEnvironment') || {};
  }

  get buildEnvironment(): Object {
    return this._readPrefixed<Object>('buildEnvironment') || {};
  }

  get testEnvironment(): Object {
    return this._readPrefixed<Object>('testEnvironment') || {};
  }

  get defaultVariants(): Object {
    return this._readPrefixed<Object>('defaultVariants') || {};
  }

  get ctestArgs(): string[] {
    return this._readPrefixed<string[]>('ctestArgs') || [];
  }

  get experimental_useCMakeServer(): boolean {
    return this._readPrefixed<boolean>('experimental.useCMakeServer') || false;
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
}

export const config = new ConfigurationReader();
export default config;