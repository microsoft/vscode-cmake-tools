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
        });
        child.on('exit', (retc) => {
            resolve({retc: retc, stdout: stdout_acc, stderr: stderr_acc});
        });
    });
}

export interface ITask<T> {
    (): T;
}

/**
 * A helper to prevent accumulation of sequential async tasks.
 *
 * Imagine a mail man with the sole task of delivering letters. As soon as
 * a letter submitted for delivery, he drives to the destination, delivers it
 * and returns to his base. Imagine that during the trip, N more letters were submitted.
 * When the mail man returns, he picks those N letters and delivers them all in a
 * single trip. Even though N+1 submissions occurred, only 2 deliveries were made.
 *
 * The throttler implements this via the queue() method, by providing it a task
 * factory. Following the example:
 *
 * 		var throttler = new Throttler();
 * 		var letters = [];
 *
 * 		function letterReceived(l) {
 * 			letters.push(l);
 * 			throttler.queue(() => { return makeTheTrip(); });
 * 		}
 */
export class Throttler<T> {

    private activePromise: Promise<T>;
    private queuedPromise: Promise<T>;
    private queuedPromiseFactory: ITask<Promise<T>>;

    constructor() {
        this.activePromise = null!;
        this.queuedPromise = null!;
        this.queuedPromiseFactory = null!;
    }

    public queue(promiseFactory: ITask<Promise<T>>): Promise<T> {
        if (this.activePromise) {
            this.queuedPromiseFactory = promiseFactory;

            if (!this.queuedPromise) {
                var onComplete = () => {
                    this.queuedPromise = null!;

                    var result = this.queue(this.queuedPromiseFactory);
                    this.queuedPromiseFactory = null!;

                    return result;
                };

                this.queuedPromise = new Promise<T>((resolve, reject) => {
                    this.activePromise.then(onComplete, onComplete).then(resolve);
                });
            }

            return new Promise<T>((resolve, reject) => {
                this.queuedPromise.then(resolve, reject);
            });
        }

        this.activePromise = promiseFactory();

        return new Promise<T>((resolve, reject) => {
            this.activePromise.then((result: T) => {
                this.activePromise = null!;
                resolve(result);
            }, (err: any) => {
                this.activePromise = null!;
                reject(err);
            });
        });
    }
}

