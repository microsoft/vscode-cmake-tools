/* eslint-disable no-unused-expressions */

/**
 * Wrappers and utilities around the NodeJS `child_process` module.
 */

import * as proc from 'child_process';
import * as iconv from 'iconv-lite';

import {createLogger} from './logging';
import rollbar from './rollbar';
import * as util from './util';

import * as os from 'os';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ExecutionResult } from './api';
export { ExecutionResult } from './api';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = createLogger('proc');

/**
 * Return value for items that have progress information
 */
export interface ProgressData {
  /**
   * Minimum progress value
   */
  minimum: number;

  /**
   * Maximum progress value
   */
  maximum: number;

  /**
   * The current progress value. Should be in [minimum, maximum)
   */
  value: number;
}

/**
 * Interface for objects that can consume line-based output
 */
export interface OutputConsumer {
  /**
   * Handle a line of output
   *
   * @param line The line of output to process
   */
  output(line: string): void;

  /**
   * Handle a line of error
   *
   * @param error the line of stderr to process
   */
  error(error: string): void;
}

/**
 * Represents an executing subprocess
 */
export interface Subprocess {
  result: Promise<ExecutionResult>;
  child: proc.ChildProcess|undefined;
}

export interface BuildCommand {
  command: string;
  args?: string[];
  build_env?: EnvironmentVariables;
}

export class EnvironmentVariables {
  private env: {[key: string]: string } = {};

  /**
   * On Windows we normalize the environment variable names because they are case-insensitve and
   * can be accessed that way. To get the original casing, we create a mapping from the normalized
   * form to the original case. On linux/macOS, this mapping is not used.
   * The 'key' is the normalized form. The 'value' is the original casing. `this.env` uses the
   * original casing for its 'key's.
   */
  private keyMapping: {[key: string]: string } = {};

  static create(env?: {[key: string]: string|null}): EnvironmentVariables;
  static create(env?: {[key: string]: string|undefined}): EnvironmentVariables;
  static create(env?: {[key: string]: string|null|undefined}): EnvironmentVariables {
    const result = new EnvironmentVariables();
    result.merge(env);
    return result;
  }

  public get fullEnvironment() {
    return this.env;
  }

  public get debugConfigEnvironment() {
    return Object.entries(this.env).map(
      ([key, value]) => ({
        name: key,
        value
      })
    );
  }

  private getKey(key: string): string {
    if (os.platform() === 'win32') {
      const normalizedKey = key.toUpperCase();
      if (this.keyMapping[normalizedKey]) {
        return this.keyMapping[normalizedKey];
      } else {
        this.keyMapping[normalizedKey] = key;
      }
    }
    return key;
  }

  public get(key: string): string | undefined {
    return this.env[this.getKey(key)];
  }

  public set(key: string, value?: string|null): void {
    if (value !== undefined && value !== null) {
      this.env[this.getKey(key)] = value;
    } else {
      this.delete(key);
    }
  }

  public has(key: string): boolean {
    return this.env[this.getKey(key)] !== undefined;
  }

  public delete(key: string): void {
    delete this.env[this.getKey(key)];
  }

  public merge(...envs: (EnvironmentVariables | {[key: string]: string|null|undefined} | undefined)[]): void {
    for (const env of envs) {
      if (env === undefined) {
        continue;
      }
      if (env instanceof EnvironmentVariables) {
        Object.assign(this.env, env.env);
        Object.assign(this.keyMapping, env.keyMapping);
      } else if (os.platform() !== 'win32') {
        Object.assign(this.env, env);
        // Non-Windows OS'es do not use the keyMapping.
      } else {
        for (const key of Object.getOwnPropertyNames(env)) {
          // It is important to call `this.set` here instead of accessing `this.env` directly
          // because it will cause the key mapping to be updated.
          this.set(key, env[key]);
        }
      }
    }
  }
}

export interface ExecutionOptions {
  environment?: EnvironmentVariables;
  shell?: boolean;
  silent?: boolean;
  cwd?: string;
  encoding?: BufferEncoding;
  outputEncoding?: string;
  useTask?: boolean;
  overrideLocale?: boolean;
}

export function buildCmdStr(command: string, args?: string[]): string {
  let cmdarr = [command];
  if (args) {
    cmdarr = cmdarr.concat(args);
  }
  return cmdarr.map(a => /[ \n\r\f;\t]/.test(a) ? `"${a}"` : a).join(' ');
}

/**
 * Execute a command and return the result
 * @param command The binary to execute
 * @param args The arguments to pass to the binary
 * @param outputConsumer An output consumer for the command execution
 * @param options Additional execution options
 *
 * @note Output from the command is accumulated into a single buffer: Commands
 * which produce a lot of output should be careful about memory constraints.
 */
