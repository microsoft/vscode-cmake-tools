import * as child_process from 'child_process';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as os from 'os';
import * as contex from '@cmt/contextKeyExpr';

import { DebuggerEnvironmentVariable, execute } from '@cmt/proc';
import rollbar from '@cmt/rollbar';
import { Environment, EnvironmentUtils } from '@cmt/environmentVariables';
import { TargetPopulation } from 'vscode-tas-client';
import { expandString, ExpansionOptions } from '@cmt/expand';
import { ExtensionManager } from '@cmt/extension';
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
            if (process.platform === 'win32') {
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

/**
 * Normalizes the given path with minimal changes.
 * @param p The path to normalize.
 * @returns The normalized path.
 */
export function lightNormalizePath(p: string): string {
    return normalizePath(p, { normCase: 'never', normUnicode: 'never' });
}

/**
 * Normalizes the given path according to the platform's case and Unicode normalization rules.
 * @param p The path to normalize.
 * @returns The normalized path.
 */
export function platformNormalizePath(p: string): string {
    return normalizePath(p, { normCase: 'platform', normUnicode: 'platform' });
}

/**
 * Fully normalizes the given path, including case and Unicode normalization.
 * @param p The path to normalize.
 * @returns The fully normalized path.
 */
export function heavyNormalizePath(p: string): string {
    return normalizePath(p, { normCase: 'always', normUnicode: 'always' });
}

/**
 * Resolves the given path relative to the base path and normalizes it.
 * @param inpath The input path to resolve.
 * @param base The base path to resolve against.
 * @returns The resolved and normalized path.
 */
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

/**
 * Reduces an iterable to a single value by applying a reducer function to each element.
 * @param iter The iterable to reduce.
 * @param init The initial value to start the reduction.
 * @param mapper The reducer function that takes the accumulated value and the current element, and returns the new accumulated value.
 * @returns The final accumulated value after processing all elements in the iterable.
 */
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
export function randint(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min) + min);
}

/**
 * Computes the Cartesian product of the provided arrays.
 * The Cartesian product of multiple arrays is a set of all possible combinations
 * where each combination contains one element from each array.
 * @param arrays An array of arrays for which to compute the Cartesian product.
 * @returns An array of arrays, where each inner array is a combination of elements from the input arrays.
 */
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

/**
 * Converts a given value to a CMake-compatible value.
 * The function determines the type of the input value and converts it to a corresponding CMakeValue object.
 * @param value The value to convert. It can be a string, boolean, number, string array, or CMakeValue.
 * @returns A CMakeValue object with the appropriate type and value.
 * @throws An error if the input value is invalid or cannot be converted to a CMakeValue.
 */
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

/**
 * Terminates a child process and its descendant processes.
 * Stopping the process isn't straightforward because `cmake --build` spawns child processes,
 * and CMake won't forward signals to its children. This function lists the children of the
 * CMake process and sends signals to them as well.
 * @param child The child process to terminate.
 * @returns A promise that resolves to true when the process and its descendants have been terminated.
 */
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

/**
 * Recursively kills a process and its child processes.
 * @param pid The process ID to kill.
 */
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

/**
 * Parses a version string into a Version object.
 * The version string is expected to be in the format "major.minor.patch".
 * @param str The version string to parse.
 * @returns A Version object with the parsed major, minor, and patch numbers.
 * @throws InvalidVersionString if the input string is not a valid version string.
 */
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

/**
 * Tries to parse a version string into a Version object.
 * If the input string is not a valid version string, it returns undefined instead of throwing an error.
 * @param str The version string to parse.
 * @returns A Version object with the parsed major, minor, and patch numbers, or undefined if the input string is not valid.
 */
export function tryParseVersion(str: string): Version | undefined {
    try {
        return parseVersion(str);
    } catch {
        return undefined;
    }
}

/**
 * Compares two version objects.
 * @param va The first version object to compare.
 * @param vb The second version object to compare.
 * @returns A negative number if va < vb, zero if va == vb, and a positive number if va > vb.
 */
export function compareVersion(va: Version, vb: Version) {
    if (va.major !== vb.major) {
        return va.major - vb.major;
    }
    if (va.minor !== vb.minor) {
        return va.minor - vb.minor;
    }
    return va.patch - vb.patch;
}

/**
 * Converts a Version object to a string in the format "major.minor.patch".
 * @param ver The Version object to convert.
 * @returns A string representation of the version.
 */
