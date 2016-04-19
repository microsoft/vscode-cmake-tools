'use strict';

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