import * as proc from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as vscode from 'vscode';

import * as api from './api';
import * as async from './async';
import {CodeModelConfiguration} from './server-client';
import {VariantCombination} from './variants';

export class ThrottledOutputChannel implements vscode.OutputChannel {
  private _channel: vscode.OutputChannel;
  private _accumulatedData: string;
  private _throttler: async.Throttler<void>;

  constructor(name: string) {
    this._channel = vscode.window.createOutputChannel(name);
    this._accumulatedData = '';
    this._throttler = new async.Throttler();
  }

  get name(): string {
    return this._channel.name;
  }

  dispose(): void {
    this._accumulatedData = '';
    this._channel.dispose();
  }

  append(value: string): void {
    this._accumulatedData += value;
    this._throttler.queue(() => {
      if (this._accumulatedData) {
        const data = this._accumulatedData;
        this._accumulatedData = '';
        this._channel.append(data);
      }
      return Promise.resolve();
    });
  }

  appendLine(value: string): void {
    this.append(value + '\n');
  }

  clear(): void {
    this._accumulatedData = '';
    this._channel.clear();
  }

  show(columnOrPreserveFocus?, preserveFocus?): void {
    this._channel.show(columnOrPreserveFocus, preserveFocus);
  }

  hide(): void {
    this._channel.hide();
  }
}


export function isTruthy(value: (boolean|string|null|undefined|number)) {
  if (typeof value === 'string') {
    return !(
        ['', 'FALSE', 'OFF', '0', 'NOTFOUND', 'NO', 'N', 'IGNORE'].indexOf(
            value) >= 0 ||
        value.endsWith('-NOTFOUND'));
  }
  return !!value;
}
export function rmdir(dirpath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    rimraf(dirpath, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
export function isMultiConfGenerator(gen: string): boolean {
  return gen.includes('Visual Studio') || gen.includes('Xcode');
}
export function product<T>(arrays: T[][]): T[][] {
  // clang-format off
  return arrays.reduce((acc, curr) =>
    acc
      // Append each element of the current array to each list already accumulated
      .map(
        prev => curr.map(
          item => prev.concat(item)
        )
      )
      .reduce(
        // Join all the lists
        (a, b) => a.concat(b),
        []
      ),
      [[]] as T[][]
    );
  // clang-format on
}

export type Maybe<T> = (T | null);

export interface WorkspaceCache {
  variant?: Maybe<VariantCombination>;
  activeEnvironments?: string[];
  codeModel?: Maybe<CodeModelConfiguration[]>;
}

export function escapeStringForRegex(str: string): string {
  return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

export function replaceAll(str: string, needle: string, what: string) {
  const pattern = escapeStringForRegex(needle);
  const re = new RegExp(pattern, 'g');
  return str.replace(re, what);
}

export function removeAllPatterns(str: string, patterns: string[]): string {
  return patterns.reduce((acc, needle) => {
    return replaceAll(acc, needle, '');
  }, str);
}

export function normalizePath(p: string, normalize_case = true): string {
  let norm = path.normalize(p);
  while (path.sep !== path.posix.sep && norm.includes(path.sep)) {
    norm = norm.replace(path.sep, path.posix.sep);
  }
  if (normalize_case && process.platform === 'win32') {
    norm = norm.toLocaleLowerCase().normalize();
  }
  norm = norm.replace(/\/$/, '');
  while (norm.includes('//')) {
    norm = replaceAll(norm, '//', '/');
  }
  return norm;
}

export abstract class OutputParser {
  public abstract parseLine(line: string): Maybe<number>;
}

export async function ensureDirectory(dirpath: string): Promise<void> {
  const abs = path.normalize(path.resolve(dirpath));
  if (!(await async.exists(dirpath))) {
    const parent = path.dirname(dirpath);
    await ensureDirectory(parent);
    try {
      await async.doVoidAsync(fs.mkdir, dirpath);
    } catch (e) {
      if (e.code == 'EEXIST') {
        // It already exists, but that's ok
        return;
      }
      throw e;
    }
  } else {
    if (!(await async.isDirectory(dirpath))) {
      throw new Error(`Failed to create directory: "${dirpath
                      }" is an existing file and is not a directory`);
    }
  }
}

export async function writeFile(
    filepath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filepath));
  return new Promise<void>(
      (resolve, reject) => {fs.writeFile(filepath, content, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      })})
}