export function versionToString(ver: Version): string {
    return `${ver.major}.${ver.minor}.${ver.patch}`;
}

/**
 * Converts an error object to a string.
 * If the error has a stack trace, it includes the stack trace in the string.
 * @param e The error object to convert.
 * @returns A string representation of the error.
 */
export function errorToString(e: any): string {
    if (e.stack) {
        // e.stack has both the message and the stack in it.
        return `\n\t${e.stack}`;
    }
    return `\n\t${e.toString()}`;
}

/**
 * Converts milliseconds into a friendly string in the format "HH:MM:SS.mmm".
 * @param ms The number of milliseconds to convert.
 * @returns A string representation of the time.
 */
export function msToString(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}.${pad(ms % 1000, 3)}`;
}

/**
 * Pads a number with leading zeros to the specified length.
 * @param x The number to pad.
 * @param length The desired length of the output string. Defaults to 2.
 * @returns A string representation of the number, padded with leading zeros.
 */
function pad(x: number, length?: number): string {
    return ('000' + x).slice(-(length ?? 2));
}

/**
 * Applies a function to each element of an iterable and flattens the result.
 * @param rng The input iterable.
 * @param fn The function to apply to each element, which returns an iterable.
 * @returns A flattened iterable of the results.
 */
export function* flatMap<In, Out>(rng: Iterable<In>, fn: (item: In) => Iterable<Out>): Iterable<Out> {
    for (const elem of rng) {
        const mapped = fn(elem);
        for (const other_elem of mapped) {
            yield other_elem;
        }
    }
}

/**
 * Gets the first non-empty item from an iterable that produces arrays of objects.
 * @param array The input iterable.
 * @param fn The function to apply to each element, which returns an array.
 * @returns The first non-empty array produced by the function, or an empty array if none are found.
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

/**
 * Converts an environment object to an array of DebuggerEnvironmentVariable objects.
 * Filters out environment variables that contain variable expansion values or newlines.
 * @param env The environment object to convert.
 * @returns An array of DebuggerEnvironmentVariable objects.
 */
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

/**
 * Converts an array of DebuggerEnvironmentVariable objects to an Environment object.
 * @param debug_env An array of DebuggerEnvironmentVariable objects.
 * @returns An Environment object with the converted environment variables.
 */
export function fromDebuggerEnvironmentVars(debug_env?: DebuggerEnvironmentVariable[]): Environment {
    const env = EnvironmentUtils.create();
    if (debug_env) {
        debug_env.forEach(envVar => {
            env[envVar.name] = envVar.value;
        });
    }
    return env;
}

/**
 * Parses a compile definition string into a key-value pair.
 * If the string is a simple word, it returns the word as the key and null as the value.
 * If the string contains an '=', it splits the string into a key and value.
 * @param str The compile definition string to parse.
 * @returns A tuple containing the key and value.
 */
export function parseCompileDefinition(str: string): [string, string | null] {
    if (/^\w+$/.test(str)) {
        return [str, null];
    } else {
        const key = str.split('=', 1)[0];
        return [key, str.substr(key.length + 1)];
    }
}

/**
 * Retrieves the current instance of the CMake Tools extension.
 * @returns The current instance of the CMake Tools extension.
 * @throws An error if the extension is not found.
 */
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

/**
 * Retrieves the package.json information of the current instance of the CMake Tools extension.
 * @returns An object containing the name, publisher, and version of the extension.
 */
export function thisExtensionPackage(): PackageJSON {
    const pkg = thisExtension().packageJSON as PackageJSON;
    return {
        name: pkg.name,
        publisher: pkg.publisher,
        version: pkg.version
    };
}

/**
 * Retrieves the localized package.json information for the current locale.
 * If the localized package.json file for the current locale does not exist,
 * it falls back to the default package.nls.json file.
 * @returns A promise that resolves to an object containing the localized strings.
 */
export async function getExtensionLocalizedPackageJson(): Promise<{[key: string]: any}> {
    let localizedFilePath: string = path.join(thisExtensionPath(), `package.nls.${getLocaleId()}.json`);
    const fileExists: boolean = await checkFileExists(localizedFilePath);
    if (!fileExists) {
        localizedFilePath = path.join(thisExtensionPath(), "package.nls.json");
    }
    const localizedStrings = fs.readFileSync(localizedFilePath, "utf8");

    // Parse the JSON. Then, some package.nls.json entries have an object with this format:
    //  { "message": <content>, "comment": [<locComments>]}
    //  To handle this, we will pull out the content of the "message" field
    const parseJSON = JSON.parse(localizedStrings);
    for (const key in parseJSON) {
        if (parseJSON[key].hasOwnProperty("message")) {
            parseJSON[key] = parseJSON[key].message;
        }
    }
    return parseJSON;
}

interface CommandPalette {
    command: string;
    when: string | null;
}

/**
 * Evaluates a context key expression in the given context.
 * @param expression The context key expression to evaluate.
 * @param context The context in which to evaluate the expression.
 * @returns True if the expression evaluates to true, false otherwise.
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

/**
 * Retrieves the active commands for the current instance of the CMake Tools extension
 * based on the provided context.
 * @param context An object representing the context in which to evaluate the commands.
 * @returns An array of active command names.
 */
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

/**
 * Retrieves the extension path of the current instance of the CMake Tools extension.
 * @returns The extension path as a string.
 */
export function thisExtensionPath(): string {
    return thisExtension().extensionPath;
}

/**
 * Removes null and undefined entries from an array.
 * @param items The input array containing items that may be null or undefined.
 * @returns A new array with all null and undefined entries removed.
 */
export function dropNulls<T>(items: (T | null | undefined)[]): T[] {
    return items.filter(item => (item !== null && item !== undefined)) as T[];
}

export enum Ordering {
    Greater,
    Equivalent,
    Less,
}

/**
 * Compares two version objects or version strings.
 * @param a The first version object or version string to compare.
 * @param b The second version object or version string to compare.
 * @returns An Ordering enum value indicating whether the first version is less than, equal to, or greater than the second version.
 */
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

/**
 * Checks if the first version is greater than the second version.
 * @param lhs The first version object or version string.
 * @param rhs The second version object or version string.
 * @returns True if the first version is greater than the second version, false otherwise.
 */
export function versionGreater(lhs: Version | string, rhs: Version | string): boolean {
    return compareVersions(lhs, rhs) === Ordering.Greater;
}

/**
 * Checks if the first version is greater than or equal to the second version.
 * @param lhs The first version object or version string.
 * @param rhs The second version object or version string.
 * @returns True if the first version is greater than or equal to the second version, false otherwise.
 */
export function versionGreaterOrEquals(lhs: Version | string, rhs: Version | string): boolean {
    const ordering = compareVersions(lhs, rhs);
    return (Ordering.Greater === ordering) || (Ordering.Equivalent === ordering);
}

/**
 * Checks if the first version is equal to the second version.
 * @param lhs The first version object or version string.
 * @param rhs The second version object or version string.
 * @returns True if the first version is equal to the second version, false otherwise.
 */
export function versionEquals(lhs: Version | string, rhs: Version | string): boolean {
    return compareVersions(lhs, rhs) === Ordering.Equivalent;
}

/**
 * Checks if the first version is less than the second version.
 * @param lhs The first version object or version string.
 * @param rhs The second version object or version string.
 * @returns True if the first version is less than the second version, false otherwise.
 */
export function versionLess(lhs: Version | string, rhs: Version | string): boolean {
    return compareVersions(lhs, rhs) === Ordering.Less;
}

/**
 * Checks if the first version is less than or equal to the second version.
 * @param lhs The first version object or version string.
 * @param rhs The second version object or version string.
 * @returns True if the first version is less than or equal to the second version, false otherwise.
 */
export function versionLessOrEquals(lhs: Version | string, rhs: Version | string): boolean {
    const ordering = compareVersions(lhs, rhs);
    return (Ordering.Less === ordering) || (Ordering.Equivalent === ordering);
}

/**
 * Compares two values by converting them to JSON strings and comparing the strings.
 * @param a The first value to compare.
 * @param b The second value to compare.
 * @returns An Ordering enum value indicating whether the first value is less than, equal to, or greater than the second value.
 */
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

/**
 * Compares two file paths after normalizing them according to the platform's case and Unicode normalization rules.
 * @param a The first file path to compare.
 * @param b The second file path to compare.
 * @returns An Ordering enum value indicating whether the first path is less than, equal to, or greater than the second path.
 */
export function platformPathCompare(a: string, b: string): Ordering {
    return compare(platformNormalizePath(a), platformNormalizePath(b));
}

/**
 * Checks if two file paths are equivalent after normalizing them according to the platform's case and Unicode normalization rules.
 * @param a The first file path to compare.
 * @param b The second file path to compare.
 * @returns True if the paths are equivalent, false otherwise.
 */
export function platformPathEquivalent(a: string, b: string): boolean {
    return platformPathCompare(a, b) === Ordering.Equivalent;
}

/**
 * Sets a context value in the VS Code context.
 * @param key The context key to set.
 * @param value The value to set for the context key.
 * @returns A Thenable that resolves when the context value has been set.
 */
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

/**
 * Compares two iterables of strings lexicographically.
 * @param a The first iterable of strings to compare.
 * @param b The second iterable of strings to compare.
 * @returns A negative number if a < b, zero if a == b, and a positive number if a > b.
 */
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

/**
 * Retrieves the locale ID from the VS Code environment configuration.
 * @returns The locale ID as a string.
 */
export function getLocaleId(): string {
    if (typeof (process.env.VSCODE_NLS_CONFIG) === "string") {
        const vscodeNlsConfigJson: any = JSON.parse(process.env.VSCODE_NLS_CONFIG);
        if (typeof (vscodeNlsConfigJson.locale) === "string") {
            return vscodeNlsConfigJson.locale;
        }
    }
    return "en";
}

/**
 * Checks if a file exists at the specified path.
 * @param filePath The path to the file.
 * @returns A promise that resolves to true if the file exists, false otherwise.
 */
export function checkFileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, _reject) => {
        fs.stat(filePath, (_err, stats) => {
            resolve(stats && stats.isFile());
        });
    });
}

/**
 * Checks if a file exists at the specified path synchronously.
 * @param filePath The path to the file.
 * @returns True if the file exists, false otherwise.
 */
export function checkFileExistsSync(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch (e) {
    }
    return false;
}

/**
 * Checks if a directory exists at the specified path.
 * @param filePath The path to the directory.
 * @returns A promise that resolves to true if the directory exists, false otherwise.
 */
export function checkDirectoryExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, _reject) => {
        fs.stat(filePath, (_err, stats) => {
            resolve(stats && stats.isDirectory());
        });
    });
}

/**
 * Checks if a directory exists at the specified path synchronously.
 * @param dirPath The path to the directory.
 * @returns True if the directory exists, false otherwise.
 */
export function checkDirectoryExistsSync(dirPath: string): boolean {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch (e) {
    }
    return false;
}

/**
 * Creates a directory if it does not exist synchronously.
 * @param dirPath The path to the directory.
 */
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

/**
 * Reads the files in a directory.
 * @param dirPath The path to the directory.
 * @returns A promise that resolves to an array of file names in the directory.
 */
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

/**
 * Gets the file system statistics for a given path using an async function.
 * @param filePath The path to the file or directory.
 * @returns A promise that resolves to the file system statistics, or undefined if an error occurs.
 */
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

/**
 * Disposes all disposables in the given iterable.
 * @param disp An iterable of vscode.Disposable objects.
 */
export function disposeAll(disp: Iterable<vscode.Disposable>) {
    for (const d of disp) {
        d.dispose();
    }
}

/**
 * Reports progress with a given message.
 * @param message The progress message to report.
 * @param progress An optional ProgressHandle to report the progress to.
 */
export function reportProgress(message: string, progress?: ProgressHandle) {
    if (progress) {
        progress.report({ message });
    }
}

/**
 * Sets up a chokidar watcher to listen for any file changes (add, change, unlink).
 * @param watcher The chokidar FSWatcher instance.
 * @param listener The listener function to call on file changes.
 * @returns The chokidar FSWatcher instance with the listener attached.
 */
export function chokidarOnAnyChange(watcher: chokidar.FSWatcher, listener: (path: string, stats?: fs.Stats | undefined) => void) {
    return watcher.on('add', listener)
        .on('change', listener)
        .on('unlink', listener);
}

/**
 * Checks if the given value is a string.
 * @param x The value to check.
 * @returns True if the value is a string, false otherwise.
 */
export function isString(x: any): x is string {
    return Object.prototype.toString.call(x) === "[object String]";
}

/**
 * Checks if the given value is a boolean.
 * @param x The value to check.
 * @returns True if the value is a boolean, false otherwise.
 */
export function isBoolean(x: any): x is boolean {
    return x === true || x === false;
}

/**
 * Creates a SHA-256 hash of the given string.
 * @param str The string to hash.
 * @returns The SHA-256 hash of the string.
 */
export function makeHashString(str: string): string {
    if (process.platform === 'win32') {
        str = normalizePath(str, {normCase: 'always'});
    }
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(str);
    return hash.digest('hex');
}

/**
 * Checks if the given value is an array.
 * @param x The value to check.
 * @returns True if the value is an array, false otherwise.
 */
export function isArray<T>(x: any): x is T[] {
    return x instanceof Array;
}

/**
 * Checks if the given value is an array of strings.
 * @param x The value to check.
 * @returns True if the value is an array of strings, false otherwise.
 */
export function isArrayOfString(x: any): x is string[] {
    return isArray(x) && x.every(isString);
}

/**
 * Checks if the given value is null or undefined.
 * @param x The value to check.
 * @returns True if the value is null or undefined, false otherwise.
 */
export function isNullOrUndefined(x?: any): x is null | undefined {
    return (x === null || x === undefined);
}

/**
 * Checks if the given value is a vscode.WorkspaceFolder.
 * @param x The value to check.
 * @returns True if the value is a vscode.WorkspaceFolder, false otherwise.
 */
export function isWorkspaceFolder(x?: any): x is vscode.WorkspaceFolder {
    return 'uri' in x && 'name' in x && 'index' in x;
}

/**
 * Normalizes and verifies the source directory path.
 * Expands the source directory path using the provided expansion options,
 * normalizes the path, and checks if it exists.
 * @param sourceDir The source directory path to normalize and verify.
 * @param expansionOpts The options for expanding the source directory path.
 * @returns A promise that resolves to the normalized source directory path.
 */
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

/**
 * Returns true if the extension is currently running tests.
 * @returns True if the extension is in test mode, false otherwise.
 */
export function isTestMode(): boolean {
    return process.env['CMT_TESTING'] === '1';
}

/**
 * Returns true if the test explorer should be enabled even when in test mode.
 * @returns True if the test explorer should be enabled in test mode, false otherwise.
 */
export function overrideTestModeForTestExplorer(): boolean {
    return process.env['CMT_TESTING_OVERRIDE_TEST_EXPLORER'] === '1';
}

/**
 * Retrieves all paths to CMakeLists.txt files within the specified directory.
 * @param path The directory path to search for CMakeLists.txt files.
 * @returns A promise that resolves to an array of paths to CMakeLists.txt files, or undefined if none are found.
 */
export async function getAllCMakeListsPaths(path: string): Promise<string[] | undefined> {
    const regex: RegExp = new RegExp(/(\/|\\)CMakeLists\.txt$/);
    return recGetAllFilePaths(path, regex, await readDir(path), []);
}

/**
 * Recursively retrieves all file paths that match the specified regex within the given directory.
 * @param dir The directory to search.
 * @param regex The regular expression to match file paths.
 * @param files The list of files in the current directory.
 * @param result The accumulated list of matching file paths.
 * @returns A promise that resolves to an array of matching file paths.
 */
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

/**
 * Gets the relative path of a file from a given directory.
 * @param file The file path to get the relative path for.
 * @param dir The directory path to get the relative path from.
 * @returns The relative path of the file from the directory.
 */
export function getRelativePath(file: string, dir: string): string {
    const fullPathDir: string = path.parse(file).dir;
    const relPathDir: string = lightNormalizePath(path.relative(dir, fullPathDir));
    const joinedPath = "${workspaceFolder}/".concat(relPathDir);
    return joinedPath;
}

/**
 * Checks if the given compiler name is a supported compiler.
 * Supported compilers include cl, clang, clang-cl, clang-cpp, and clang++.
 * @param compilerName The name of the compiler to check.
 * @returns The normalized compiler name if it is supported, undefined otherwise.
 */
export function isSupportedCompiler(compilerName: string | undefined): string | undefined {
    return (compilerName === 'cl' || compilerName === 'cl.exe') ? 'cl' :
        (compilerName === 'clang' || compilerName === 'clang.exe') ? 'clang' :
            (compilerName === 'clang-cl' || compilerName === 'clang-cl.exe') ? 'clang-cl' :
                (compilerName === 'clang-cpp' || compilerName === 'clang-cpp.exe') ? 'clang-cpp' :
                    (compilerName === 'clang++' || compilerName === 'clang++.exe') ? 'clang++' :
                        undefined;
}

/**
 * Gets the name of the host system.
 * @returns A promise that resolves to the name of the host system.
 */
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

/**
 * Memoizes the result of a function, caching the result for future calls.
 * @param fn The function to memoize.
 * @returns A memoized version of the function.
 */
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

/**
 * Memoized version of getHostSystemName.
 */
export const getHostSystemNameMemo = memoize(getHostSystemName);

/**
 * Gets the file path of an extension file.
 * @param extensionfile The name of the extension file.
 * @returns The resolved file path of the extension file.
 */
export function getExtensionFilePath(extensionfile: string): string {
    return path.resolve(thisExtensionPath(), extensionfile);
}

/**
 * Gets the target population for CMake Tools.
 * Determines if the extension is an insiders version, release version, or internal build.
 * @returns The target population for CMake Tools.
 */
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
 * Schedules a task to be run at some future time. This allows other pending tasks to
 * execute ahead of the scheduled task and provides a form of async behavior for TypeScript.
 * @param task The task to schedule.
 * @returns A promise that resolves to the result of the task.
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
 * Schedules an asynchronous task to be run at some future time.
 * This allows other pending tasks to execute ahead of the scheduled task.
 * @param task The asynchronous task to schedule.
 * @returns A promise that resolves to the result of the task.
 */
export async function scheduleAsyncTask<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        setImmediate(() => {
            void task().then(resolve).catch(reject);
        });
    });
}

/**
 * Checks if a file is inside a specified folder.
 * @param uri The URI of the file to check.
 * @param folderPath The path of the folder to check against.
 * @returns True if the file is inside the folder, false otherwise.
 */
export function isFileInsideFolder(uri: vscode.Uri, folderPath: string): boolean {
    const parent = platformNormalizePath(folderPath);
    const file = platformNormalizePath(uri.fsPath);

    // Ensure project path ends with a path separator to avoid partial matches
    const parentWithEndingSeparator = parent.endsWith(path.posix.sep)
        ? parent
        : `${parent}${path.posix.sep}`;

    return file.startsWith(parentWithEndingSeparator);
}

/**
 * Asserts that the given value has no valid type. Useful for exhaustiveness checks.
 * @param value The value to be checked.
 */
export function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${value}`);
}

