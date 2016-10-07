export type Maybe<T> = (T | null);

import * as path from 'path';

export namespace util {
  export function normalizePath(p: string): string {
    let norm = path.normalize(p);
    while (path.sep !== path.posix.sep && norm.includes(path.sep)) {
        norm = norm.replace(path.sep, path.posix.sep);
    }
    return norm
  }
}