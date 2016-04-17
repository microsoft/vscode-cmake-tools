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