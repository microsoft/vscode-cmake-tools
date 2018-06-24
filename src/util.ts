import * as child_process from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import {EnvironmentVariables, execute} from './proc';

/**
 * Escape a string so it can be used as a regular expression
 */
export function escapeStringForRegex(str: string): string { return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1'); }

/**
 * Replace all occurrences of `needle` in `str` with `what`
 * @param str The input string
 * @param needle The search string
 * @param what The value to insert in place of `needle`
 * @returns The modified string
 */
export function replaceAll(str: string, needle: string, what: string) {
  const pattern = escapeStringForRegex(needle);
  const re = new RegExp(pattern, 'g');
  return str.replace(re, what);
}

/**
 * Remove all occurrences of a list of strings from a string.
 * @param str The input string
 * @param patterns Strings to remove from `str`
 * @returns The modified string
 */
export function removeAllPatterns(str: string, patterns: string[]): string {
  return patterns.reduce((acc, needle) => replaceAll(acc, needle, ''), str);
}

/**
 * Completely normalize/canonicalize a path.
 * Using `path.normalize` isn't sufficient. We want convert all paths to use
 * POSIX separators, remove redundant separators, and sometimes normalize the
 * case of the path.
 *
 * @param p The input path
 * @param normalize_case Whether we should normalize the case of the path
 * @returns The normalized path
 */
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

/**
 * Split a path into its elements.
 * @param p The path to split
 */
export function splitPath(p: string): string[] {
  if (p.length === 0 || p === '.') {
    return [];
  }
  const pardir = path.dirname(p);
  const arr: string[] = [];
  if (p.startsWith(pardir)) {
    arr.push(...splitPath(pardir));
  }
  arr.push(path.basename(p));
  return arr;
}

/**
 * Check if a value is "truthy" according to CMake's own language rules
 * @param value The value to check
 */
export function isTruthy(value: (boolean|string|null|undefined|number)) {
  if (typeof value === 'string') {
    return !(['', 'FALSE', 'OFF', '0', 'NOTFOUND', 'NO', 'N', 'IGNORE'].indexOf(value) >= 0
             || value.endsWith('-NOTFOUND'));
  }
  // Numbers/bools/etc. follow common C-style truthiness
  return !!value;
}

/**
 * Generate an array of key-value pairs from an object using
 * `getOwnPropertyNames`
 * @param obj The object to iterate
 */
export function objectPairs<V>(obj: {[key: string]: V}): [string, V][] {
  return Object.getOwnPropertyNames(obj).map(key => ([key, obj[key]] as [string, V]));
}

/**
 * Map an iterable by some projection function
 * @param iter An iterable to map
 * @param proj The projection function
 */
export function* map<In, Out>(iter: Iterable<In>, proj: (arg: In) => Out): Iterable<Out> {
  for (const item of iter) {
    yield proj(item);
  }
}

export function reduce<In, Out>(iter: Iterable<In>, init: Out, mapper: (acc: Out, el: In) => Out): Out {
  for (const item of iter) {
    init = mapper(init, item);
  }
  return init;
}

/**
 * Generate a random integral value.
 * @param min Minimum value
 * @param max Maximum value
 */
export function randint(min: number, max: number): number { return Math.floor(Math.random() * (max - min) + min); }


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

export interface CMakeValue {
  type: ('UNKNOWN'|'BOOL'|'STRING');  // There are more types, but we don't care ATM
  value: string;
}

export function cmakeify(value: (string|boolean|number|string[])): CMakeValue {
  const ret: CMakeValue = {
    type: 'UNKNOWN',
    value: '',
  };
  if (value === true || value === false) {
    ret.type = 'BOOL';
    ret.value = value ? 'TRUE' : 'FALSE';
  } else if (typeof (value) === 'string') {
    ret.type = 'STRING';
    ret.value = replaceAll(value, ';', '\\;');
  } else if (typeof value === 'number') {
    ret.type = 'STRING';
    ret.value = value.toString();
  } else if (value instanceof Array) {
    ret.type = 'STRING';
    ret.value = value.join(';');
  } else {
    throw new Error(`Invalid value to convert to cmake value: ${value}`);
  }
  return ret;
}


export async function termProc(child: child_process.ChildProcess) {
  // Stopping the process isn't as easy as it may seem. cmake --build will
  // spawn child processes, and CMake won't forward signals to its
  // children. As a workaround, we list the children of the cmake process
  // and also send signals to them.
  await _killTree(child.pid);
  return true;
}

async function _killTree(pid: number) {
  if (process.platform !== 'win32') {
    let children: number[] = [];
    const stdout = (await execute('pgrep', ['-P', pid.toString()], null, {silent: true}).result).stdout.trim();
    if (!!stdout.length) {
      children = stdout.split('\n').map(line => Number.parseInt(line));
    }
    for (const other of children) {
      if (other)
        await _killTree(other);
    }
    try {
      process.kill(pid, 'SIGINT');
    } catch (e) {
      if (e.code === 'ESRCH') {
        // Do nothing. We're okay.
      } else {
        throw e;
      }
    }
  } else {
    // Because reasons, Node's proc.kill doesn't work on killing child
    // processes transitively. We have to do a sad and manually kill the
    // task using taskkill.
    child_process.exec(`taskkill /pid ${pid.toString()} /T /F`);
  }
}

export function splitCommandLine(cmd: string): string[] {
  const cmd_re = /('(\\'|[^'])*'|"(\\"|[^"])*"|(\\ |[^ ])+|[\w-]+)/g;
  const quoted_args = cmd.match(cmd_re);
  console.assert(quoted_args);
  // Our regex will parse escaped quotes, but they remain. We must
  // remove them ourselves
  return quoted_args!.map(arg => arg.replace(/\\(")/g, '$1').replace(/^"(.*)"$/g, '$1'));
}

export function isMultiConfGenerator(gen: string): boolean {
  return gen.includes('Visual Studio') || gen.includes('Xcode');
}


export interface Version {
  major: number;
  minor: number;
  patch: number;
}
export function parseVersion(str: string): Version {
  const version_re = /(\d+)\.(\d+)\.(\d+)/;
  const mat = version_re.exec(str);
  if (!mat) {
    throw new Error(`Invalid version string ${str}`);
  }
  const [, major, minor, patch] = mat;
  return {
    major: parseInt(major),
    minor: parseInt(minor),
    patch: parseInt(patch),
  };
}

export function versionGreater(lhs: Version, rhs: Version|string): boolean {
  if (typeof (rhs) === 'string') {
    return versionGreater(lhs, parseVersion(rhs));
  }
  if (lhs.major > rhs.major) {
    return true;
  } else if (lhs.major === rhs.major) {
    if (lhs.minor > rhs.minor) {
      return true;
    } else if (lhs.minor === rhs.minor) {
      return lhs.patch > rhs.patch;
    }
  }
  return false;
}

export function versionToString(ver: Version): string { return `${ver.major}.${ver.minor}.${ver.patch}`; }

export function* flatMap<In, Out>(rng: Iterable<In>, fn: (item: In) => Iterable<Out>): Iterable<Out> {
  for (const elem of rng) {
    const mapped = fn(elem);
    for (const other_elem of mapped) {
      yield other_elem;
    }
  }
}

export function versionEquals(lhs: Version, rhs: Version|string): boolean {
  if (typeof (rhs) === 'string') {
    return versionEquals(lhs, parseVersion(rhs));
  }
  return lhs.major === rhs.major && lhs.minor === rhs.minor && lhs.patch === rhs.patch;
}

export function versionLess(lhs: Version, rhs: Version|string): boolean {
  return !versionGreater(lhs, rhs) && !versionEquals(lhs, rhs);
}

export function mergeEnvironment(...env: EnvironmentVariables[]): EnvironmentVariables {
  return env.reduce((acc, vars) => {
    if (process.platform === 'win32') {
      // Env vars on windows are case insensitive, so we take the ones from
      // active env and overwrite the ones in our current process env
      const norm_vars = Object.getOwnPropertyNames(vars).reduce<EnvironmentVariables>((acc2, key: string) => {
        acc2[key.toUpperCase()] = vars[key];
        return acc2;
      }, {});
      return {...acc, ...norm_vars};
    } else {
      return {...acc, ...vars};
    }
  }, {});
}

export function normalizeEnvironmentVarname(varname: string) {
  return process.platform == 'win32' ? varname.toLocaleLowerCase() : varname;
}

export function parseCompileDefinition(str: string): [string, string|null] {
  if (/^\w+$/.test(str)) {
    return [str, null];
  } else {
    const key = str.split('=', 1)[0];
    return [key, str.substr(key.length + 1)];
  }
}

export function thisExtension() {
  const ext = vscode.extensions.getExtension('vector-of-bool.cmake-tools');
  if (!ext) {
    throw new Error('Out own extension is null! What gives?');
  }
  return ext;
}

export function thisExtensionPath(): string { return thisExtension().extensionPath; }

export function dropNulls<T>(items: (T|null)[]): T[] { return items.filter(item => item !== null) as T[]; }

export enum Ordering {
  Greater,
  Equivalent,
  Less,
}

export function compare(a: any, b: any): Ordering {
  const a_json = JSON.stringify(a);
  const b_json = JSON.stringify(b);
  if (a_json < b_json) {
    return Ordering.Less;
  } else if (a_json > b_json) {
    return Ordering.Greater;
  } else {
    return Ordering.Equivalent;
  }
}

export function setContextValue(key: string, value: any): Thenable<void> {
  return vscode.commands.executeCommand('setContext', key, value);
}

export interface ProgressReport {
  message: string;
  increment?: number;
}

export type ProgressHandle = vscode.Progress<ProgressReport>;

export class DummyDisposable {
  dispose() {}
}

export function lexicographicalCompare(a: Iterable<string>, b: Iterable<string>): number {
  const a_iter = a[Symbol.iterator]();
  const b_iter = b[Symbol.iterator]();
  while (1) {
    const a_res = a_iter.next();
    const b_res = b_iter.next();
    if (a_res.done) {
      if (b_res.done) {
        return 0; // Same elements
      } else {
        // a is "less" (shorter string)
        return -1;
      }
    } else if (b_res.done) {
      // b is "less" (shorter)
      return 1;
    } else {
      const comp_res = a_res.value.localeCompare(b_res.value);
      if (comp_res !== 0) {
        return comp_res;
      }
    }
  }
  // Loop analysis can't help us. TS believes we run off the end of
  // the function.
  console.assert(false, 'Impossible code path');
  return 0;
}