export interface Version {
  major: number;
  minor: number;
  patch: number;
}
export function parseVersion(str: string): Version {
  const version_re = /(\d+)\.(\d+).(\d+)/;
  const mat = version_re.exec(str);
  if (!mat) {
    throw new Error(`Invalid version string ${str}`);
  }
  const [major, minor, patch] = mat!;
  return {
    major: parseInt(major),
    minor: parseInt(minor),
    patch: parseInt(patch),
  };
}

export function versionGreater(lhs: Version, rhs: Version|string): boolean {
  if (typeof(rhs) === 'string') {
    return versionGreater(lhs, parseVersion(rhs));
  }
  return lhs.major > rhs.major ||
      (lhs.major == rhs.major && lhs.minor > rhs.minor) ||
      (lhs.major == rhs.major && lhs.minor == rhs.major &&
       lhs.patch == lhs.patch);
}

export function versionEquals(lhs: Version, rhs: Version|string): boolean {
  if (typeof(rhs) === 'string') {
    return versionEquals(lhs, parseVersion(rhs));
  }
  return lhs.major == rhs.major && lhs.minor == rhs.minor &&
      lhs.patch == rhs.patch;
}

export function versionLess(lhs: Version, rhs: Version|string): boolean {
  return !versionGreater(lhs, rhs) && versionEquals(lhs, rhs);
}

/**
 * An OutputParser that doesn't do anything when it parses
 */
export class NullParser extends OutputParser {
  public parseLine(line: string): Maybe<number> {
    return null;
  }
}

export interface ExecutionInformation {
  onComplete: Promise<api.ExecutionResult>;
  process: proc.ChildProcess;
}

export function execute(
    program: string, args: string[], env: {[key: string]: string} = {},
    workingDirectory?: string,
    outputChannel: vscode.OutputChannel | null = null): ExecutionInformation {
  let stdout = '';
  let stderr = '';
  if (outputChannel) {
    outputChannel.appendLine(
        '[vscode] Executing command: '
        // We do simple quoting of arguments with spaces.
        // This is only shown to the user,
        // and doesn't have to be 100% correct.
        +
        [program]
            .concat(args)
            .map(a => a.replace('"', '\"'))
            .map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a)
            .join(' '));
  }
  const pipe = proc.spawn(program, args, {
    env,
    cwd: workingDirectory,
  });
  for (const stream of [pipe.stdout, pipe.stderr]) {
    let backlog = '';
    stream.on('data', (data: Uint8Array) => {
      backlog += data.toString();
      let n = backlog.indexOf('\n');
      // got a \n? emit one or more 'line' events
      while (n >= 0) {
        stream.emit('line', backlog.substring(0, n).replace(/\r+$/, ''));
        backlog = backlog.substring(n + 1);
        n = backlog.indexOf('\n');
      }
    });
    stream.on('end', () => {
      if (backlog) {
        stream.emit('line', backlog.replace(/\r+$/, ''));
        if (outputChannel) {
          outputChannel.appendLine(backlog.replace(/\r+$/, ''));
        }
      }
    });
    stream.on('line', (line: string) => {
      console.log(`[${program} output]: ${line}`);
      if (outputChannel) {
        outputChannel.appendLine(line);
      }
    });
  }
  const pr = new Promise<api.ExecutionResult>((resolve, reject) => {
    pipe.on('error', reject);
    pipe.on('close', (retc: number) => {
      const msg = `${program} exited with return code ${retc}`;
      console.log(msg);
      if (outputChannel) {
        outputChannel.appendLine(`[vscode] ${msg}`)
      }
      resolve({retc, stdout, stderr});
    })
  });

  return {
    process: pipe,
    onComplete: pr,
  };
}

export async function testHaveCommand(
    program: string, args: string[] = ['--version']): Promise<Boolean> {
  return await new Promise<Boolean>((resolve, _) => {
    const pipe = proc.spawn(program, args);
    pipe.on('error', () => resolve(false));
    pipe.on('exit', () => resolve(true));
  });
}