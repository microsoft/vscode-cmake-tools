import * as proc from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as async from './async'
import {config} from './config';
import * as util from './util';

type Maybe<T> = util.Maybe<T>;

export interface PotentialEnvironment {
  name: string;
  description?: string;
  variables?: Map<string, string>;
  mutex?: string;
}

export interface Environment extends PotentialEnvironment {
  variables: Map<string, string>;
}

interface EnvironmentProvider {
  getEnvironments(): Promise<PotentialEnvironment>[];
  [_: string]: any;
}

const MSVC_ENVIRONMENT_VARIABLES = [
  'CL',
  '_CL_',
  'INCLUDE',
  'LIBPATH',
  'LINK',
  '_LINK_',
  'LIB',
  'PATH',
  'TMP',
  'FRAMEWORKDIR',
  'FRAMEWORKDIR64',
  'FRAMEWORKVERSION',
  'FRAMEWORKVERSION64',
  'UCRTCONTEXTROOT',
  'UCRTVERSION',
  'UNIVERSALCRTSDKDIR',
  'VCINSTALLDIR',
  'VCTARGETSPATH',
  'WINDOWSLIBPATH',
  'WINDOWSSDKDIR',
  'WINDOWSSDKLIBVERSION',
  'WINDOWSSDKVERSION',
];

interface VSDistribution {
  name: string;
  variable: string;
}

// Detect Visual C++ environments
async function tryCreateVCEnvironment(dist: VSDistribution, arch: string):
    Promise<PotentialEnvironment> {
      const name = `${dist.name} - ${arch}`;
      const mutex = 'msvc';
      const common_dir: Maybe<string> = process.env[dist.variable];
      if (!common_dir) {
        return {name, mutex};
      }
      const vcdir = path.normalize(path.join(common_dir, '../../VC'));
      const vcvarsall = path.join(vcdir, 'vcvarsall.bat');
      if (!await async.exists(vcvarsall)) {
        return {name, mutex};
      }
      const bat = [
        `@echo off`,
        `call "${vcvarsall}" ${arch}`,
        `if NOT ERRORLEVEL 0 exit 1`,
      ];
      for (const envvar of MSVC_ENVIRONMENT_VARIABLES) {
        bat.push(`echo ${envvar} := %${envvar}%`);
      }
      const fname = Math.random().toString() + '.bat';
      const batpath = path.join(vscode.workspace.rootPath, '.vscode', fname);
      await util.ensureDirectory(path.dirname(batpath));
      await util.writeFile(batpath, bat.join('\r\n'));
      const prom = new Promise<Maybe<string>>((resolve, reject) => {
        const pipe = proc.spawn(batpath, [], {shell: true});
        let stdout_acc = '';
        pipe.stdout.on('data', (data) => {
          stdout_acc += data.toString();
        });
        pipe.stdout.on('close', () => {
          resolve(stdout_acc);
        });
        pipe.on('exit', (code) => {
          fs.unlink(batpath, err => {
            if (err) {
              console.error(`Error removing temporary batch file!`, err);
            }
          });
          if (code) {
            resolve(null);
          }
        });
      });
      const output = await prom;
      if (!output) {
        console.log(`Environment detection for ${name} failed`);
        return {name, mutex};
      }
      const variables = output.split('\n')
                            .map(l => l.trim())
                            .filter(l => l.length != 0)
                            .reduce<Map<string, string>>((acc, line) => {
                              const mat = /(\w+) := ?(.*)/.exec(line);
                              console.assert(!!mat, line);
                              acc.set(mat![1], mat![2]);
                              return acc;
                            }, new Map());
      return {name, mutex, variables};
    }


// Detect MinGW environments
async function tryCreateMinGWEnvironment(dir: string):
    Promise<PotentialEnvironment> {
      const ret: PotentialEnvironment = {
        name: `MinGW - ${dir}`,
        mutex: 'mingw',
        description: `Root at ${dir}`,
      };
      function prependEnv(key: string, ...values: string[]) {
        let env_init: string = process.env[key] || '';
        return values.reduce<string>((acc, val) => {
          if (acc.length !== 0) {
            return val + ';' + acc;
          } else {
            return val;
          }
        }, env_init);
      };
      const gcc_path = path.join(dir, 'bin', 'gcc.exe');
      if (await async.exists(gcc_path)) {
        ret.variables = new Map<string, string>([
          [
            'PATH',
            prependEnv(
                'PATH', path.join(dir, 'bin'), path.join(dir, 'git', 'cmd'))
          ],
          [
            'C_INCLUDE_PATH', prependEnv(
                                  'C_INCLUDE_PATH', path.join(dir, 'include'),
                                  path.join(dir, 'include', 'freetype'))
          ],
          [
            'CXX_INCLUDE_PATH',
            prependEnv(
                'CXX_INCLUDE_PATH', path.join(dir, 'include'),
                path.join(dir, 'include', 'freetype'))
          ]
        ]);
      }

      return ret;
    }

