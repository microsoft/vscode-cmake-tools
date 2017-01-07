import * as proc from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as vscode from 'vscode';

import * as api from './api';
import * as async from './async';
import {config} from './config';
import {CodeModelContent} from './server-client';
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
  codeModel?: Maybe<CodeModelContent>;
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
  const acc = {stdout: '', stderr: ''};
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
  for (const [acckey, stream] of [
           ['stdout', pipe.stdout],
           ['stderr', pipe.stderr]] as [string, NodeJS.ReadableStream][]) {
    let backlog = '';
    stream.on('data', (data: Uint8Array) => {
      backlog += data.toString();
      acc[acckey] += data.toString();
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
      resolve({retc, stdout: acc.stdout, stderr: acc.stderr});
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

// Given a list of CMake generators, returns the first one available on this
// system
export async function pickGenerator(candidates: string[]):
    Promise<Maybe<string>> {
  // The user can override our automatic selection logic in their config
  const generator = config.generator;
  if (generator) {
    // User has explicitly requested a certain generator. Use that one.
    return generator;
  }
  for (const gen of candidates) {
    const delegate = {
      Ninja: async() => {
        return await testHaveCommand('ninja-build') ||
            await testHaveCommand('ninja');
      },
      'MinGW Makefiles': async() => {
        return process.platform === 'win32' && await testHaveCommand('make');
      },
      'NMake Makefiles': async() => {
        return process.platform === 'win32' &&
            await testHaveCommand('nmake', ['/?']);
      },
      'Unix Makefiles': async() => {
        return process.platform !== 'win32' && await testHaveCommand('make');
      }
    }[gen];
    if (delegate === undefined) {
      const vsMatcher = /^Visual Studio (\d{2}) (\d{4})($|\sWin64$|\sARM$)/;
      if (vsMatcher.test(gen) && process.platform === 'win32') return gen;
      vscode.window.showErrorMessage('Unknown CMake generator "' + gen + '"');
      continue;
    }
    if (await delegate.bind(this)())
      return gen;
    else
      console.log('Generator "' + gen + '" is not supported');
  }
  return null;
}

export async function termProc(child: proc.ChildProcess) {
  // Stopping the process isn't as easy as it may seem. cmake --build will
  // spawn child processes, and CMake won't forward signals to its
  // children. As a workaround, we list the children of the cmake process
  // and also send signals to them.
  await this._killTree(child.pid);
  return true;
}

async function _killTree(pid: number) {
  if (process.platform !== 'win32') {
    let children: number[] = [];
    const stdout =
        (await async.execute('pgrep', ['-P', pid.toString()])).stdout.trim();
    if (!!stdout.length) {
      children = stdout.split('\n').map(line => Number.parseInt(line));
    }
    for (const other of children) {
      if (other) await this._killTree(other);
    }
    process.kill(pid, 'SIGINT');
  } else {
    // Because reasons, Node's proc.kill doesn't work on killing child
    // processes transitively. We have to do a sad and manually kill the
    // task using taskkill.
    proc.exec('taskkill /pid ' + pid.toString() + ' /T /F');
  }
}

export function splitCommandLine(cmd: string):
    string[] {
      const cmd_re = /('(\\'|[^'])*'|"(\\"|[^"])*"|(\\ |[^ ])+|[\w-]+)/g;
      const quoted_args = cmd.match(cmd_re);
      console.assert(quoted_args);
      // Our regex will parse escaped quotes, but they remain. We must
      // remove them ourselves
      return quoted_args!.map(
          arg => arg.replace(/\\(")/g, '$1').replace(/^"(.*)"$/g, '$1'));

    }

export function parseRawCompilationInfo(raw: api.RawCompilationInfo):
    api.CompilationInfo {
      // Here we try to get more interesting information about a compilation
      // than the raw command line.
      // First we should start by splitting the command up into the individual
      // arguments.
      const command = splitCommandLine(raw.command);
      const compiler = command[0];
      const flags: string[] = [];
      const inc_dirs = [] as ({
        path: string;
        isSystem: boolean
      }[]);
      const definitions = {} as {[key: string]: string | null};

      const include_flags =
          [{flag: '-I', isSystem: false}, {flag: '-isystem', isSystem: true}];
      const def_flags = ['-D'];
      if (compiler.endsWith('cl.exe')) {
        include_flags.push({flag: '/I', isSystem: false});
        def_flags.push('/D');
      }

      // We are parsing an MSVC-style command line.
      // It has options which may appear with a different argument prefix.
      const non_include_args: string[] = [];
      let arg = (n) => command[n];
      next_arg: for (let i = 1; i < command.length; ++i) {
        for (const iflag of include_flags) {
          const flagstr = iflag.flag;
          if (arg(i).startsWith(flagstr)) {
            const ipath =
                arg(i) == flagstr ? arg(++i) : arg(i).substr(flagstr.length);
            const abs_ipath = path.isAbsolute(ipath) ?
                ipath :
                path.join(raw.directory, ipath);
            inc_dirs.push({
              path: normalizePath(abs_ipath),
              isSystem: iflag.isSystem,
            });
            continue next_arg;
          }
        }
        non_include_args.push(arg(i));
      }

      const unparsed_args: string[] = [];
      arg = (n) => non_include_args[n];
      next_arg2: for (let i = 0; i < non_include_args.length; ++i) {
        for (const dflag of def_flags) {
          if (arg(i).startsWith(dflag)) {
            const defstr =
                arg(i) == dflag ? arg(++i) : arg(i).substr(dflag.length);
            const def = parseCompileDefinition(defstr);
            definitions[def[0]] = def[1];
            continue next_arg2;
          }
        }
        unparsed_args.push(arg(i));
      }

      return {
        compiler,
        compile: raw,
        compileDefinitions: definitions,
        file: raw.file,
        includeDirectories: inc_dirs,
        compileFlags: unparsed_args,
      };
    }



export function parseCompileDefinition(str: string): [string, string | null] {
  if (/^\w+$/.test(str)) {
    return [str, null];
  } else {
    const key = str.split('=', 1)[0];
    return [key, str.substr(key.length + 1)];
  }
}