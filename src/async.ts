'use strict';

import * as proc from 'child_process';
import * as fs from 'fs';


export function doAsync<Result, Param, ErrorType>(
        fn: (param: Param, callback: (error: NodeJS.ErrnoException, res: Result) => void) => void,
        p: Param
): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
        fn(p, (err, res) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

export function doVoidAsync<Result, Param, ErrorType>(
        fn: (param: Param, callback: (error: NodeJS.ErrnoException) => void) => void,
        p: Param
): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
        fn(p, (er) => {
            if (er) {
                reject(er);
            } else {
                resolve();
            }
        });
    });
}

export function doNoErrorAsync<Result, Param>(
        fn: (param: Param, callback: (result: Result) => void) => void,
        p: Param
): Promise<Result> {
    return new Promise<Result>((resolve) => {
        fn(p, (res) => {
            resolve(res);
        });
    });
}

export function exists(filepath: string): Promise<boolean> {
    return doNoErrorAsync(fs.exists, filepath);
}

export function isDirectory(filepath: string): Promise<boolean> {
    return doAsync(fs.stat, filepath).then(stat => {
        return stat.isDirectory();
    });
}

export function unlink(filepath: string): Promise<void> {
    return doVoidAsync(fs.unlink, filepath);
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