import * as proc from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as async from './async'
import {config} from './config';
import * as util from './util';
import { log } from './logging';

type Maybe<T> = util.Maybe<T>;

export interface Generator {
  name: string;
  platform?: string;
  toolset?: string;
}

export interface Environment {
  name: string;
  description?: string;
  mutex?: string;
  variables: Map<string, string>;
  settings?: Object;
  preferredGenerator?: Generator;
}

interface VSWhereItem {
  displayName: string;
  installationPath: string;
  installationVersion: string;
}

interface EnvironmentProvider {
  getEnvironments(): Promise<Environment[]>;
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
    `call "${devbat}" ${args.join(" ")} || exit`,
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
  if (res.retc !== 0) {
    console.log(`Error running ${devbat}`, output);
    return;
  }
  if (output.includes("Invalid host architecture") || output.includes("Error in script usage")) {
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
                if (mat) {
                  acc.set(mat[1], mat[2]);
                }
                else {
                  console.error(`Error parsing environment variable: ${line}`);
                }
                return acc;
              }, new Map());
  return vars;
}

const VsArchitectures = {
  'amd64': 'x64',
  'arm': 'ARM',
  'amd64_arm': 'ARM',
};

const VsGenerators = {
  '15': 'Visual Studio 15 2017',
  'VS120COMNTOOLS': 'Visual Studio 12 2013',
  'VS140COMNTOOLS': 'Visual Studio 14 2015',
}

async function tryCreateNewVCEnvironment(where: VSWhereItem, arch: string): Promise<Environment | undefined> {
  const name = where.displayName + ' - ' + arch;
  const mutex = 'msvc';
  const common_dir = path.join(where.installationPath, 'Common7', 'Tools');
  const devbat = path.join(common_dir, 'VsDevCmd.bat');
  log.verbose('Detecting environment: ' + name);
  const variables = await collectDevBatVars(devbat, ['-no_logo', `-arch=${arch}`]);
  if (!variables)
    return;

  let env: Environment = {
    name: name,
    mutex: mutex,
    variables: variables
  };

  const version = /^(\d+)+./.exec(where.installationVersion);
  if (version) {
    const generatorName: string | undefined = VsGenerators[version[1]];
    if (generatorName) {
      env.preferredGenerator = {
        name: generatorName,
        platform: VsArchitectures[arch] as string || undefined,
      };
    }
  }

  return env;
}

// Detect Visual C++ environments
async function tryCreateVCEnvironment(dist: VSDistribution, arch: string): Promise<Environment | undefined> {
  const name = `${dist.name} - ${arch}`;
  const mutex = 'msvc';
  const common_dir: Maybe<string> = process.env[dist.variable] || null;
  if (!common_dir) {
    return;
  }
  const vcdir = path.normalize(path.join(common_dir, '../../VC'));
  const vcvarsall = path.join(vcdir, 'vcvarsall.bat');
  if (!await async.exists(vcvarsall)) {
    return;
  }

  const variables = await collectDevBatVars(vcvarsall, [arch]);
  if (!variables)
    return;

  let env: Environment = {
    name: name,
    mutex: mutex,
    variables: variables,
  };

  const generatorName: string | undefined = VsGenerators[dist.variable];
  if (generatorName) {
    env.preferredGenerator = {
      name: generatorName,
      platform: VsArchitectures[arch] as string || undefined,
    };
  }

  return env;
}


// Detect MinGW environments
async function tryCreateMinGWEnvironment(dir: string): Promise<Environment | undefined> {
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
    const ret: Environment = {
      name: `MinGW - ${dir}`,
      mutex: 'mingw',
      description: `Root at ${dir}`,
      variables: new Map<string, string>([
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
      ]),
      preferredGenerator: {
        name: 'MinGW Makefiles',
      },
    };
    return ret;
  }

  return;
}

