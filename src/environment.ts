import * as proc from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as async from './async'
import {config} from './config';
import * as util from './util';
import { log } from './logging';

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

interface VSWhereItem {
  displayName: string;
  installationPath: string;
}

interface EnvironmentProvider {
  getEnvironments(): Promise<Promise<PotentialEnvironment>[]>;
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

async function collectDevBatVars(devbat: string, args: string[]): Promise<Map<string, string>|undefined> {
  const bat = [
    `@echo off`,
    `call "${devbat}" ${args.join(" ")}`,
    `if NOT ERRORLEVEL 0 exit 1`,
  ];
  for (const envvar of MSVC_ENVIRONMENT_VARIABLES) {
    bat.push(`echo ${envvar} := %${envvar}%`);
  }
  const fname = Math.random().toString() + '.bat';
  const batpath = path.join(vscode.workspace.rootPath!, '.vscode', fname);
  await util.ensureDirectory(path.dirname(batpath));
  await util.writeFile(batpath, bat.join('\r\n'));
  const res = await async.execute(batpath, [], {shell: true});
  fs.unlink(batpath, err => {
    if (err) {
      console.error(`Error removing temporary batch file!`, err);
    }
  });
  const output = res.stdout;
  if (output.includes("Invalid host architecture")) {
    return;
  }
  if (!output) {
    console.log(`Environment detection for using ${devbat} failed`);
    return;
  }
  const vars = output.split('\n')
              .map(l => l.trim())
              .filter(l => l.length !== 0)
              .reduce<Map<string, string>>((acc, line) => {
                const mat = /(\w+) := ?(.*)/.exec(line);
                console.assert(!!mat, line);
                acc.set(mat![1], mat![2]);
                return acc;
              }, new Map());
  return vars;
}

async function tryCreateNewVCEnvironment(where: VSWhereItem, arch: string): Promise<PotentialEnvironment> {
  const name = where.displayName + ' - ' + arch;
  const mutex = 'msvc';
  const common_dir = path.join(where.installationPath, 'Common7', 'Tools');
  const devbat = path.join(common_dir, 'VsDevCmd.bat');
  log.verbose('Detecting environment: ' + name);
  return {
    name: name,
    mutex: mutex,
    variables: await collectDevBatVars(devbat, ['-no_logo', `-arch=${arch}`])
  };
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
      return {
        name,
        mutex,
        variables: await collectDevBatVars(vcvarsall, [arch]),
      }
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
  async getEnvironments(): Promise<Promise<Environment>[]> {
    if (process.platform !== 'win32') {
      return [];
    };
    const dists: VSDistribution[] =
                     [
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
    // const new_vs_environments =
    return prom_vs_environments.concat(prom_mingw_environments);
  }
}, {
  async getEnvironments(): Promise<Promise<PotentialEnvironment>[]> {
    if (process.platform !== 'win32') {
      return [];
    }
    const progfiles: string |undefined = process.env['programfiles(x86)'] || process.env['programfiles'];
    if (!progfiles) {
      log.error('Unable to find Program Files directory');
      return [];
    }
    const vswhere = path.join(progfiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!await async.exists(vswhere)) {
      log.verbose('VSWhere is not installed. Not searching for VS 2017');
      return [];
    }
    const vswhere_res = await async.execute(vswhere, ['-all', '-format', 'json', '-products', '*']);
    const installs: VSWhereItem[] = JSON.parse(vswhere_res.stdout);
    type PEnv = Promise<PotentialEnvironment>;
    return installs.reduce<PEnv[]>((acc, where) =>
      ['x86', 'amd64', 'arm'].reduce<PEnv[]>((acc, arch) =>
        acc.concat([tryCreateNewVCEnvironment(where, arch)]), acc),
      []);
  }
}];

export async function availableEnvironments(): Promise<PotentialEnvironment[]> {
  const all_envs = [] as PotentialEnvironment[];
  const prs = ENVIRONMENTS.map(e => e.getEnvironments());
  const arrs = await Promise.all(prs);
  for (const arr of arrs) {
    const envs = await Promise.all(arr);
    all_envs.push(...envs);
  }
  return all_envs;
}

export class EnvironmentManager {
  /**
   * List of availalble build environments.
   */
  private _availableEnvironments = new Map<string, Environment>();
  public get availableEnvironments(): Map<string, Environment> {
    return this._availableEnvironments;
  }

  public readonly environmentsLoaded: Promise<void> = (async() => {
    console.log('Loading environments');
    const envs = await availableEnvironments();
    console.log('Environments loaded');
    for (const env of envs) {
      if (env.variables) {
        log.info(`Detected available environment "${env.name}`);
        this._availableEnvironments.set(env.name, {
          name: env.name,
          variables: env.variables,
          mutex: env.mutex,
          description: env.description,
        });
      }
    }
  })();

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
  public get currentEnvironmentVariables(): {[key: string]: string} {
    const active_env = this.activeEnvironments.reduce((acc, name) => {
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