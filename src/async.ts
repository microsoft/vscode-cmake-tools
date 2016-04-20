'use strict';

import * as proc from 'child_process';
import * as fs from 'fs';

export function doAsync<T>(fn: Function, ...args): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        fn(...args, resolve);
    });
}

export function exists(filepath: string): Promise<boolean> {
    return doAsync<Boolean>(fs.exists, filepath);
}

export function unlink(filepath: string): Promise<void> {
    return doAsync<void>(fs.unlink, filepath);
}

export function readFile(filepath: string) {
    return new Promise<Buffer>((resolve, reject) => {
        fs.readFile(filepath, (err: NodeJS.ErrnoException, data: Buffer) => {
            if (err)
                reject(err);
            else
                resolve(data);
        });
    });
}

export function stat(path: string): Promise<fs.Stats> {
    return new Promise<fs.Stats>((resolve, reject) => {
        fs.stat(path, (err: NodeJS.ErrnoException, stats: fs.Stats) => {
            if (err)
                reject(err);
            else
                resolve(stats);
        });
    });
}

export interface IExecutionResult {
    retc: Number;
    stdout: string;
    stderr: string;
}

export function execute(command: string, args: string[], options?: proc.SpawnOptions): Promise<IExecutionResult> {
    return new Promise<IExecutionResult>((resolve, reject) => {
        const child = proc.spawn(command, args, options);
        child.on('error', (err) => {
            reject(err);
        });
        let stdout_acc = '';
        let stderr_acc = '';
        child.stdout.on('data', (data: Uint8Array) => {
            stdout_acc += data.toString();
        });
        child.stderr.on('data', (data: Uint8Array) => {
            stderr_acc += data.toString();
        })
        child.on('exit', (retc) => {
            resolve({retc: retc, stdout: stdout_acc, stderr: stderr_acc});
        });
    });
}