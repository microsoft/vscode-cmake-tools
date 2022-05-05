import * as os from 'os';
import * as util from 'util';

const inspect = util.inspect.custom;
const envProperty = Symbol('envProperty');

// alias of NodeJS.ProcessEnv, Record<string, string | undefined> === Dict<string>
export type Environment = Record<string, string | undefined>;
export type EnvironmentWithNull = Record<string, string | undefined | null>;

export interface EnvironmentOptions {
    preserveNull?: boolean;
    /**
     * isWin32 should always preserved for easily running tests on
     * different platform for both win32/non-win32
     */
    isWin32?: boolean;
}

/**
 * EnvironmentPrivate is proxied because we need
 * mantain compatiable with NodeJS.ProcessEnv.
 * For example, supporse we have a env named with `get`, if we using
 * typescript `Index Signatures`, then what's the result of env.get will have
 * two meaning:
 *   * call the function `get`
 *   * get the environment variable `get`
 * But for environment variable, access any member with `name` should return the expeted
 * environment variable for that  `name`
 */
class EnvironmentPrivate {
    private keyMapping: Map<string, string>;
    /* Using envProperty symbol is to provide valid implemention for [inspect]() */
    public [envProperty]: EnvironmentWithNull;
    protected options: EnvironmentOptions;
    constructor(_options?: EnvironmentOptions) {
        this.keyMapping = new Map<string, string>();
        this[envProperty] = {};
        this.options = {
            preserveNull: _options?.preserveNull,
            isWin32: _options?.isWin32
        };
        if (this.options.preserveNull === undefined) {
            this.options.preserveNull = false;
        }
        if (this.options.isWin32 === undefined) {
            this.options.isWin32 = os.platform() === 'win32';
        }
    }

    public getKey(key: string, updateKey: boolean): string {
        if (this.options.isWin32) {
            const normalizedKey = key.toUpperCase();
            let resultKey = this.keyMapping.get(normalizedKey);
            if (resultKey === undefined) {
                resultKey = key;
                if (updateKey) {
                    this.keyMapping.set(normalizedKey, resultKey);
                }
            }
            return resultKey;
        }
        return key;
    }

    public get(key: string): string | undefined | null {
        return this[envProperty][this.getKey(key, false)];
    }

    public set(key: string | symbol, value?: string | null, receiver?: any): boolean {
        if (typeof key === 'string') {
            let deleteKey = false;
            if (value === undefined) {
                deleteKey = true;
            } else if (value === null) {
                if (!this.options.preserveNull) {
                    deleteKey = true;
                }
            } else if (typeof value !== 'string') {
                value = '' + value;
            }
            const existKey = this.getKey(key, true);
            if (deleteKey) {
                return Reflect.deleteProperty(this[envProperty], existKey);
            } else {
                return Reflect.set(this[envProperty], existKey, value, receiver);
            }
        }
        return false;
    }

    [inspect]() {
        return util.inspect(this[envProperty]);
    }

    toString() {
        return this[envProperty].toString();
    }
}

export class EnvironmentUtils {

    public static create(from?: Map<string, string> | EnvironmentWithNull | null, options?: EnvironmentOptions): Environment {
        const env = new EnvironmentPrivate(options);
        const p = new Proxy(env, {
            defineProperty: (target, p, attributes) => Reflect.defineProperty(target[envProperty], p, attributes),
            deleteProperty: (target, p) => Reflect.deleteProperty(target[envProperty], p),
            get: (target, p) => {
                if (typeof p === 'string') {
                    return target.get(p);
                }
                return Reflect.get(target, p);
            },
            getOwnPropertyDescriptor: (target, p) => {
                if (typeof p === 'string') {
                    return Reflect.getOwnPropertyDescriptor(target[envProperty], target.getKey(p, false));
                } else {
                    return Reflect.getOwnPropertyDescriptor(target, p);
                }
            },
            has: (target, p) => {
                if (typeof p === 'string') {
                    return Reflect.has(target[envProperty], target.getKey(p, false));
                } else {
                    return Reflect.has(target, p);
                }
            },
            ownKeys: (target) => Reflect.ownKeys(target[envProperty]),
            set: (target, p, value, receiver): boolean => target.set(p, value, receiver)
        }) as unknown as Environment;
        if (from !== undefined && from !== null) {
            if (from instanceof Map) {
                for (const [key, value] of from.entries()) {
                    p[key] = value;
                }
            } else {
                Object.assign(p, from);
            }
        }
        return p;
    }

    public static createPreserveNull(from?: Map<string, string> | EnvironmentWithNull | null): EnvironmentWithNull {
        return EnvironmentUtils.create(from, { preserveNull: true });
    }

    public static merge(envs: (EnvironmentWithNull | null | undefined)[], options?: EnvironmentOptions): Environment {
        const newEnv = EnvironmentUtils.create(undefined, options);
        for (const env of envs) {
            if (env !== undefined && env !== null) {
                Object.assign(newEnv, env);
            }
        }
        return newEnv;
    }

    public static mergePreserveNull(envs: (EnvironmentWithNull | null | undefined)[]): EnvironmentWithNull {
        return EnvironmentUtils.merge(envs, { preserveNull: true });
    }
}