const ENVIRONMENTS: EnvironmentProvider[] = [{

  getEnvironments(): Promise<Environment>[]{
    if (process.platform !== 'win32') {
      return [];
    };
    const dists: VSDistribution[] =
                     [
                       {
                         name: 'Visual C++ 9.0',
                         variable: 'VS90COMNTOOLS',
                       },
                       {
                         name: 'Visual C++ 10.0',
                         variable: 'VS100COMNTOOLS',
                       },
                       {
                         name: 'Visual C++ 11.0',
                         variable: 'VS110COMNTOOLS',
                       },
                       {
                         name: 'Visual C++ 12.0',
                         variable: 'VS120COMNTOOLS',
                       },
                       {
                         name: 'Visual C++ 14.0',
                         variable: 'VS140COMNTOOLS',
                       }
                     ];
    const archs = ['x86', 'amd64', 'amd64_arm'];
    type PEnv = Promise<PotentialEnvironment>;
    const prom_vs_environments = dists.reduce<PEnv[]>(
        (acc, dist) => {
          return acc.concat(archs.reduce<PEnv[]>((acc, arch) => {
            const maybe_env = tryCreateVCEnvironment(dist, arch);
            acc.push(maybe_env);
            return acc;
          }, []));
        },
        []);
    const prom_mingw_environments =
        config.mingwSearchDirs.map(tryCreateMinGWEnvironment);
    return prom_vs_environments.concat(prom_mingw_environments);
  }
}];

export function availableEnvironments(): Promise<PotentialEnvironment>[] {
  return ENVIRONMENTS.reduce<Promise<PotentialEnvironment>[]>(
      (acc: Promise<PotentialEnvironment>[], provider: EnvironmentProvider) => {
        return acc.concat(provider.getEnvironments());
      },
      []);
}

export class EnvironmentManager {
  /**
   * List of availalble build environments.
   */
  private _availableEnvironments = new Map<string, Environment>();
  public get availableEnvironments(): Map<string, Environment> {
    return this._availableEnvironments;
  }

  public readonly environmentsLoaded: Promise<void> =
      Promise.all(availableEnvironments().map(async(pr) => {
        try {
          const env = await pr;
          if (env.variables) {
            console.log(`Detected available environment "${env.name}`);
            this._availableEnvironments.set(env.name, {
              name: env.name,
              variables: env.variables,
              mutex: env.mutex,
              description: env.description,
            });
          }
        } catch (e) {
          console.error('Error detecting an environment', e);
        }
      }));

  /**
   * The environments (by name) which are currently active in the workspace
   */
  public activeEnvironments: string[] = [];
  public activateEnvironments(...names: string[]) {
    for (const name of names) {
      const env = this.availableEnvironments.get(name);
      if (!env) {
        const msg = `Invalid build environment named ${name}`;
        vscode.window.showErrorMessage(msg);
        console.error(msg);
        continue;
      }
      for (const other of this.availableEnvironments.values()) {
        if (other.mutex === env.mutex && env.mutex !== undefined) {
          const other_idx = this.activeEnvironments.indexOf(other.name);
          if (other_idx >= 0) {
            this.activeEnvironments.splice(other_idx, 1);
          }
        }
      }
      this.activeEnvironments.push(name);
    }
    this._activeEnvironmentsChangedEmitter.fire(this.activeEnvironments)
  }
  private readonly _activeEnvironmentsChangedEmitter =
      new vscode.EventEmitter<string[]>();
  public readonly onActiveEnvironmentsChanges =
      this._activeEnvironmentsChangedEmitter.event;

  public deactivateEnvironment(name: string) {
    const idx = this.activeEnvironments.indexOf(name);
    if (idx >= 0) {
      this.activeEnvironments.splice(idx, 1);
      this._activeEnvironmentsChangedEmitter.fire(this.activeEnvironments);
    } else {
      throw new Error(`Attempted to deactivate environment ${name
                      } which is not yet active!`);
    }
  }

  public async selectEnvironments(): Promise<void> {
    const entries =
        Array.from(this.availableEnvironments.entries())
            .map(([name, env]) => ({
                   name: name,
                   label: this.activeEnvironments.indexOf(name) >= 0 ?
                       `$(check) ${name}` :
                       name,
                   description: env.description || '',
                 }));
    const chosen = await vscode.window.showQuickPick(entries);
    if (!chosen) {
      return;
    }
    this.activeEnvironments.indexOf(chosen.name) >= 0 ?
        this.deactivateEnvironment(chosen.name) :
        this.activateEnvironments(chosen.name);
  }

  /**
   * @brief The current environment variables to use when executing commands,
   *    as specified by the active build environments.
   */
  public getCurrentEnvironmentVariables(key:Maybe<string>): {[key: string]: string} {
    let currentEnvironments:string[] = []
    Array.prototype.push.apply(currentEnvironments, this.activeEnvironments)
    if (key && currentEnvironments.indexOf(key) < 0) {
      currentEnvironments.push(key)
    }
    const active_env = currentEnvironments.reduce((acc, name) => {
      const env_ = this.availableEnvironments.get(name);
      console.assert(env_);
      const env = env_!;
      for (const entry of env.variables.entries()) {
        acc[entry[0]] = entry[1];
      }
      return acc;
    }, {});
    const proc_env = process.env;
    return util.mergeEnvironment(process.env, active_env);
  }
}