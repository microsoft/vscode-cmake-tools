/**
 * This module defines important directories and paths to the extension
 */ /** */

import {DirectoryContext} from '@cmt/workspace';
import * as path from 'path';
import * as which from 'which';

import {expandString} from './expand';
import {fs} from './pr';

/**
 * Directory class.
 */
class Paths {
  /**
   * The current user's home directory
   */
  get userHome(): string {
    if (process.platform === 'win32') {
      return path.join(process.env['HOMEDRIVE'] || 'C:', process.env['HOMEPATH'] || 'Users\\Public');
    } else {
      return process.env['HOME'] || process.env['PROFILE']!;
    }
  }

  /**
   * The user-local data directory. This is where user-specific persistent
   * application data should be stored.
   */
  get userLocalDir(): string {
    if (process.platform == 'win32') {
      return process.env['LocalAppData']!;
    } else {
      const xdg_dir = process.env['XDG_DATA_HOME'];
      if (xdg_dir) {
        return xdg_dir;
      }
      const home = this.userHome;
      return path.join(home, '.local/share');
    }
  }

  get userRoamingDir(): string {
    if (process.platform == 'win32') {
      return process.env['AppData']!;
    } else {
      const xdg_dir = process.env['XDG_CONFIG_HOME'];
      if (xdg_dir) {
        return xdg_dir;
      }
      const home = this.userHome;
      return path.join(home, '.config');
    }
  }

  /**
   * The directory where CMake Tools should store user-specific persistent
   * data.
   */
  get dataDir(): string { return path.join(this.userLocalDir, 'CMakeTools'); }

  /**
   * The "roaming" directory where CMake Tools stores roaming configuration
   * data.
   */
  get roamingDataDir(): string { return path.join(this.userRoamingDir, 'CMakeTools'); }

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

  async getCTestPath(wsc: DirectoryContext): Promise<string|null> {
    const ctest_path = wsc.config.raw_ctestPath;
    if (!ctest_path || ctest_path == 'auto') {
      const cmake = await this.getCMakePath(wsc);
      if (cmake === null) {
        return null;
      } else {
        const ctest_sibling = path.join(path.dirname(cmake), 'ctest');
        // Check if CTest is a sibling executable in the same directory
        if (await fs.exists(ctest_sibling)) {
          const stat = await fs.stat(ctest_sibling);
          if (stat.isFile() && stat.mode & 0b001001001) {
            return ctest_sibling;
          } else {
            return 'ctest';
          }
        } else {
          // The best we can do.
          return 'ctest';
        }
      }
    } else {
      return ctest_path;
    }
  }

  async getCMakePath(wsc: DirectoryContext): Promise<string|null> {
    // TODO?
    const raw = await expandString(wsc.config.raw_cmakePath, {
      vars: {
        workspaceRoot: wsc.folder.uri.fsPath,
        workspaceFolder: wsc.folder.uri.fsPath,
        userHome: this.userHome,
        buildKit: '',
        buildType: '',
        generator: '',
        workspaceRootFolderName: path.basename(wsc.folder.uri.fsPath),
      },
    });
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
        return null;
      }
      return on_path;
    }
    return raw;
  }
}

const paths = new Paths();
export default paths;
