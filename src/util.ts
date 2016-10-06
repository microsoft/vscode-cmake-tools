export type Maybe<T> = (T | null);

import * as path from 'path';

export namespace util {
  export function normalizePath(p: string): string {
    return path.normalize(p).replace(path.sep, path.posix.sep);
  }
}