import * as api from '@cmt/api';
import * as cache from '@cmt/cache';
import * as index_api from '@cmt/drivers/cmakefileapi/api';
import * as driver_api from '@cmt/drivers/driver_api';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import rollbar from '@cmt/rollbar';
import * as path from 'path';

const log = logging.createLogger('cmakefileapi-helper');

export async function createQueryFileForApi(api_path: string): Promise<string> {
  const query_path = path.join(api_path, 'query', 'client-vscode');
  const query_file_path = path.join(query_path, 'query.json');
  await fs.mkdir_p(query_path);

  const requests
      = {requests: [{kind: 'cache', version: 2}, {kind: 'codemodel', version: 2}, {kind: 'cmakeFiles', version: 1}]};

  await fs.writeFile(query_file_path, JSON.stringify(requests));
  return query_file_path;
}

export async function loadIndexFile(reply_path: string): Promise<index_api.Index.IndexFile|null> {
  log.debug(`Read reply folder: ${reply_path}`);
  if (!await fs.exists(reply_path)) {
    return null;
  }

  const files = await fs.readdir(reply_path);
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

function convertFileApiCacheToExtensionCache(cache_from_cmake: index_api.Cache.CacheContent):
    Map<string, api.CacheEntry> {
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

export async function loadCodeModelContent(filename: string): Promise<index_api.CodeModelKind.Content> {
  const file_content = await fs.readFile(filename);
  return JSON.parse(file_content.toString()) as index_api.CodeModelKind.Content;
}

export async function loadTargetObject(filename: string): Promise<index_api.CodeModelKind.TargetObject> {
  const file_content = await fs.readFile(filename);
  return JSON.parse(file_content.toString()) as index_api.CodeModelKind.TargetObject;
}

async function convertTargetObjectFileToExtensionTarget(build_dir: string, file_path: string): Promise<api.Target> {
  const targetObject = await loadTargetObject(file_path);

  let executable_path = undefined;
  if (targetObject.artifacts) {
    executable_path = targetObject.artifacts.find(artifact => artifact.path.endsWith(targetObject.nameOnDisk));
    if (executable_path) {
      executable_path = path.normalize(path.join(build_dir, executable_path.path));
    }
  }

  return {
    name: targetObject.name,
    filepath: executable_path ? executable_path : 'Utility target',
    targetType: targetObject.type,
    type: 'rich' as 'rich'
  } as api.RichTarget;
}

export async function loadAllTargetsForBuildTypeConfiguration(reply_path: string,
                                                              builddir: string,
                                                              configuration: index_api.CodeModelKind.Configuration):
    Promise<{name: string, targets: api.Target[]}> {
  const targetsList = Promise.all(configuration.targets.map(
      t => convertTargetObjectFileToExtensionTarget(builddir, path.join(reply_path, t.jsonFile))));

  return {name: configuration.name, targets: await targetsList};
}

export async function loadConfigurationTargetMap(reply_path: string, codeModel_filename: string) {
  const codeModelContent = await loadCodeModelContent(path.join(reply_path, codeModel_filename));
  const build_dir = codeModelContent.paths.build;
  const targets = await Promise.all(codeModelContent.configurations.map(
      config_element => loadAllTargetsForBuildTypeConfiguration(reply_path, build_dir, config_element)));
  return targets.reduce((acc, el) => {
    acc.set(el.name, el.targets);
    return acc;
  }, new Map<string, api.Target[]>());
}

function convertToAbsolutePath(input_path: string, base_path: string) {
  return path.normalize(input_path.startsWith('.') ? path.join(base_path, input_path) : input_path);
}

function convertToExtCodeModelFileGroup(paths: index_api.CodeModelKind.PathInfo,
                                        targetObject: index_api.CodeModelKind.TargetObject,
                                        group: index_api.CodeModelKind.CompileGroup): driver_api.ExtCodeModelFileGroup {

  const compileFlags
      = group.compileCommandFragments ? group.compileCommandFragments.map(frag => frag.fragment).join(' ') : '';

  return {
    sources: group.sourceIndexes.map(
        idx => convertToAbsolutePath(path.join(targetObject.paths.build, targetObject.sources[idx].path),
                                     paths.source)),
    language: group.language,
    includePath: group.defines ? group.includes : [],
    compileFlags,
    defines: group.defines ? group.defines.map(define => define.define) : []
  };
}

async function loadCodeModelTarget(paths: index_api.CodeModelKind.PathInfo, jsonfile: string) {
  const targetObject = await loadTargetObject(jsonfile);

  const fileGroups = targetObject.compileGroups
      ? targetObject.compileGroups.map(group => convertToExtCodeModelFileGroup(paths, targetObject, group))
      : undefined;

  return {
    name: targetObject.name,
    type: targetObject.type,
    sourceDirectory: convertToAbsolutePath(targetObject.paths.source, paths.source),
    fullName: targetObject.nameOnDisk,
    artifacts: targetObject.artifacts
        ? targetObject.artifacts.map(
              a => convertToAbsolutePath(path.join(targetObject.paths.build, a.path), paths.build))
        : [],
    fileGroups
  };
}

export async function loadProject(paths: index_api.CodeModelKind.PathInfo,
                                  reply_path: string,
                                  projectIndex: number,
                                  configuration: index_api.CodeModelKind.Configuration) {
  const project = configuration.projects[projectIndex];
  const targets = await Promise.all(project.targetIndexes.map(targetIndex => {
    return loadCodeModelTarget(paths, path.join(reply_path, configuration.targets[targetIndex].jsonFile));
  }));

  return {name: project.name, targets, sourceDirectory: ''} as driver_api.ExtCodeModelProject;
}

export async function loadConfig(paths: index_api.CodeModelKind.PathInfo,
                                 reply_path: string,
                                 configuration: index_api.CodeModelKind.Configuration) {
  const projects = await Promise.all(
      configuration.projects.map((_, index) => loadProject(paths, reply_path, index, configuration)));
  return {projects} as driver_api.ExtCodeModelConfiguration;
}
export async function loadExtCodeModelContent(reply_path: string, codeModel_filename: string) {
  const codeModelContent = await loadCodeModelContent(path.join(reply_path, codeModel_filename));

  const configurations = await Promise.all(codeModelContent.configurations.map(
      config_element => loadConfig(codeModelContent.paths, reply_path, config_element)));

  return {configurations} as driver_api.ExtCodeModelContent;
}