export function execute(command: string,
                        args?: string[],
                        outputConsumer?: OutputConsumer|null,
                        options?: ExecutionOptions): Subprocess {
  const cmdstr = buildCmdStr(command, args);
  if (options && options.silent !== true) {
    log.info(// We do simple quoting of arguments with spaces.
             // This is only shown to the user,
             // and doesn't have to be 100% correct.
             localize('executing.command', 'Executing command: {0}', cmdstr));
  }
  if (!options) {
    options = {};
  }
  const localeOverride = {
    LANG: "C",
    LC_ALL: "C"
  };
  const final_env = new EnvironmentVariables();
  final_env.merge(
    process.env,
    options.environment || {},
    options.overrideLocale ? localeOverride : {});

  const spawn_opts: proc.SpawnOptions = {
    env: final_env.fullEnvironment,
    shell: !!options.shell
  };
  if (options && options.cwd) {
    spawn_opts.cwd = options.cwd;
  }
  let child: proc.ChildProcess|undefined;
  let result: Promise<ExecutionResult>;
  const useTask = (options && options.useTask) ? options.useTask : false;
  if (useTask) {
    // child = undefined;
    // const term = vscode.window.createTerminal("Cmake Build");
    // term.show(true);
    // term.sendText(cmdstr);

    void vscode.commands.executeCommand("workbench.action.tasks.build");

    result = new Promise<ExecutionResult>((resolve) => {
      resolve({retc: 0, stdout: '', stderr: ''});
    });
  } else {
    try {
      child = proc.spawn(command, args ?? [], spawn_opts);
    } catch {
      child = undefined;
    }
    if (child === undefined) {
      return {
        child: undefined,
        result: Promise.resolve({
          retc: -1,
          stdout: "",
          stderr: ""
        })
      };
    }
    if (options.encoding) {
      child.stdout?.setEncoding(options.encoding);
    }

    const encoding = options.outputEncoding && iconv.encodingExists(options.outputEncoding) ? options.outputEncoding : 'utf8';

    result = new Promise<ExecutionResult>(resolve => {
      if (child) {
        child.on('error', err => { resolve({ retc: -1, stdout: "", stderr: err.message ?? '' }); });
        let stdout_acc = '';
        let line_acc = '';
        let stderr_acc = '';
        let stderr_line_acc = '';
        child.stdout?.on('data', (data: Uint8Array) => {
          rollbar.invoke(localize('processing.data.event.stdout', 'Processing "data" event from proc stdout'), {data, command, args}, () => {
            const str = iconv.decode(Buffer.from(data), encoding);
            const lines = str.split('\n').map(l => l.endsWith('\r') ? l.substr(0, l.length - 1) : l);
            while (lines.length > 1) {
              line_acc += lines[0];
              if (outputConsumer) {
                outputConsumer.output(line_acc);
              }
              line_acc = '';
              // Erase the first line from the list
              lines.splice(0, 1);
            }
            console.assert(lines.length, 'Invalid lines', JSON.stringify(lines));
            line_acc += lines[0];
            stdout_acc += str;
          });
        });
        child.stderr?.on('data', (data: Uint8Array) => {
          rollbar.invoke(localize('processing.data.event.stderr', 'Processing "data" event from proc stderr'), {data, command, args}, () => {
            const str = iconv.decode(Buffer.from(data), encoding);
            const lines = str.split('\n').map(l => l.endsWith('\r') ? l.substr(0, l.length - 1) : l);
            while (lines.length > 1) {
              stderr_line_acc += lines[0];
              if (outputConsumer) {
                outputConsumer.error(stderr_line_acc);
              }
              stderr_line_acc = '';
              // Erase the first line from the list
              lines.splice(0, 1);
            }
            console.assert(lines.length, 'Invalid lines', JSON.stringify(lines));
            stderr_line_acc += lines[0];
            stderr_acc += str;
          });
        });
        // Don't stop until the child stream is closed, otherwise we might not read
        // the whole output of the command.
        child.on('close', retc => {
          try {
            rollbar.invoke(localize('resolving.close.event', 'Resolving process on "close" event'), {line_acc, stderr_line_acc, command, retc}, () => {
              if (line_acc && outputConsumer) {
                outputConsumer.output(line_acc);
              }
              if (stderr_line_acc && outputConsumer) {
                outputConsumer.error(stderr_line_acc);
              }
              resolve({retc, stdout: stdout_acc, stderr: stderr_acc});
            });
          } catch (_) {
            // No error handling since Rollbar has taken the error.
            resolve({retc, stdout: stdout_acc, stderr: stderr_acc});
          }
        });
      }
    });
  }
  return {child, result};
}
