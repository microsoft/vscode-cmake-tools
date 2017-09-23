import * as path from 'path';

export function userHome(): string { return process.env['HOME'] || process.env['PROFILE'] !; }

export function userLocalDir(): string {
  if (process.platform == 'win32') {
    return process.env['AppData'] !;
  } else {
    const xdg_dir = process.env["XDG_DATA_HOME"];
    if (xdg_dir) {
      return xdg_dir;
    }
    const home = userHome();
    return path.join(home, '.local/share');
  }
}

export function dataDir(): string { return path.join(userLocalDir(), 'CMakeTools'); }
