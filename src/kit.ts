import * as vscode from 'vscode';
import * as path from 'path';

import * as proc from './proc';
import * as dirs from './dirs';

import {fs} from './pr';

export interface BaseKit { name: string; }

export interface CompilerKit extends BaseKit {
  type: 'compilerKit';
  compilers: {[lang: string] : string}
}

export interface VSKit extends BaseKit {
  type: 'vsKit';
  visualStudio: string;
  visualStudioArchitecture: string;
}

export interface ToolchainKit extends BaseKit {
  type: 'toolchainKit';
  toolchainFile: string;
}

type Kit = CompilerKit | VSKit | ToolchainKit;

async function _testIfCompiler(bin: string):
    Promise<Kit | null> {
      const fname = path.basename(bin);
      const gcc_regex = /^gcc(-\d+(\.\d+(\.\d+)?)?)?$/;
      const clang_regex = /^clang(-\d+(\.\d+(\.\d+)?)?)?$/;
      const gcc_res = gcc_regex.exec(fname);
      const clang_res = clang_regex.exec(fname);
      if (gcc_res) {
        const exec = await proc.execute(bin, [ '-v' ]);
        if (exec.retc != 0) {
          return null;
        }
        const last_line = exec.stderr.trim().split('\n').reverse()[0];
        const version_re = /^gcc version (.*?) .*/;
        const version_match = version_re.exec(last_line);
        if (version_match === null) {
          return null;
        }
        const version = version_match[1];
        const gxx_fname = fname.replace(/^gcc/, 'g++');
        const gxx_bin = path.join(path.dirname(bin), gxx_fname);
        const name = `GCC ${version}`;
        if (await fs.exists(gxx_bin)) {
          return {
            type : 'compilerKit',
            name : name,
            compilers : {
              'CXX' : gxx_bin,
              'CC' : bin,
            }
          };
        } else {
          return {
            type : 'compilerKit',
            name : name,
            compilers : {
              'CC' : bin,
            }
          };
        }
      } else if (clang_res) {
        const exec = await proc.execute(bin, [ '-v' ]);
        if (exec.retc != 0) {
          return null;
        }
        const first_line = exec.stderr.split('\n')[0];
        const version_re = /^clang version (.*?)-/;
        const version_match = version_re.exec(first_line);
        if (version_match === null) {
          return null;
        }
        const version = version_match[1];
        const clangxx_fname = fname.replace(/^clang/, 'clang++');
        const clangxx_bin = path.join(path.dirname(bin), clangxx_fname);
        const name = `Clang ${version}`;
        if (await fs.exists(clangxx_bin)) {
          return {
            type : 'compilerKit',
            name : name,
            compilers : {
              'CC' : bin,
              'CXX' : clangxx_bin,
            },
          };
        } else {
          return {
            type : 'compilerKit',
            name : name,
            compilers : {
              'CC' : bin,
            },
          };
        }
      } else {
        return null;
      }
    }

async function _scanDirForKits(dir: string) {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      console.log('Skipping scan of non-directory', dir);
      return [];
    }
  } catch (e) {
    if (e.code == 'ENOENT') {
      return [];
    }
    throw e;
  }
  const bins = (await fs.readdir(dir)).map(f => path.join(dir, f));
  const prs = bins.map(async(bin) => {
    try {
      return await _testIfCompiler(bin)
    } catch (e) {
      if (e.code == 'EACCES') {
        return null;
      }
      throw e;
    }
  });
  const maybe_kits = await Promise.all(prs);
  return maybe_kits.filter(k => k !== null) as Kit[];
}

async function
scanForKits() {
  const pathvar = process.env['PATH'] !;
  const sep = process.platform === 'win32' ? ';' : ':';
  const paths = pathvar.split(sep);
  const prs = paths.map(path => _scanDirForKits(path));
  const arrays = await Promise.all(prs);
  const kits = ([] as Kit[]).concat(...arrays);
  kits.map(k => console.log(`Found kit ${k.name}`));
  return kits;
}

