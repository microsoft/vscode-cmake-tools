import * as api from '@cmt/api';
import * as cache from '@cmt/cache';
import * as index_api from '@cmt/drivers/cmakefileapi/api';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import rollbar from '@cmt/rollbar';
import * as path from 'path';

const log = logging.createLogger('cmakefileapi-helper');

export async function loadIndexFile(reply_path: string): Promise<index_api.Index.IndexFile> {
  log.debug(`Read reply folder: ${reply_path}`);
  const files = await fs.readdir(path.join(reply_path));
  log.debug(`Found index files: ${JSON.stringify(files)}`);

  const index_file = files.find(filename => filename.startsWith('index-'));
  if (!index_file) {
    throw Error('Unexpected count of index files');
  }
  const index_file_path = path.join(reply_path, index_file);
  const file_content = await fs.readFile(index_file_path);

  return JSON.parse(file_content.toString()) as index_api.Index.IndexFile;
}

export async function loadCacheContent(filename: string): Promise<Map<string, api.CacheEntry>> {
  const file_content = await fs.readFile(filename);
  const cache_from_cmake = JSON.parse(file_content.toString()) as index_api.Cache.CacheContent;

  return convertFileApiCacheToExtensionCache(cache_from_cmake);
}

function findPropertyValue(cacheElement: index_api.Cache.CMakeCacheEntry, name: string): string {
  const property_element = cacheElement.properties.find(prop => prop.name == name);
  return property_element ? property_element.value : '';
}

function convertFileApiCacheToExtensionCache(cache_from_cmake: index_api.Cache.CacheContent) {
  return cache_from_cmake.entries.reduce((acc, el) => {
    const entry_type_translation_map: {[key: string]: api.CacheEntryType|undefined;} = {
      BOOL: api.CacheEntryType.Bool,
      STRING: api.CacheEntryType.String,
      PATH: api.CacheEntryType.Path,
      FILEPATH: api.CacheEntryType.FilePath,
      INTERNAL: api.CacheEntryType.Internal,
      UNINITIALIZED: api.CacheEntryType.Uninitialized,
      STATIC: api.CacheEntryType.Static,
    };
    const type = entry_type_translation_map[el.type];
    if (type === undefined) {
      rollbar.error(`Unknown cache entry type ${el.type}`);
      return acc;
    }
    const helpstring = findPropertyValue(el, 'HELPSTRING');
    const advanced = findPropertyValue(el, 'ADVANCED');
    acc.set(el.name, new cache.Entry(el.name, el.value, type, helpstring, advanced === '1'));
    return acc;
  }, new Map<string, api.CacheEntry>());
}