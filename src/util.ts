import * as child_process from 'child_process';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { platform } from 'os';

import {GeneralEnvironmentType, EnvironmentVariables, DebuggerEnvironmentVariable, execute} from '@cmt/proc';
import rollbar from '@cmt/rollbar';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
 * Fix slashes in Windows paths for CMake
 * @param str The input string
 * @returns The modified string with fixed paths
 */
export function fixPaths(str: string) {
  const fix_paths = /[A-Z]:(\\((?![<>:\"\/\\|\?\*]).)+)*\\?(?!\\)/gi;
  let pathmatch: RegExpMatchArray|null = null;
  let newstr = str;
  while ((pathmatch = fix_paths.exec(str))) {
    const pathfull = pathmatch[0];
    const fixslash = pathfull.replace(/\\/g, '/');
    newstr = newstr.replace(pathfull, fixslash);
  }
  return newstr;
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

type NormalizationSetting = 'always'|'never'|'platform';
interface PathNormalizationOptions {
  normCase?: NormalizationSetting;
  normUnicode?: NormalizationSetting;
}

/**
 * Completely normalize/canonicalize a path.
 * Using `path.normalize` isn't sufficient. We want convert all paths to use
 * POSIX separators, remove redundant separators, and sometimes normalize the
 * case of the path.
 *
 * @param p The input path
 * @param opt Options to control the normalization
 * @returns The normalized path
 */
export function normalizePath(p: string, opt: PathNormalizationOptions): string {
  const normCase: NormalizationSetting = opt ? opt.normCase ? opt.normCase : 'never' : 'never';
  const normUnicode: NormalizationSetting = opt ? opt.normUnicode ? opt.normUnicode : 'never' : 'never';
  let norm = path.normalize(p);
  while (path.sep !== path.posix.sep && norm.includes(path.sep)) {
    norm = norm.replace(path.sep, path.posix.sep);
  }
  // Normalize for case an unicode
  switch (normCase) {
  case 'always':
    norm = norm.toLocaleLowerCase();
    break;
  case 'platform':
    if (process.platform === 'win32' || process.platform === 'darwin') {
      norm = norm.toLocaleLowerCase();
    }
    break;
  case 'never':
    break;
  }
  switch (normUnicode) {
  case 'always':
    norm = norm.normalize();
    break;
  case 'platform':
    if (process.platform === 'darwin') {
      norm = norm.normalize();
    }
    break;
  case 'never':
    break;
  }
  // Remove trailing slashes
  norm = norm.replace(/\/$/g, '');
  // Remove duplicate slashes
  while (norm.includes('//')) {
    norm = replaceAll(norm, '//', '/');
  }
  return norm;
}

export function lightNormalizePath(p: string): string {
  return normalizePath(p, {normCase: 'never', normUnicode: 'never'});
}

export function platformNormalizePath(p: string): string {
  return normalizePath(p, {normCase: 'platform', normUnicode: 'platform'});
}

export function heavyNormalizePath(p: string): string {
  return normalizePath(p, {normCase: 'always', normUnicode: 'always'});
}

export function resolvePath(inpath: string, base: string) {
  const abspath = path.isAbsolute(inpath) ? inpath : path.join(base, inpath);
  // Even absolute paths need to be normalized since they could contain rogue .. and .
  return lightNormalizePath(abspath);
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
  if (pardir === p) {
    // We've reach a root path. (Might be a Windows drive dir)
    return [p];
  }
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
    value = value.toUpperCase();
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

export function* chain<T>(...iter: Iterable<T>[]): Iterable<T> {
  for (const sub of iter) {
    for (const item of sub) {
      yield item;
    }
  }
}

export function reduce<In, Out>(iter: Iterable<In>, init: Out, mapper: (acc: Out, el: In) => Out): Out {
  for (const item of iter) {
    init = mapper(init, item);
  }
  return init;
}

export function find<T>(iter: Iterable<T>, predicate: (value: T) => boolean): T|undefined {
  for (const value of iter) {
    if (predicate(value)) {
      return value;
    }
  }
  // Nothing found
  return undefined;
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
  type: ('UNKNOWN'|'BOOL'|'STRING'|'FILEPATH');  // There are more types, but we don't care ATM
  value: string;
}

export function cmakeify(value: (string|boolean|number|string[])): CMakeValue {
  const ret: CMakeValue = {
    type: 'UNKNOWN',
    value: ''
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
      if (other) {
        await _killTree(other);
      }
    }
    try {
      process.kill(pid, 'SIGINT');
    } catch (e: any) {
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

/**
 * This is an initial check without atually configuring. It may or may not be accurate.
 */
export function isMultiConfGeneratorFast(gen: string): boolean {
  return gen.includes('Visual Studio') || gen.includes('Xcode') || gen.includes('Multi-Config');
}

export class InvalidVersionString extends Error {}

export interface Version {
  major: number;
  minor: number;
  patch: number;
}
export function parseVersion(str: string): Version {
  const version_re = /(\d+)\.(\d+)\.(\d+)(.*)/;
  const mat = version_re.exec(str);
  if (!mat) {
    throw new InvalidVersionString(localize('invalid.version.string', 'Invalid version string {0}', str));
  }
  const [, major, minor, patch] = mat;
  return {
    major: parseInt(major ?? '0'),
    minor: parseInt(minor ?? '0'),
    patch: parseInt(patch ?? '0')
  };
}

export function compareVersion(va: Version, vb: Version) {
  if (va.major !== vb.major) {
    return va.major - vb.major;
  }
  if (va.minor !== vb.minor) {
    return va.minor - vb.minor;
  }
  return va.patch - vb.patch;
}

export function versionToString(ver: Version): string {
  return `${ver.major}.${ver.minor}.${ver.patch}`;
}

export function errorToString(e: any): string {
  if (e.stack) {
    // e.stack has both the message and the stack in it.
    return `\n\t${e.stack}`;
  }
  return `\n\t${e.toString()}`;
}

export function* flatMap<In, Out>(rng: Iterable<In>, fn: (item: In) => Iterable<Out>): Iterable<Out> {
  for (const elem of rng) {
    const mapped = fn(elem);
    for (const other_elem of mapped) {
      yield other_elem;
    }
  }
}

export function makeDebuggerEnvironmentVars(env: EnvironmentVariables): DebuggerEnvironmentVariable[] {
  const converted_env: DebuggerEnvironmentVariable[] = Object.entries(env).map(
    ([key, value]) => ({
      name: key,
      value
    })
  );
  return converted_env;
}

/**
 * mergeEnvironment will merge a list of environment map
 * without expand, it's will merge them in case-insensitive way on Windows,
 * and in case-sensitive on Posix system.
 *
 * @param envs The list of environment variables to merge
 */
export function mergeEnvironment(...envs: (EnvironmentVariables | undefined)[]): EnvironmentVariables {
  return envs.reduce((acc: EnvironmentVariables, vars) => {
    if (vars) {
      const env_entries = Object.entries(vars) as [string, null | string][];
      for (const newEnvItem of env_entries) {
        const key = newEnvItem[0];
        const value = newEnvItem[1];
        // For cmake preset environment variables, value may be null
        // exclude those variable
        if (typeof value === 'string') {
          envSet(acc, key, value);
        } else {
          envDelete(acc, key);
        }
      }
    }
    return acc;
  }, {});
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
  const ext = vscode.extensions.getExtension('ms-vscode.cmake-tools');
  if (!ext) {
    throw new Error(localize('extension.is.null', 'Our own extension is null! What gives?'));
  }
  return ext;
}

export interface PackageJSON {
  name: string;
  publisher: string;
  version: string;
}

export function thisExtensionPackage(): PackageJSON {
  const pkg = thisExtension().packageJSON as PackageJSON;
  return {
    name: pkg.name,
    publisher: pkg.publisher,
    version: pkg.version
  };
}

export function thisExtensionPath(): string { return thisExtension().extensionPath; }

export function dropNulls<T>(items: (T|null|undefined)[]): T[] {
  return items.filter(item => (item !== null && item !== undefined)) as T[];
}

export enum Ordering {
  Greater,
  Equivalent,
  Less,
}

export function compareVersions(a: Version|string, b: Version|string): Ordering {
  if (typeof a === 'string') {
    a = parseVersion(a);
  }
  if (typeof b === 'string') {
    b = parseVersion(b);
  }
  // Compare major
  if (a.major > b.major) {
    return Ordering.Greater;
  } else if (a.major < b.major) {
    return Ordering.Less;
    // Compare minor
  } else if (a.minor > b.minor) {
    return Ordering.Greater;
  } else if (a.minor < b.minor) {
    return Ordering.Less;
    // Compare patch
  } else if (a.patch > b.patch) {
    return Ordering.Greater;
  } else if (a.patch < b.patch) {
    return Ordering.Less;
    // No difference:
  } else {
    return Ordering.Equivalent;
  }
}

export function versionGreater(lhs: Version|string, rhs: Version|string): boolean {
  return compareVersions(lhs, rhs) === Ordering.Greater;
}

export function versionGreaterOrEquals(lhs: Version|string, rhs: Version|string): boolean {
  const ordering = compareVersions(lhs, rhs);
  return (Ordering.Greater === ordering) || (Ordering.Equivalent === ordering);
}

export function versionEquals(lhs: Version|string, rhs: Version|string): boolean {
  return compareVersions(lhs, rhs) === Ordering.Equivalent;
}

export function versionLess(lhs: Version|string, rhs: Version|string): boolean {
  return compareVersions(lhs, rhs) === Ordering.Less;
}

export function versionLessOrEquals(lhs: Version|string, rhs: Version|string): boolean {
  const ordering = compareVersions(lhs, rhs);
  return (Ordering.Less === ordering) || (Ordering.Equivalent === ordering);
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

export function platformPathCompare(a: string, b: string): Ordering {
  return compare(platformNormalizePath(a), platformNormalizePath(b));
}

export function platformPathEquivalent(a: string, b: string): boolean {
  return platformPathCompare(a, b) === Ordering.Equivalent;
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
        return 0;  // Same elements
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

export function getLocaleId(): string {
  if (typeof(process.env.VSCODE_NLS_CONFIG) === "string") {
      const vscodeNlsConfigJson: any = JSON.parse(process.env.VSCODE_NLS_CONFIG);
      if (typeof(vscodeNlsConfigJson.locale) === "string") {
          return vscodeNlsConfigJson.locale;
      }
  }
  return "en";
}

export function checkFileExists(filePath: string): Promise<boolean> {
  return new Promise((resolve, _reject) => {
      fs.stat(filePath, (_err, stats) => {
          resolve(stats && stats.isFile());
      });
  });
}

export function checkDirectoryExists(filePath: string): Promise<boolean> {
  return new Promise((resolve, _reject) => {
      fs.stat(filePath, (_err, stats) => {
          resolve(stats && stats.isDirectory());
      });
  });
}

// Read the files in a directory.
export function readDir(dirPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    fs.readdir(dirPath, (error, list) => {
      if (error) {
        resolve([]);
      } else {
        resolve(list);
      }

    });
  });
}

// Get the fs.stat using async function.
export function getStat(filePath: string): Promise<fs.Stats | undefined> {
  return new Promise((resolve) => {
    fs.stat(filePath, (_err, stats) => {
      if (stats) {
        resolve(stats);
      } else {
        resolve(undefined);
      }
    });
  });
}

export function disposeAll(disp: Iterable<vscode.Disposable>) {
  for (const d of disp) {
    d.dispose();
  }
}

export function reportProgress(message: string, progress?: ProgressHandle) {
  if (progress) {
    progress.report({message});
  }
}

export function chokidarOnAnyChange(watcher: chokidar.FSWatcher, listener: (path: string, stats?: fs.Stats | undefined) => void) {
  return watcher.on('add', listener)
                .on('change', listener)
                .on('unlink', listener);
}

export function isString(x: any): x is string {
  return Object.prototype.toString.call(x) === "[object String]";
}

export function isBoolean(x: any): x is boolean {
  return x === true || x === false;
}

export function makeHashString(str: string): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(str);
    return hash.digest('hex');
}

export function isArray<T>(x: any): x is T[] {
  return x instanceof Array;
}

export function isArrayOfString(x: any): x is string[] {
  return isArray(x) && x.every(isString);
}

export function isNullOrUndefined(x?: any): x is null | undefined {
  return (x === null || x === undefined);
}

export function isWorkspaceFolder(x?: any): boolean {
  return 'uri' in x && 'name' in x && 'index' in x;
}

export async function normalizeAndVerifySourceDir(sourceDir: string): Promise<string> {
  let result = lightNormalizePath(sourceDir);
  if (path.basename(result).toLocaleLowerCase() === "cmakelists.txt") {
    // Don't fail if CMakeLists.txt was accidentally appended to the sourceDirectory.
    result = path.dirname(result);
  }
  if (!(await checkDirectoryExists(result))) {
    rollbar.error(localize('sourcedirectory.not.a.directory', '"sourceDirectory" is not a directory'), { sourceDirectory: result });
  }
  return result;
}

export function isCodespaces(): boolean {
  return !!process.env["CODESPACES"];
}

export async function getAllCMakeListsPaths(dir: vscode.Uri): Promise<string[] | undefined> {
  const regex: RegExp = new RegExp(/(\/|\\)CMakeLists\.txt$/);
  return recGetAllFilePaths(dir.fsPath, regex, await readDir(dir.fsPath), []);
}

async function recGetAllFilePaths(dir: string, regex: RegExp, files: string[], result: string[]) {
  for (const item of files) {
    const file = path.join(dir, item);
    try {
      const status = await getStat(file);
      if (status) {
        if (status.isDirectory()) {
          result = await recGetAllFilePaths(file, regex, await readDir(file), result);
        } else if (status.isFile() && regex.test(file)) {
          result.push(file);
        }
      }
    } catch (error) {
      continue;
    }
  }
  return result;
}

export function getRelativePath(file: string, dir: string): string {
  const fullPathDir: string = path.parse(file).dir;
  const relPathDir: string = lightNormalizePath(path.relative(dir, fullPathDir));
  const joinedPath = "${workspaceFolder}/".concat(relPathDir);
  return joinedPath;
}

// cl, clang, clang-cl, clang-cpp and clang++ are supported compilers.
export function isSupportedCompiler(compilerName: string | undefined): string | undefined {
  return  (compilerName === 'cl' || compilerName === 'cl.exe') ? 'cl' :
          (compilerName === 'clang' || compilerName === 'clang.exe') ? 'clang' :
          (compilerName === 'clang-cl' || compilerName === 'clang-cl.exe') ? 'clang-cl' :
          (compilerName === 'clang-cpp' || compilerName === 'clang-cpp.exe') ? 'clang-cpp' :
          (compilerName === 'clang++' || compilerName === 'clang++.exe') ? 'clang++' :
          undefined;
}

async function getHostSystemName(): Promise<string> {
  if (platform() === "win32") {
    return "Windows";
  } else {
    const result = await execute('uname', ['-s']).result;
    if (result.retc === 0) {
      return result.stdout.trim();
    } else {
      return 'unknown';
    }
  }
}

function memoize<T>(fn: () => T) {
  let result: T;

  return () => {
    if (result) {
      return result;
    } else {
      return result = fn();
    }
  };
}

export const getHostSystemNameMemo = memoize(getHostSystemName);