// Detect Emscripten environment
async function tryCreateEmscriptenEnvironment(emscripten: string): Promise<Environment | undefined> {
  let cmake_toolchain = path.join(emscripten, 'cmake', 'Modules', 'Platform', 'Emscripten.cmake');
  if (await async.exists(cmake_toolchain)) {
    // read version and strip "" and newlines
    let version = fs.readFileSync(path.join(emscripten, 'emscripten-version.txt'), 'utf8');
    version = version.replace(/["\r\n]/g, '');
    log.verbose('Found Emscripten ' + version + ': ' + cmake_toolchain);
    if (process.platform === 'win32') {
      cmake_toolchain = cmake_toolchain.replace(/\\/g, path.posix.sep);
    }
    const ret: Environment = {
      name: `Emscripten - ${version}`,
      mutex: 'emscripten',
      description: `Root at ${emscripten}`,
      settings: {
        'CMAKE_TOOLCHAIN_FILE': cmake_toolchain
      },
      variables: new Map<string, string>([]),
    };
    return ret;
  }

  return;
}

const ENVIRONMENTS: EnvironmentProvider[] = [
  {
    async getEnvironments(): Promise<Environment[]> {
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
      const all_promices = dists
        .map((dist) => archs.map((arch) => tryCreateVCEnvironment(dist, arch)))
        .reduce((acc, proms) => acc.concat(proms));
      const envs = await Promise.all(all_promices);
      return <Environment[]>envs.filter((e) => !!e);
    }
  },
  {
    async getEnvironments(): Promise<Environment[]> {
      if (process.platform !== 'win32') {
        return [];
      }
      const vswhere =  path.join(util.thisExtensionPath(), 'res/vswhere.exe');
      const vswhere_res = await async.execute(vswhere, ['-all', '-format', 'json', '-products', '*', '-legacy', '-prerelease']);
      const installs: VSWhereItem[] = JSON.parse(vswhere_res.stdout);
      const archs = ['x86', 'amd64', 'arm'];
      const all_promices = installs
        .map((where) => archs.map((arch) => tryCreateNewVCEnvironment(where, arch)))
        .reduce((acc, proms) => acc.concat(proms));
      const envs = await Promise.all(all_promices);
      return <Environment[]>envs.filter((e) => !!e);
    }
  },
  {
    async getEnvironments(): Promise<Environment[]> {
      if (process.platform !== 'win32') {
        return [];
      };
      const envs = await Promise.all(config.mingwSearchDirs.map(tryCreateMinGWEnvironment));
      return <Environment[]>envs.filter((e) => !!e);
    }
  },
  {
    async getEnvironments(): Promise<Environment[]> {
      var dirs = config.emscriptenSearchDirs;
      var env_dir = process.env['EMSCRIPTEN'] as string|undefined;
      if (env_dir && dirs.indexOf(env_dir) == -1)
        dirs.push(env_dir);
      const envs = await Promise.all(dirs.map(tryCreateEmscriptenEnvironment));
      return <Environment[]>envs.filter((e) => !!e);
    }
  },
];

export async function availableEnvironments(): Promise<Environment[]> {
  const prs = ENVIRONMENTS.map(e => e.getEnvironments());
  const all_envs = await Promise.all(prs);
  return all_envs.reduce((acc, envs) => (acc.concat(envs)));
}

export class EnvironmentManager {
  /**
   * List of availalble build environments.
   */
  private _availableEnvironments = new Map<string, Environment>();
  public get availableEnvironments(): Map<string, Environment> {
    return this._availableEnvironments;
  }

  public readonly environmentsLoaded: Promise<void> = (async () => {
    console.log('Loading environments');
    const envs = await availableEnvironments();
    console.log('Environments loaded');
    for (const env of envs) {
      log.info(`Detected available environment "${env.name}`);
      this._availableEnvironments.set(env.name, env);
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
  public get currentEnvironmentVariables(): NodeJS.ProcessEnv {
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
  /**
   * @brief The current cmake settings to use when configuring,
   *    as specified by the active build environments.
   */
  public get currentEnvironmentSettings(): Object {
    const active_settings = this.activeEnvironments.reduce((acc, name) => {
      const env_ = this.availableEnvironments.get(name);
      console.assert(env_);
      const env = env_!;
      return env.settings || {};
    }, {});
    return active_settings;
  }

  public get preferredEnvironmentGenerators(): Generator[] {
    const allEnvs = this.availableEnvironments;
    return this.activeEnvironments.reduce<Generator[]>((gens, envName) => {
      const env = allEnvs.get(envName);
      if (env && env.preferredGenerator)
        gens.push(env.preferredGenerator);
      return gens;
    }, []);
  }
}
