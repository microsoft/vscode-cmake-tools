import * as path from 'path';
import * as proc from 'child_process';
import * as fs from 'fs';

import * as vscode from 'vscode';

import * as async from './async'
import {util} from './util';

type Maybe<T> = util.Maybe<T>;

export interface Environment {
  name: string;
  variables: Maybe<Map<string, string>>;
}

interface EnvironmentProvider {
  getEnvironments(): Promise<Environment>[];
  [_: string]: any;
}

const ENVIRONMENTS: EnvironmentProvider[] = [{
  // Detect Visual C++ environments
  async tryCreateEnvironment(progfiles, dist, arch): Promise<Environment> {
    const vcvarsall = path.join(progfiles, dist, 'VC/vcvarsall.bat');
    const name = `${dist} - ${arch}`;
    if (!await async.exists(vcvarsall)) {
      return {name, variables: null};
    }
    const bat = [
      `@echo off`,
      `call "${vcvarsall}" ${arch}`,
      `if NOT ERRORLEVEL 0 exit 1`,
      `echo PATH := %PATH%`,
      `echo LIB := %LIB%`,
      `echo INCLUDE := %INCLUDE%`,
      `:end`
    ];
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
      console.log(`Environment detection for ${dist} ${arch} in ${progfiles} failed`);
      return {name, variables: null};
    }
    const vars = output.split('\n')
      .map(l => l.trim())
      .filter(l => l.length != 0)
      .reduce<Map<string, string>>(
        (acc, line) => {
          const mat = /(\w+) := (.*)/.exec(line);
          console.assert(!!mat, line);
          acc.set(mat![1], mat![2]);
          return acc;
        },
        new Map()
      );
    return {name, variables: vars};
  },

  getEnvironments(): Promise<Environment>[] {
    if (process.platform !== 'win32') {
      return [];
    }
    const progfile_dirs = [`C:\\Program Files`, `C:\\Program Files (x86)`];
    const dists = [
      'Microsoft Visual Studio 12.0',
      'Microsoft Visual Studio 14.0',
    ];
    const archs = ['x86', 'amd64'];
    type PEnv = Promise<Maybe<Environment>>;
    const prom_environments = progfile_dirs.reduce<PEnv[]>(
      (acc, progfiles) => {
        return acc.concat(dists.reduce<PEnv[]>(
          (acc, dist) => {
            return acc.concat(archs.reduce<PEnv[]>(
              (acc, arch) => {
                const maybe_env = this.tryCreateEnvironment(progfiles, dist, arch) as Promise<Maybe<Environment>>;
                acc.push(maybe_env);
                return acc;
              },
              []
            ));
          },
          []
        ));
      },
      []
    );
    return prom_environments;
  }
}];

export function availableEnvironments(): Promise<Environment>[] {
  return ENVIRONMENTS.reduce<Promise<Environment>[]>(
    (acc, provider: EnvironmentProvider) => {
      return acc.concat(provider.getEnvironments());
    },
    []
  );
}