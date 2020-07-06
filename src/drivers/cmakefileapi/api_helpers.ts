import * as api from '@cmt/api';
import * as cache from '@cmt/cache';
import * as index_api from '@cmt/drivers/cmakefileapi/api';
import {
  CodeModelConfiguration,
  CodeModelContent,
  CodeModelFileGroup,
  CodeModelProject,
  CodeModelTarget
} from '@cmt/drivers/codemodel-driver-interface';
import * as logging from '@cmt/logging';
import {fs} from '@cmt/pr';
import * as path from 'path';
import * as nls from 'vscode-nls';
import rollbar from '@cmt/rollbar';

nls.config({messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cmakefileapi-parser');

export async function createQueryFileForApi(api_path: string): Promise<string> {
  const query_path = path.join(api_path, 'query', 'client-vscode');
  const query_file_path = path.join(query_path, 'query.json');
  const requests = {requests: [{kind: 'cache', version: 2}, {kind: 'codemodel', version: 2}]};
  try {
    await fs.mkdir_p(query_path);
    await fs.writeFile(query_file_path, JSON.stringify(requests));
  } catch (e) {
    rollbar.exception(localize('failed.writing.to.file', 'Failed writing to file {0}', query_file_path), e);
    throw e;
  }
  return query_file_path;
}

export async function loadIndexFile(reply_path: string): Promise<index_api.Index.IndexFile|null> {
  log.debug(`Read reply folder: ${reply_path}`);
  if (!await fs.exists(reply_path)) {
    return null;
  }

  const files = await fs.readdir(reply_path);
  log.debug(`Found index files: ${JSON.stringify(files)}`);

  const index_files = files.filter(filename => filename.startsWith('index-')).sort();
  if (index_files.length == 0) {
    throw Error('No index file found.');
  }
  const index_file_path = path.join(reply_path, index_files[index_files.length - 1]);
  const file_content = await fs.readFile(index_file_path);

  return JSON.parse(file_content.toString()) as index_api.Index.IndexFile;
}

export async function loadCacheContent(filename: string): Promise<Map<string, api.CacheEntry>> {
  const file_content = await fs.readFile(filename);
  const cache_from_cmake = JSON.parse(file_content.toString()) as index_api.Cache.CacheContent;

  const expected_version = {major: 2, minor: 0};
  const detected_version = cache_from_cmake.version;
  if (detected_version.major != expected_version.major || detected_version.minor < expected_version.minor) {
    log.warning(localize(
        'cache.object.version',
        'Cache object version ({0}.{1}) of cmake-file-api is unexpected. Expecting ({2}.{3}). IntelliSense configuration may be incorrect.',
        detected_version.major,
        detected_version.minor,
        expected_version.major,
        expected_version.minor));
  }

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
      log.warning(localize('cache.entry.unknowntype', 'Unknown cache entry type: {0}.', el.type));
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
  const codemodel = JSON.parse(file_content.toString()) as index_api.CodeModelKind.Content;
  const expected_version = {major: 2, minor: 0};
  const detected_version = codemodel.version;

  if (detected_version.major != expected_version.major || detected_version.minor != expected_version.minor) {
    log.warning(localize(
        'code.model.version',
        'Code model version ({0}.{1}) of cmake-file-api is unexpected. Expecting ({2}.{3}). IntelliSense configuration may be incorrect.',
        detected_version.major,
        detected_version.minor,
        expected_version.major,
        expected_version.minor));
  }

  return codemodel;
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
      if (await fs.exists(executable_path.path)) {
        executable_path = path.normalize(executable_path.path);
      } else {
        executable_path = path.normalize(path.join(build_dir, executable_path.path));
        if (!fs.exists(executable_path)) {
          // Will be empty after cmake configuration
          executable_path = "";
        }
      }
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
  const metaTargets = [];
  if (configuration.directories[0].hasInstallRule) {
    metaTargets.push({
      type: 'rich' as 'rich',
      name: 'install',
      filepath: 'A special target to install all available targets',
      targetType: 'META'
    });
  }
  const targetsList = Promise.all(configuration.targets.map(
      t => convertTargetObjectFileToExtensionTarget(builddir, path.join(reply_path, t.jsonFile))));

  return {name: configuration.name, targets: [...metaTargets, ...await targetsList]};
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
  // Prepend the base path to the input path if the input path is relative.
  const absolute_path = path.isAbsolute(input_path) ? input_path : path.join(base_path, input_path);
  return path.normalize(absolute_path);
}

function convertToExtCodeModelFileGroup(targetObject: index_api.CodeModelKind.TargetObject): CodeModelFileGroup[] {
  const fileGroup: CodeModelFileGroup[] = !targetObject.compileGroups ? [] : targetObject.compileGroups.map(group => {
    const compileFlags
        = group.compileCommandFragments ? group.compileCommandFragments.map(frag => frag.fragment).join(' ') : '';

    return {
      isGenerated: false,
      sources: [],
      language: group.language,
      includePath: group.includes ? group.includes : [],
      compileFlags,
      defines: group.defines ? group.defines.map(define => define.define) : []
    };
  });
  // Collection all without compilegroup like headers
  const defaultIndex = fileGroup.push({sources: [], isGenerated: false} as CodeModelFileGroup) - 1;


  targetObject.sources.forEach(sourcefile => {
    const file_path = path.relative(targetObject.paths.source, sourcefile.path).replace('\\', '/');
    if (sourcefile.compileGroupIndex !== undefined) {
      fileGroup[sourcefile.compileGroupIndex].sources.push(file_path);
    } else {
      fileGroup[defaultIndex].sources.push(file_path);
      if (!!sourcefile.isGenerated) {
        fileGroup[defaultIndex].isGenerated = sourcefile.isGenerated;
      }
    }
  });
  return fileGroup;
}

async function loadCodeModelTarget(root_paths: index_api.CodeModelKind.PathInfo, jsonfile: string) {
  const targetObject = await loadTargetObject(jsonfile);

  const fileGroups = convertToExtCodeModelFileGroup(targetObject);

  // This implementation expects that there is only one sysroot in a target.
  // The ServerAPI only has provided one sysroot. In the FileAPI,
  // each compileGroup has its separate sysroot.
  let sysroot;
  if (targetObject.compileGroups) {
    const all_sysroots
        = targetObject.compileGroups.map(x => !!x.sysroot ? x.sysroot.path : undefined).filter(x => x !== undefined);
    sysroot = all_sysroots.length != 0 ? all_sysroots[0] : undefined;
  }

  return {
    name: targetObject.name,
    type: targetObject.type,
    sourceDirectory: convertToAbsolutePath(targetObject.paths.source, root_paths.source),
    fullName: targetObject.nameOnDisk,
    artifacts: targetObject.artifacts ? targetObject.artifacts.map(
                   a => convertToAbsolutePath(path.join(targetObject.paths.build, a.path), root_paths.build))
                                      : [],
    fileGroups,
    sysroot
  } as CodeModelTarget;
}

export async function loadProject(root_paths: index_api.CodeModelKind.PathInfo,
                                  reply_path: string,
                                  projectIndex: number,
                                  configuration: index_api.CodeModelKind.Configuration) {
  const project = configuration.projects[projectIndex];
  const project_paths = {
    build: project.directoryIndexes
        ? path.join(root_paths.build, configuration.directories[project.directoryIndexes[0]].build)
        : root_paths.build,
    source: project.directoryIndexes
        ? path.join(root_paths.source, configuration.directories[project.directoryIndexes[0]].source)
        : root_paths.source,
  };
  const targets = await Promise.all((project.targetIndexes || []).map(targetIndex => {
    return loadCodeModelTarget(root_paths, path.join(reply_path, configuration.targets[targetIndex].jsonFile));
  }));

  return {name: project.name, targets, sourceDirectory: project_paths.source} as CodeModelProject;
}

export async function loadConfig(paths: index_api.CodeModelKind.PathInfo,
                                 reply_path: string,
                                 configuration: index_api.CodeModelKind.Configuration) {
  const projects = await Promise.all(
      (configuration.projects).map((_, index) => loadProject(paths, reply_path, index, configuration)));
  return {projects} as CodeModelConfiguration;
}
export async function loadExtCodeModelContent(reply_path: string, codeModel_filename: string) {
  const codeModelContent = await loadCodeModelContent(path.join(reply_path, codeModel_filename));

  const configurations
      = await Promise.all((codeModelContent.configurations)
                              .map(config_element => loadConfig(codeModelContent.paths, reply_path, config_element)));

  return {configurations} as CodeModelContent;
}
