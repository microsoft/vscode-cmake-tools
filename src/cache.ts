/**
 * Module for reading from the CMake cache
 */ /** */

import * as api from './api';
import * as logging from './logging';
import {fs} from './pr';
import rollbar from './rollbar';
import * as util from './util';
import * as nls from 'vscode-nls';
import { isBoolean } from 'util';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cache');


/**
 * Implements access to CMake cache entries. See `api.CacheEntry` for more
 * information. This type is immutable.
 */
export class Entry implements api.CacheEntry {
  private readonly _type: api.CacheEntryType = api.CacheEntryType.Uninitialized;
  private readonly _docs: string = '';
  private readonly _key: string = '';
  private readonly _value: any = null;
  private readonly _advanced: boolean = false;

  get type() { return this._type; }

  get helpString() { return this._docs; }

  get key() { return this._key; }

  get value() { return this._value; }

  as<T>(): T { return this.value as T; }

  get advanced() { return this._advanced; }

  /**
   * Create a new Cache Entry instance. Doesn't modify any files. You probably
   * want to get these from the `CMakeCache` object instead.
   * @param key The name of the entry
   * @param value The actual value of the entry. Always a string.
   * @param type The actual type of `value`
   * @param docs The `DOC` string in the cache
   * @param advanced Whether the entry is `ADVANCED`
   */
  constructor(key: string, value: string, type: api.CacheEntryType, docs: string, advanced: boolean) {
    this._key = key;
    this._type = type;
    if (type === api.CacheEntryType.Bool) {
      this._value = util.isTruthy(value);
    } else {
      this._value = value;
    }
    this._docs = docs;
    this._advanced = advanced;
  }
}

/**
 * Reads a CMake cache file. This class is immutable.
 */
export class CMakeCache {
  /**
   * Read the contents of a CMakeCache.txt file.
   * @param path Path to a CMakeCache.txt-format file
   * @returns The CMake cache.
   *
   * @note The cache *may* not exist. In that case, the entries is empty and
   * the `exists` property is `false`. Creating or modifying the file named by
   * `path` has no effect on existing instance of this class.
   */
  static async fromPath(path: string): Promise<CMakeCache> {
    log.debug(localize('reading.cmake.cache.file', 'Reading CMake cache file {0}', path));
    const exists = await fs.exists(path);
    if (exists) {
      log.trace(localize('file.exists', 'File exists'));
      const content = await fs.readFile(path);
      log.trace(localize('file.contents.read.successfully', 'File contents read successfully'));
      const entries = CMakeCache.parseCache(content.toString());
      log.trace(localize('parsed.entries.from', 'Parsed {0} entries from {1}', entries.size, path));
      return new CMakeCache(path, exists, entries);
    } else {
      log.debug(localize('cache.file.does.not.exist', 'Cache file does not exist: Returning empty cache data'));
      return new CMakeCache(path, exists, new Map());
    }
  }

  /** Get a list of all cache entries */
  get allEntries(): Entry[] { return Array.from(this._entries.values()); }

  /**
   * Create a new instance. This is **private**. You may only create an instance
   * via the `fromPath` static method.
   * @param _path Path to the cache
   * @param _exists Whether the file exists
   * @param _entries Entries in the cache
   */
  private constructor(private readonly _path: string,
                      private readonly _exists: boolean,
                      private readonly _entries: Map<string, Entry>) {}

  /**
   * `true` if the file exists when this instance was created.
   * `false` otherwise.
   */
  get exists() { return this._exists; }

  /**
   * The path to the cache file, which may not exist
   */
  get path() { return this._path; }

  /**
   * Reload the cache file and return a new instance. This will not modify this
   * instance.
   * @returns A **new instance**.
   */
  getReloaded(): Promise<CMakeCache> {
    log.debug(localize('reloading.cache.file', 'Reloading Cache file {0}', this.path));
    return CMakeCache.fromPath(this.path);
  }

