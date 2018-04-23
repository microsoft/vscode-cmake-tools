/**
 * This module defines important directories and paths to the extension
 */ /** */

import * as path from 'path';
import * as which from 'which';

import config from './config';
import {fs} from './pr';

/**
 * Directory class.
 */
class Paths {
  /**
   * The current user's home directory
   */
  get userHome(): string { return process.env['HOME'] || process.env['PROFILE']!; }

  /**
   * The user-local data directory. This is where user-specific persistent
   * application data should be stored.
   */
  get userLocalDir(): string {
    if (process.platform == 'win32') {
      return process.env['AppData']!;
    } else {
      const xdg_dir = process.env['XDG_DATA_HOME'];
      if (xdg_dir) {
        return xdg_dir;
      }
      const home = this.userHome;
      return path.join(home, '.local/share');
    }
  }

  /**
   * The directory where CMake Tools should store user-specific persistent
   * data.
   */
  get dataDir(): string { return path.join(this.userLocalDir, 'CMakeTools'); }

  /**
   * Get the platform-specific temporary directory
   */
  get tmpDir(): string {
    if (process.platform == 'win32') {
      return process.env['TEMP']!;
    } else {
      return '/tmp';
    }
  }

  async which(name: string): Promise<string|null> {
    return new Promise<string|null>(resolve => {
      which(name, (err, resolved) => {
        if (err) {
          resolve(null);
        } else {
          console.assert(resolved, '`which` didn\'t do what it should have.');
          resolve(resolved!);
        }
      });
    });
  }

  get cmakePath(): Promise<string> { return this._getCMakePath(); }
  get ctestPath(): Promise<string> { return this._getCTestPath(); }

  private async _getCTestPath(): Promise<string> {
    const ctest_path = config.raw_ctestPath;
    if (!ctest_path || ctest_path == 'auto') {
      const cmake = await this.cmakePath;
      return path.join(path.dirname(cmake), 'ctest');
    } else {
      return ctest_path;
    }
  }

  private async _getCMakePath(): Promise<string> {
    const raw = config.raw_cmakePath;
    if (raw == 'auto' || raw == 'cmake') {
      // We start by searching $PATH for cmake
      const on_path = await this.which('cmake');
      if (!on_path) {
        if (raw == 'auto' || raw == 'cmake') {
          // We didn't find it on the $PATH. Try some good guesses
          const candidates = [
            `C:\\Program Files\\CMake\\bin\\cmake.exe`,
            `C:\\Program Files (x86)\\CMake\\bin\\cmake.exe`,
          ];
          for (const cand of candidates) {
            if (await fs.exists(cand)) {
              return cand;
            }
          }
        }
        // We've got nothing...
        throw new Error('No CMake found on $PATH');
      }
      return on_path;
    }
    return raw;
  }
}

const paths = new Paths();
export default paths;
