/**
 * This module promise-ifies some NodeJS APIs that are frequently used in this
 * ext.
 */ /** */

import * as util from 'util';
const promisify = util.promisify;

import * as fs_ from 'fs';
import { walk as walk_ } from '@nodelib/fs.walk';
import * as path from 'path';

import * as rimraf from 'rimraf';
import * as nls from 'vscode-nls';
import * as pLimit from 'p-limit';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// Limits the concurrent async access to the file system to avoid errors such as "EMFILE: too many open files".
const fsAccessLimiter = pLimit(50);

// Wraps fsAccessLimiter around the PromiseLike function while preserving the original type.
function limitify<T extends (...args: any[]) => any>(fn: T): T {
    const wrapper = (...args: Parameters<T>) => fsAccessLimiter(fn, ...args) as ReturnType<T>;
    return wrapper as T;
}

/**
 * Wrappers for the `fs` module.
 *
 * Also has a few utility functions
 */
export namespace fs {

    export async function exists(filePath: string): Promise<boolean> {
        const stat = await tryStat(filePath);
        return stat !== null;
    }

    export function existsSync(filePath: string): boolean {
        return fs_.existsSync(filePath);
    }

    function stripBom(str: string) {
        if (str.charCodeAt(0) === 0xFEFF) {
            return str.slice(1);
        }
        return str;
    }

    export function readFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<any> {
        return fsAccessLimiter(() => new Promise((resolve, reject) => {
            fs_.readFile(filePath, { encoding }, (err: any, data: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stripBom(data));
                }
            });
        }));
    }

    export const constants = fs_.constants;
    export const access = promisify(fs_.access);
    export const writeFile = limitify(promisify(fs_.writeFile));
    export const readdir = promisify(fs_.readdir);
    export const mkdir = promisify(fs_.mkdir);
    export const mkdtemp = promisify(fs_.mkdtemp);
    export const rename = promisify(fs_.rename);
    export const stat = promisify(fs_.stat);
    export const walk = promisify(walk_);

    /**
     * Try and stat() a file/folder. If stat() fails for *any reason*, returns `null`.
     * @param filePath The file to try and stat()
     */
    export async function tryStat(filePath: fs_.PathLike): Promise<fs_.Stats | null> {
        try {
            return await stat(filePath);
        } catch (_e) {
            // Don't even bother with the error. Any number of things might have gone
            // wrong. Probably one of: Non-existing file, bad permissions, bad path.
            return null;
        }
    }

    export const readlink = promisify(fs_.readlink);
    export const unlink = promisify(fs_.unlink);
    export const appendFile = limitify(promisify(fs_.appendFile));

    /**
     * Creates a directory and all parent directories recursively. If the file
     * already exists, and is not a directory, just return.
     * @param fspath The directory to create
     */
    export async function mkdir_p(fspath: string): Promise<void> {
        const parent = path.dirname(fspath);
        if (!await exists(parent)) {
            await mkdir_p(parent);
        } else {
            if (!(await stat(parent)).isDirectory()) {
                throw new Error(localize('cannot.create.path', 'Cannot create {0}: {1} is a non-directory', fspath, parent));
            }
        }
        if (!await exists(fspath)) {
            await mkdir(fspath);
        } else {
            if (!(await stat(fspath)).isDirectory()) {
                throw new Error(localize('cannot.create.directory', 'Cannot create directory {0}. It exists, and is not a directory!', fspath));
            }
        }
    }

    /**
     * Copy a file from one location to another.
     * @param inpath The input file
     * @param outpath The output file
     */
    export function copyFile(inpath: string, outpath: string): Promise<void> {
        return fsAccessLimiter(() => new Promise<void>((resolve, reject) => {
            const reader = fs_.createReadStream(inpath);
            reader.on('error', e => reject(e));
            reader.on('open', _fd => {
                const writer = fs_.createWriteStream(outpath);
                writer.on('error', e => reject(e));
                writer.on('open', _fd2 => reader.pipe(writer));
                writer.on('close', () => resolve());
            });
        }));
    }

    /**
     * Create a hard link of an existing file
     * @param inPath The existing file path
     * @param outPath The new path to the hard link
     */
    export function hardLinkFile(inPath: string, outPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            fs_.link(inPath, outPath, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Remove a directory recursively. **DANGER DANGER!**
     * @param dirpath Directory to remove
     */
    export function rmdir(dirpath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            rimraf(dirpath, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}
