/**
 * This module promise-ifies some NodeJS APIs that are frequently used in this
 * ext.
 */ /** */

import promisify_ = require('es6-promisify');
import * as util from 'util';
// VSCode doesn't ship with util.promisify yet, but we do have type definitions for it, so we'll
// hack those type definitions onto the type of es6-promisify >:)
const promisify = promisify_ as typeof util.promisify;

import * as fs_ from 'fs';
import * as path from 'path';

import * as rimraf from 'rimraf';

/**
 * Wrappers for the `fs` module.
 *
 * Also has a few utility functions
 */
export namespace fs {

  export function exists(fspath: string): Promise<boolean> {
    return new Promise<boolean>((resolve, _reject) => {
      fs_.exists(fspath, res => resolve(res));
    })
  }

  export const readFile = promisify(fs_.readFile);

  export const writeFile = promisify(fs_.writeFile);

  export const readdir = promisify(fs_.readdir);

  export const mkdir = promisify(fs_.mkdir);

  export const mkdtemp = promisify(fs_.mkdtemp);

  export const rename = promisify(fs_.rename);

  export const stat = promisify(fs_.stat);

  export const readlink = promisify(fs_.readlink);

  export const unlink = promisify(fs_.unlink);

  export const appendFile = promisify(fs_.appendFile);

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
        throw new Error("Cannot create ${fspath}: ${parent} is a non-directory");
      }
    }
    if (!await exists(fspath)) {
      await mkdir(fspath);
    } else {
      if (!(await stat(fspath)).isDirectory()) {
        throw new Error("Cannot mkdir_p on ${fspath}. It exists, and is not a directory!");
      }
    }
  }

  /**
   * Copy a file from one location to another.
   * @param inpath The input file
   * @param outpath The output file
   */
  export function copyFile(inpath: string, outpath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const reader = fs_.createReadStream(inpath);
      reader.on('error', e => reject(e));
      reader.on('open', _fd => {
        const writer = fs_.createWriteStream(outpath);
        writer.on('error', e => reject(e));
        writer.on('open', _fd => {
          reader.pipe(writer);
        });
        writer.on('close', () => resolve());
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