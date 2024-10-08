import * as child_process from 'child_process';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as os from 'os';
import * as contex from './contextKeyExpr';

import { DebuggerEnvironmentVariable, execute } from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import { Environment, EnvironmentUtils } from './environmentVariables';
import { TargetPopulation } from 'vscode-tas-client';
import { expandString, ExpansionOptions } from './expand';
import { ExtensionManager } from './extension';
import * as glob from "glob";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
const parser = new contex.Parser({ regexParsingWithErrorRecovery: false });

class Context implements contex.IContext {

    protected _value: {[key: string]: any};

    constructor(dictionary: {[key: string]: any}) {
        this._value = dictionary;
    }
    public getValue<T>(key: string): T | undefined {
        const ret = this._value[key];
        return ret;
    }
}

/**
 * Escape a string so it can be used as a regular expression
 */
export function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

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
export function fixPaths(str: string | undefined) {
    if (str === undefined) {
        return undefined;
    }
    const fix_paths = /[A-Z]:(\\((?![<>:\"\/\\|\?\*]).)+)*\\?(?!\\)/gi;
    let pathmatch: RegExpMatchArray | null = null;
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

type NormalizationSetting = 'always' | 'never' | 'platform';
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
    return normalizePath(p, { normCase: 'never', normUnicode: 'never' });
}

export function platformNormalizePath(p: string): string {
    return normalizePath(p, { normCase: 'platform', normUnicode: 'platform' });
}

export function heavyNormalizePath(p: string): string {
    return normalizePath(p, { normCase: 'always', normUnicode: 'always' });
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
export function isTruthy(value: (boolean | string | null | undefined | number)) {
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
export function objectPairs<V>(obj: { [key: string]: V }): [string, V][] {
    return Object.getOwnPropertyNames(obj).map(key => ([key, obj[key]] as [string, V]));
}

/**
 * Remote null and undefined entries from an array.
 * @param x the input array
 */
export function removeEmpty<T>(x: (T | null | undefined)[]): T[] {
    return x.filter(e => e) as T[];
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

export function find<T>(iter: Iterable<T>, predicate: (value: T) => boolean): T | undefined {
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
export function randint(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min) + min);
}

export function product<T>(arrays: T[][]): T[][] {
    return arrays.reduce(
        (acc, curr) =>
            // Append each element of the current array to each list already accumulated
            acc.map(prev => curr.map(item => prev.concat(item)))
                // Join all the lists
                .reduce((a, b) => a.concat(b), []),
        [[]] as T[][]);
}

export interface CMakeValue {
    type: ('UNKNOWN' | 'BOOL' | 'STRING' | 'FILEPATH' | 'PATH' | '');  // There are more types, but we don't care ATM
    value: string;
}

export function cmakeify(value: (string | boolean | number | string[] | CMakeValue)): CMakeValue {
    const ret: CMakeValue = {
        type: 'UNKNOWN',
        value: ''
    };
    if (value === true || value === false) {
        ret.type = 'BOOL';
        ret.value = value ? 'TRUE' : 'FALSE';
    } else if (isString(value)) {
        ret.type = 'STRING';
        ret.value = replaceAll(value, ';', '\\;');
    } else if (typeof value === 'number') {
        ret.type = 'STRING';
        ret.value = value.toString();
    } else if (value instanceof Array) {
        ret.type = 'STRING';
        ret.value = value.join(';');
    } else if (Object.getOwnPropertyNames(value).filter(e => e === 'type' || e === 'value').length === 2) {
        ret.type = value.type;
        ret.value = value.value;
    } else {
        throw new Error(localize('invalid.value', 'Invalid value to convert to cmake value: {0}', JSON.stringify(value)));
    }
    return ret;
}

export async function termProc(child: child_process.ChildProcess) {
    // Stopping the process isn't as easy as it may seem. cmake --build will
    // spawn child processes, and CMake won't forward signals to its
    // children. As a workaround, we list the children of the cmake process
    // and also send signals to them.
    if (child.pid) {
        await _killTree(child.pid);
    }
    return true;
}

async function _killTree(pid: number) {
    if (process.platform !== 'win32') {
        let children: number[] = [];
        const stdout = (await execute('pgrep', ['-P', pid.toString()], null, { silent: true }).result).stdout.trim();
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
export function isMultiConfGeneratorFast(gen?: string): boolean {
    return gen !== undefined && (gen.includes('Visual Studio') || gen.includes('Xcode') || gen.includes('Multi-Config'));
}

export class InvalidVersionString extends Error {}

export interface Version {
    major: number;
    minor: number;
    patch: number;
}
export function parseVersion(str: string): Version {
    const version_re = /(\d+)\.(\d+)(\.(\d+))?(.*)/;
    const mat = version_re.exec(str);
    if (!mat) {
        throw new InvalidVersionString(localize('invalid.version.string', 'Invalid version string {0}', str));
    }
    const [, major, minor, , patch] = mat;
    return {
        major: parseInt(major ?? '0'),
        minor: parseInt(minor ?? '0'),
        patch: parseInt(patch ?? '0')
    };
}

export function tryParseVersion(str: string): Version | undefined {
    try {
        return parseVersion(str);
    } catch {
        return undefined;
    }
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

/**
 * Convert milliseconds into a friendly string like: 00:00:00.000
 */
export function msToString(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}.${pad(ms % 1000, 3)}`;
}

function pad(x: number, length?: number): string {
    return ('000' + x).slice(-(length ?? 2));
}

export function* flatMap<In, Out>(rng: Iterable<In>, fn: (item: In) => Iterable<Out>): Iterable<Out> {
    for (const elem of rng) {
        const mapped = fn(elem);
        for (const other_elem of mapped) {
            yield other_elem;
        }
    }
}

/**
 * Get the first non-empty item from an object that produces arrays of objects.
 */
export function first<In, Out>(array: Iterable<In>, fn: (item: In) => Out[]): Out[] {
    for (const item of array) {
        const result = fn(item);
        if (result?.length > 0) {
            return result;
        }
    }
    return [];
}

export function makeDebuggerEnvironmentVars(env?: Environment): DebuggerEnvironmentVariable[] {
    if (!env) {
        return [];
    }
    const filter: RegExp = /\$\{.+?\}|\n/; // Disallow env variables that have variable expansion values or newlines
    const converted_env: DebuggerEnvironmentVariable[] = [];
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined && !value.match(filter)) {
            converted_env.push({
                name: key,
                value
            });
        }
    }
    return converted_env;
}

export function fromDebuggerEnvironmentVars(debug_env?: DebuggerEnvironmentVariable[]): Environment {
    const env = EnvironmentUtils.create();
    if (debug_env) {
        debug_env.forEach(envVar => {
            env[envVar.name] = envVar.value;
        });
    }
    return env;
}

export function parseCompileDefinition(str: string): [string, string | null] {
    if (/^\w+$/.test(str)) {
        return [str, null];
    } else {
        const key = str.split('=', 1)[0];
        return [key, str.substr(key.length + 1)];
    }
}

export function thisExtension() {
    const extension = vscode.extensions.getExtension('ms-vscode.cmake-tools');
    if (!extension) {
        throw new Error(localize('extension.is.undefined', 'Extension is undefined!'));
    }
    return extension;
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

export async function getExtensionLocalizedPackageJson(): Promise<{[key: string]: any}> {
    let localizedFilePath: string = path.join(thisExtensionPath(), `package.nls.${getLocaleId()}.json`);
    const fileExists: boolean = await checkFileExists(localizedFilePath);
    if (!fileExists) {
        localizedFilePath = path.join(thisExtensionPath(), "package.nls.json");
    }
    const localizedStrings = fs.readFileSync(localizedFilePath, "utf8");
    return JSON.parse(localizedStrings);
}

interface CommandPalette {
    command: string;
    when: string | null;
}

/*
 * This works in our simple conditio case. would need to expand if our context conditions start getting more complex - including parentheses, other expressions that are not booleans.
*/
function evaluateExpression(expression: string | null, context: contex.IContext): boolean {
    if (expression === null || expression === undefined) {
        return true;
    } else if (expression === "never") {
        return false;
    }

    try {
        const constExpr = parser.parse(expression);
        return constExpr ? constExpr.evaluate(context) : false;
    } catch (e) {
        console.error("Invalid expression:", e);
        return false;
    }
}

export function thisExtensionActiveCommands(context: {[key: string]: any}): string [] {
    const pkg = thisExtension().packageJSON;
    const allCommands = pkg.contributes.menus.commandPalette as CommandPalette[];
    const contextObj = new Context(context);
    const activeCommands = allCommands.map((commandP) => {
        if (evaluateExpression(commandP.when, contextObj)) {
            return commandP.command;
        }
        return null;
    });
    return activeCommands.filter(x => x !== null) as string[];
}

export function thisExtensionPath(): string {
    return thisExtension().extensionPath;
}

export function dropNulls<T>(items: (T | null | undefined)[]): T[] {
    return items.filter(item => (item !== null && item !== undefined)) as T[];
}

export enum Ordering {
    Greater,
    Equivalent,
    Less,
}

export function compareVersions(a: Version | string, b: Version | string): Ordering {
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

export function versionGreater(lhs: Version | string, rhs: Version | string): boolean {
    return compareVersions(lhs, rhs) === Ordering.Greater;
}

export function versionGreaterOrEquals(lhs: Version | string, rhs: Version | string): boolean {
    const ordering = compareVersions(lhs, rhs);
    return (Ordering.Greater === ordering) || (Ordering.Equivalent === ordering);
}

export function versionEquals(lhs: Version | string, rhs: Version | string): boolean {
    return compareVersions(lhs, rhs) === Ordering.Equivalent;
}

export function versionLess(lhs: Version | string, rhs: Version | string): boolean {
    return compareVersions(lhs, rhs) === Ordering.Less;
}

export function versionLessOrEquals(lhs: Version | string, rhs: Version | string): boolean {
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
    if (typeof (process.env.VSCODE_NLS_CONFIG) === "string") {
        const vscodeNlsConfigJson: any = JSON.parse(process.env.VSCODE_NLS_CONFIG);
        if (typeof (vscodeNlsConfigJson.locale) === "string") {
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

export function checkFileExistsSync(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch (e) {
    }
    return false;
}

export function checkDirectoryExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, _reject) => {
        fs.stat(filePath, (_err, stats) => {
            resolve(stats && stats.isDirectory());
        });
    });
}

/** Test whether a directory exists */
export function checkDirectoryExistsSync(dirPath: string): boolean {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch (e) {
    }
    return false;
}

export function createDirIfNotExistsSync(dirPath: string | undefined): void {
    if (!dirPath) {
        return;
    }
    if (!checkDirectoryExistsSync(dirPath)) {
        try {
            fs.mkdirSync(dirPath, {recursive: true});
        } catch (e) {
            console.log(e);
        }
    }
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

// Get the fs.lstat using async function.
export function getLStat(filePath: string): Promise<fs.Stats | undefined> {
    return new Promise((resolve) => {
        fs.lstat(filePath, (_err, stats) => {
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
        progress.report({ message });
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
    if (process.platform === 'win32') {
        str = normalizePath(str, {normCase: 'always'});
    }
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

export function isWorkspaceFolder(x?: any): x is vscode.WorkspaceFolder {
    return 'uri' in x && 'name' in x && 'index' in x;
}

export async function normalizeAndVerifySourceDir(sourceDir: string, expansionOpts: ExpansionOptions): Promise<string> {
    sourceDir = await expandString(sourceDir, expansionOpts);
    let result = lightNormalizePath(sourceDir);
    if (process.platform === 'win32' && result.length > 1 && result.charCodeAt(0) > 97 && result.charCodeAt(0) <= 122 && result[1] === ':') {
        // Windows drive letter should be uppercase, for consistency with other tools like Visual Studio.
        result = result[0].toUpperCase() + result.slice(1);
    }
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

/**
 * Returns true if the extension is currently running tests.
 */
export function isTestMode(): boolean {
    return process.env['CMT_TESTING'] === '1';
}

export async function getAllCMakeListsPaths(path: string): Promise<string[] | undefined> {
    const regex: RegExp = new RegExp(/(\/|\\)CMakeLists\.txt$/);
    return recGetAllFilePaths(path, regex, await readDir(path), []);
}

async function recGetAllFilePaths(dir: string, regex: RegExp, files: string[], result: string[]) {
    for (const item of files) {
        const file = path.join(dir, item);
        try {
            const status = await getLStat(file);
            if (status) {
                if (status.isDirectory() && !status.isSymbolicLink()) {
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
    return (compilerName === 'cl' || compilerName === 'cl.exe') ? 'cl' :
        (compilerName === 'clang' || compilerName === 'clang.exe') ? 'clang' :
            (compilerName === 'clang-cl' || compilerName === 'clang-cl.exe') ? 'clang-cl' :
                (compilerName === 'clang-cpp' || compilerName === 'clang-cpp.exe') ? 'clang-cpp' :
                    (compilerName === 'clang++' || compilerName === 'clang++.exe') ? 'clang++' :
                        undefined;
}

async function getHostSystemName(): Promise<string> {
    if (process.platform === 'win32') {
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

export function getExtensionFilePath(extensionfile: string): string {
    return path.resolve(thisExtensionPath(), extensionfile);
}

export function getCmakeToolsTargetPopulation(): TargetPopulation {
    // If insiders.flag is present, consider this an insiders version.
    // If release.flag is present, consider this a release version.
    // Otherwise, consider this an internal build.
    if (checkFileExistsSync(getExtensionFilePath("insiders.flag"))) {
        return TargetPopulation.Insiders;
    } else if (checkFileExistsSync(getExtensionFilePath("release.flag"))) {
        return TargetPopulation.Public;
    }
    return TargetPopulation.Internal;
}

/**
 * @brief Schedule a task to be run at some future time. This allows other pending tasks to
 * execute ahead of the scheduled task and provides a form of async behavior for TypeScript.
 */
export function scheduleTask<T>(task: () => T): Promise<T> {
    return scheduleAsyncTask(() => {
        try {
            return Promise.resolve(task());
        } catch (e: any) {
            return Promise.reject(e);
        }
    });
}

/**
 * @brief A version of scheduleTask that supports async tasks as input.
 */
export async function scheduleAsyncTask<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        setImmediate(() => {
            void task().then(resolve).catch(reject);
        });
    });
}

export function isFileInsideFolder(uri: vscode.Uri, folderPath: string): boolean {
    const parent = platformNormalizePath(folderPath);
    const file = platformNormalizePath(uri.fsPath);
    return file.startsWith(parent);
}

/**
 * Asserts that the given value has no valid type. Useful for exhaustiveness checks.
 * @param value The value to be checked.
 */
export function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${value}`);
}

export function getHostArchitecture() {
    const arch = os.arch();
    switch (arch) {
        case 'arm64':
        case 'arm':
            return arch;
        case 'x32':
        case 'ia32':
            return 'x86';
        default:
            return 'x64';
    }
}

// Util for the special commands to forward to real commands
export function runCommand(key: keyof ExtensionManager, ...args: any[]) {
    return vscode.commands.executeCommand(`cmake.${key}`, ...args);
}

export async function globForFileName(fileName: string, depth: number, cwd: string): Promise<boolean> {
    let starString = ".";
    for (let i = 0; i <= depth; i++) {
        if (await globWrapper(`${starString}/${fileName}`, cwd)) {
            return true;
        }
        starString += "/*";
    }
    return false;
}

function globWrapper(globPattern: string, cwd: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        glob(globPattern, { cwd }, (err, files) => {
            if (err) {
                return reject(false);
            }

            if (files.length > 0) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}