/**
 * Gets the architecture of the host system.
 * @returns The architecture of the host system.
 */
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

/**
 * Runs a vscode command by forwarding it to the real command.
 * @param key The key of the command to run.
 * @param args The arguments to pass to the command.
 * @returns A Thenable that resolves when the command has been executed.
 */
export function runCommand(key: keyof ExtensionManager, ...args: any[]) {
    return vscode.commands.executeCommand(`cmake.${key}`, ...args);
}

/**
 * Searches for a file with the specified name within a given directory and depth.
 * @param fileName The name of the file to search for.
 * @param depth The maximum depth to search within the directory.
 * @param cwd The current working directory to start the search from.
 * @returns A promise that resolves to true if the file is found, false otherwise.
 */
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

/**
 * Wrapper function for the glob module to search for files matching a pattern.
 * @param globPattern The glob pattern to search for.
 * @param cwd The current working directory to start the search from.
 * @returns A promise that resolves to true if files matching the pattern are found, false otherwise.
 */
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

/**
 * Creates a combined cancellation token from multiple tokens.
 * @param tokens The cancellation tokens to combine.
 * @returns A new cancellation token that is canceled (and disposed) when any of the combined tokens are canceled.
 */
export function createCombinedCancellationToken(...tokens: (vscode.CancellationToken | undefined)[]): vscode.CancellationToken {
    const combinedSource = new vscode.CancellationTokenSource();

    const disposables: vscode.Disposable[] = [];

    for (const token of tokens) {
        if (token !== undefined) {
            if (token.isCancellationRequested) {
                combinedSource.cancel();
                break;
            }
            disposables.push(token.onCancellationRequested(() => combinedSource.cancel()));
        }
    }

    // add the combined token to the disposables, we should dispose our source when our token is cancelled.
    disposables.push(combinedSource);

    combinedSource.token.onCancellationRequested(() => {
        // Defer disposal to allow all listeners to be notified first
        setImmediate(() => {
            disposables.forEach(d => {
                d.dispose();
            });
        });
    });

    return combinedSource.token;
}
