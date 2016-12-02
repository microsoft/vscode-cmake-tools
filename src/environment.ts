import * as path from 'path';
import * as proc from 'child_process';
import * as fs from 'fs';

import * as vscode from 'vscode';

import * as async from './async'
import {util} from './util';

type Maybe<T> = util.Maybe<T>;

export interface PotentialEnvironment {
  name: string;
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
async function tryCreateVCEnvironment(dist: VSDistribution, arch: string): Promise<PotentialEnvironment> {
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
    .reduce<Map<string, string>>(
      (acc, line) => {
        const mat = /(\w+) := ?(.*)/.exec(line);
        console.assert(!!mat, line);
        acc.set(mat![1], mat![2]);
        return acc;
      },
      new Map()
    );
  return {name, mutex, variables};
}

const ENVIRONMENTS: EnvironmentProvider[] = [{

  getEnvironments(): Promise<Environment>[] {
    if (process.platform !== 'win32') {
      return [];
    }
    const dists: VSDistribution[] = [{
      name: 'Visual C++ 12.0',
      variable: 'VS120COMNTOOLS',
    }, {
      name: 'Visual C++ 14.0',
      variable: 'VS140COMNTOOLS',
    }];
    const archs = ['x86', 'amd64', 'amd64_arm'];
    type PEnv = Promise<Maybe<Environment>>;
    const prom_environments =
      dists.reduce<PEnv[]>(
        (acc, dist) => {
          return acc.concat(archs.reduce<PEnv[]>(
            (acc, arch) => {
              const maybe_env = tryCreateVCEnvironment(dist, arch);
              acc.push(maybe_env);
              return acc;
            },
            []
          ));
        },
        []
      );
    return prom_environments;
  }
}];

export function availableEnvironments(): Promise<PotentialEnvironment>[] {
  return ENVIRONMENTS.reduce<Promise<PotentialEnvironment>[]>(
    (acc: Promise<PotentialEnvironment>[], provider: EnvironmentProvider) => {
      return acc.concat(provider.getEnvironments());
    },
    []
  );
}