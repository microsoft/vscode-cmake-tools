/**
 * This module defines important directories and paths to the extension
 */ /** */

import {DirectoryContext} from '@cmt/workspace';
import * as path from 'path';
import * as which from 'which';

import {vsInstallations} from './installs/visual-studio';
import {expandString} from './expand';
import {fs} from './pr';

interface VSCMakePaths {
  cmake?: string;
  ninja?: string;
}

/**
 * Directory class.
 */
class Paths {
  private _ninjaPath?: string;

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

  get ninjaPath() {
    return this._ninjaPath;
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
    this._ninjaPath = undefined;

    const raw = await expandString(wsc.config.raw_cmakePath, {
      vars: {
        workspaceRoot: wsc.folder.uri.fsPath,
        workspaceFolder: wsc.folder.uri.fsPath,
        userHome: this.userHome,
        buildKit: '',
        buildType: '',
        generator: '',
        workspaceRootFolderName: path.basename(wsc.folder.uri.fsPath),
        workspaceFolderBasename: path.basename(wsc.folder.uri.fsPath)
      },
    });

    if (raw === 'auto' || raw === 'cmake') {
      // We start by searching $PATH for cmake
      const on_path = await this.which('cmake');
      if (on_path) {
        return on_path;
      }
      if (process.platform === 'win32') {
        // We didn't find it on the $PATH. Try some good guesses
        const default_cmake_paths = [
          `C:\\Program Files\\CMake\\bin\\cmake.exe`,
          `C:\\Program Files (x86)\\CMake\\bin\\cmake.exe`,
        ];
        for (const cmake_path of default_cmake_paths) {
          if (await fs.exists(cmake_path)) {
            return cmake_path;
          }
        }

        // Look for bundled CMake executables in Visual Studio install paths
        const bundled_tools_paths = await this.vsCMakePaths();
        if (bundled_tools_paths.cmake) {
          this._ninjaPath = bundled_tools_paths.ninja;

          return bundled_tools_paths.cmake!;
        }
      }
      return null;
    }

    return raw;
  }

  async vsCMakePaths(): Promise<VSCMakePaths> {
    const vsCMakePaths: VSCMakePaths = {};

    const vs_installations = await vsInstallations();
    if (vs_installations.length > 0) {
      const bundled_tool_paths = [] as {cmake: string, ninja: string}[];

      for (const install of vs_installations) {
        const bundled_tool_path = {
          cmake: install.installationPath + '\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe',
          ninja: install.installationPath + '\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\Ninja\\ninja.exe'
        };
        bundled_tool_paths.push(bundled_tool_path);
      }

      for (const tool_path of bundled_tool_paths) {
        if (await fs.exists(tool_path.cmake)) {
          // CMake can be still used without Ninja
          vsCMakePaths.cmake = tool_path.cmake;

          // Check for Ninja in case it was removed in later VS versions
          if (await fs.exists(tool_path.ninja)) {
            vsCMakePaths.ninja = tool_path.ninja;

            // Return the first CMake/Ninja set found
            break;
          }
        }
      }
    }

    return vsCMakePaths;
  }
}

const paths = new Paths();
export default paths;