  /**
   * Parse the contents of a CMake cache file.
   * @param content The contents of a CMake cache file.
   * @returns A map from the cache keys to the entries in the cache.
   */
  static parseCache(content: string): Map<string, Entry> {
    log.debug(localize('parsing.cmake.cache.string', 'Parsing CMake cache string'));
    const lines = content.split(/\r\n|\n|\r/).filter(line => !!line.length).filter(line => !/^\s*#/.test(line));

    const entries = new Map<string, Entry>();
    let docs_acc = '';
    for (const line of lines) {
      if (line.startsWith('//')) {
        docs_acc += /^\/\/(.*)/.exec(line)![1] + ' ';
      } else {
        const match = /^("(.*?)"|(.*?)):([^:]*?)=(.*)/.exec(line);
        if (!match) {
          rollbar.error(localize('failed.to.read.line.from.cmake.cache.file', 'Failed to read a line from a CMake cache file {0}', line));
          continue;
        }
        const [, , quoted_name, unquoted_name, typename, valuestr] = match;
        const name = quoted_name || unquoted_name;
        if (!name || !typename)
          continue;
        log.trace(localize('read.line.in.cache', 'Read line in cache with {0}={1}, {2}={3}, {4}={5}', 'name', name, 'typename', typename, 'valuestr', valuestr));
        if (name.endsWith('-ADVANCED') && valuestr === '1') {
          log.trace(localize('skipping.variable', 'Skipping {0} variable', '*-ADVANCED'));
          // We skip the ADVANCED property variables. They're a little odd.
        } else {
          const key = name;
          const typemap = {
            BOOL: api.CacheEntryType.Bool,
            STRING: api.CacheEntryType.String,
            PATH: api.CacheEntryType.Path,
            FILEPATH: api.CacheEntryType.FilePath,
            INTERNAL: api.CacheEntryType.Internal,
            UNINITIALIZED: api.CacheEntryType.Uninitialized,
            STATIC: api.CacheEntryType.Static,
          } as {[type: string]: api.CacheEntryType | undefined};
          const type = typemap[typename];
          const docs = docs_acc.trim();
          docs_acc = '';
          if (type === undefined) {
            rollbar.error(localize('cache.entry.unknown', 'Cache entry \'{0}\' has unknown type: \'{1}\'', name, typename));
          } else {
            log.trace(localize('constructing.new.cache.entry', 'Constructing a new cache entry from the given line'));
            entries.set(name, new Entry(key, valuestr, type, docs, false));
          }
        }
      }
    }

    log.trace(localize('parsed.cache.entries', 'Parsed {0} cache entries', entries.size));
    return entries;
  }

  /**
   * Takes a configuration file as a content string and replaces the cmake cache keys with the corresponding value (i.e. 'TRUE' or 'FALSE').
   * @param content Configuration File Content as String
   * @param key The CMake Cache Option Key to edit
   * @param value Boolean value
   */
  private replace(content: string, key: string, value: string): string {
    const re = key + ':[^=]+=(.+)';
    const found = content.match(re);

    if (found && found.length >= 2) {
      const line = found[0];
      const currentVal = found[1];
      const newValueLine = line.replace(currentVal, isBoolean(value) ? (value ? "TRUE" : "FALSE") : value);
      return content.replace(line, newValueLine);
    } else {
      return content;
    }
  }

  /**
   * Will replace value cmake option in the current loaded workspace.
   * @param key cmake option name
   * @param value value of cmake option
   */
  async replaceOption(key: string, value: string): Promise<string> {
    const exists = await fs.exists(this.path);
    if (exists) {
      const content = (await fs.readFile(this.path)).toString();
      return this.replace(content, key, value);
    }

    return '';
  }

  async replaceOptions(options: Array<{key: string, value: string}>): Promise<string> {
    const exists = await fs.exists(this.path);
    if (exists) {
      let content = (await fs.readFile(this.path)).toString();
      for (const option of options) {
        content = this.replace(content, option.key, option.value);
      }
      return content;
    }
    return '';
  }

  async save(key: string, value: string): Promise<void> {
    const content = await this.replaceOption(key, value);
    if (content) {
      if (await fs.exists(this.path)) {
        await fs.writeFile(this.path, content);
      }
    }
  }

  async saveAll(options: Array<{key: string, value: string}>): Promise<void> {
    const content = await this.replaceOptions(options);
    if (content) {
      if (await fs.exists(this.path)) {
        await fs.writeFile(this.path, content);
      }
    }
  }

  /**
   * Get an entry from the cache
   * @param key The name of a cache entry
   * @returns The cache entry, or `null` if the cache entry is not present.
   */
  get(key: string): Entry|null {
    const ret = this._entries.get(key) || null;
    if (ret) {
      log.trace(localize('get.cache.key', 'Get cache key {0}={1}', key, ret.value));
    } else {
      log.trace(localize('get.cache.key.missing', 'Get cache key {0}=[[Missing]]', key));
    }
    return ret;
  }
}
