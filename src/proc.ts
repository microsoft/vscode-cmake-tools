/**
 * Wrappers and utilities around the NodeJS `child_process` module.
 */ /** */

import * as proc from 'child_process';

// import {ExecutionResult} from './api';

export interface ExecutionResult {
  retc: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a command and return the result
 * @param command The binary to execute
 * @param args The arguments to pass to the binary
 * @param options Additional execution options
 *
 * @note Output from the command is accumulated into a single buffer: Commands
 * which produce a lot of output should be careful about memory constraints.
 */
export function execute(command: string, args: string[], options?: proc.SpawnOptions):
    Promise<ExecutionResult> {
  return new Promise<ExecutionResult>((resolve, reject) => {
    const child = proc.spawn(command, args, options);
    child.on('error', (err) => { reject(err); });
    let stdout_acc = '';
    let stderr_acc = '';
    child.stdout.on('data', (data: Uint8Array) => { stdout_acc += data.toLocaleString(); });
    child.stderr.on('data', (data: Uint8Array) => { stderr_acc += data.toLocaleString(); });
    // Don't stop until the child stream is closed, otherwise we might not read
    // the whole output of the command.
    child.on('close',
             (retc) => { resolve({retc : retc, stdout : stdout_acc, stderr : stderr_acc}); });
  });
}