export class KitManager implements vscode.Disposable {
  private _kits = [] as Kit[];
  private _kitsWatcher = vscode.workspace.createFileSystemWatcher(this._kitsPath);

  private _kitsChangedEmitter = new vscode.EventEmitter<Kit[]>();
  readonly onKitsChanged = this._kitsChangedEmitter.event;

  constructor(readonly extensionContext: vscode.ExtensionContext) {
    this._kitsWatcher.onDidChange(_e => this._rereadKits());
  }

  dispose() {
    this._kitsWatcher.dispose();
    this._kitsChangedEmitter.dispose();
  }

  private get _kitsPath(): string { return path.join(dirs.dataDir(), 'cmake-kits.json'); }

  async rescanForKits() {
    // clang-format off
    const old_kits_by_name = this._kits.reduce(
      (acc, kit) => Object.assign({}, acc, {[kit.name]: kit}),
      {} as{[kit: string]: Kit}
    );
    const discovered_kits = await scanForKits();
    const new_kits_by_name = discovered_kits.reduce(
      (acc, new_kit) => {
        acc[new_kit.name] = new_kit;
        return acc;
      },
      old_kits_by_name
    );
    // clang-format on

    const new_kits = Object.keys(new_kits_by_name).map(k => new_kits_by_name[k]);

    await fs.mkdir_p(path.dirname(this._kitsPath));
    const stripped_kits = new_kits.map((k: any) => {
      k.type = undefined;
      return k;
    });
    const sorted_kits = stripped_kits.sort((a, b) => {
      if (a.name == b.name) {
        return 0;
      } else if (a.name < b.name) {
        return -1;
      } else {
        return 1;
      }
    });
    await fs.writeFile(this._kitsPath, JSON.stringify(sorted_kits, null, 2));
  }

  private async _rereadKits() {
    const content_str = await fs.readFile(this._kitsPath);
    const content = JSON.parse(content_str.toLocaleString()) as object[];
    this._kits = content.map((item_): Kit => {
      if ('compilers' in item_) {
        const item = item_ as {
          name: string;
          compilers: {[lang: string] : string};
        };
        return {
          type : 'compilerKit',
          name : item.name,
          compilers : item['compilers'],
        };
      } else if ('toolchainFile' in item_) {
        const item = item_ as {
          name: string;
          toolchainFile: string;
        };
        return {
          type : 'toolchainKit',
          name : item.name,
          toolchainFile : item.toolchainFile,
        };
      } else if ('visualStudio' in item_) {
        const item = item_ as {
          name: string;
          visualStudio: string;
          visualStudioArchitecture: string;
        };
        return {
          type : 'vsKit',
          name : item.name,
          visualStudio : item.visualStudio,
          visualStudioArchitecture : item.visualStudioArchitecture,
        };
      } else {
        vscode.window.showErrorMessage(
            'Your cmake-kits.json file contains one or more invalid entries.');
        throw new Error('Invalid kits');
      }
    });
    this._kitsChangedEmitter.fire(this._kits);
  }

  async initialize() {
    if (await fs.exists(this._kitsPath)) {
      await this._rereadKits();
    } else {
      await this.rescanForKits();
      interface DoOpen extends vscode.MessageItem {
        doOpen: boolean;
      }
      const item = await vscode.window.showInformationMessage<DoOpen>(
          'CMake Tools has scanned for available kits and saved them to a file. Would you like to edit the Kits file?',
          {},
          {title : "Yes", doOpen : true},
          {title : "No", isCloseAffordance : true, doOpen : false});
      if (item === undefined) {
        return;
      }
      if (item.doOpen) {
        this.openKitsEditor();
      }
    }
  }

  async openKitsEditor() {
    const text = await vscode.workspace.openTextDocument(this._kitsPath);
    return vscode.window.showTextDocument(text);
  }
}