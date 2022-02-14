/**
 * Generate an array of key-value pairs from an object using
 * `getOwnPropertyNames`
 * @param obj The object to iterate
 */
export function objectPairs<V>(obj: { [key: string]: V }): [string, V][] {
    return Object.getOwnPropertyNames(obj).map(key => ([key, obj[key]] as [string, V]));
}

/**
 * Map an iterable by some projection function
 * @param iter An iterable to map
 * @param proj The projection function
 */
export function* map<In, Out>(iter: Iterable<In>, proj: (arg: In) => Out): Iterable<Out> {
    for (const item of iter) {
        yield proj(item);
    }
}

export function* chain<T>(...iter: Iterable<T>[]): Iterable<T> {
    for (const sub of iter) {
        for (const item of sub) {
            yield item;
        }
    }
}

export function reduce<In, Out>(iter: Iterable<In>, init: Out, mapper: (acc: Out, el: In) => Out): Out {
    for (const item of iter) {
        init = mapper(init, item);
    }
    return init;
}

export function find<T>(iter: Iterable<T>, predicate: (value: T) => boolean): T | undefined {
    for (const value of iter) {
        if (predicate(value)) {
            return value;
        }
    }
    // Nothing found
    return undefined;
}

/**
 * Generate a random integral value.
 * @param min Minimum value
 * @param max Maximum value
 */
export function randint(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min) + min);
}

export function product<T>(arrays: T[][]): T[][] {
    return arrays.reduce(
        (acc, curr) =>
            // Append each element of the current array to each list already accumulated
            acc.map(prev => curr.map(item => prev.concat(item)))
                // Join all the lists
                .reduce((a, b) => a.concat(b), []),
        [[]] as T[][]);
}

/**
 * Get one less than the given number of number-string.
 *
 * If the number is greater than zero, returns that number minus one. If
 * the number is less than one, returns zero.
 * @param num A number or string representing a number
 */
export function oneLess(num: number | string): number {
    if (typeof num === 'string') {
        return oneLess(parseInt(num));
    } else {
        return Math.max(0, num - 1);
    }
}
