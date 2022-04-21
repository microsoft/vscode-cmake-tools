import * as api from '@cmt/api';
import * as cache from '@cmt/cache';
import * as cmakeFileApi from '@cmt/drivers/cmakefileapi/cmakeFileApi';
import {
    CodeModelConfiguration,
    CodeModelContent,
    CodeModelFileGroup,
    CodeModelProject,
    CodeModelTarget,
    CodeModelToolchain
} from '@cmt/drivers/codeModelApi';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as path from 'path';
import * as nls from 'vscode-nls';
import rollbar from '@cmt/rollbar';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cmakefileapi-parser');

export async function createQueryFileForApi(apiPath: string): Promise<string> {
    const queryPath = path.join(apiPath, 'query', 'client-vscode');
    const queryFilePath = path.join(queryPath, 'query.json');
    const requests = { requests: [{ kind: 'cache', version: 2 }, { kind: 'codemodel', version: 2 }, { kind: 'toolchains', version: 1 }] };
    try {
        await fs.mkdir_p(queryPath);
        await fs.writeFile(queryFilePath, JSON.stringify(requests));
    } catch (e: any) {
        rollbar.exception(localize('failed.writing.to.file', 'Failed writing to file {0}', queryFilePath), e);
        throw e;
    }
    return queryFilePath;
}

export async function loadIndexFile(replyPath: string): Promise<cmakeFileApi.Index.IndexFile | null> {
    log.debug(`Read reply folder: ${replyPath}`);
    if (!await fs.exists(replyPath)) {
        return null;
    }

    const files = await fs.readdir(replyPath);
    log.debug(`Found index files: ${JSON.stringify(files)}`);

    const indexFiles = files.filter(filename => filename.startsWith('index-')).sort();
    if (indexFiles.length === 0) {
        throw Error('No index file found.');
    }
    const indexFilePath = path.join(replyPath, indexFiles[indexFiles.length - 1]);
    const fileContent = await fs.readFile(indexFilePath);

    return JSON.parse(fileContent.toString()) as cmakeFileApi.Index.IndexFile;
}

export async function loadCacheContent(filename: string): Promise<Map<string, api.CacheEntry>> {
    const fileContent = await fs.readFile(filename);
    const cmakeCacheContent = JSON.parse(fileContent.toString()) as cmakeFileApi.Cache.CacheContent;

    const expectedVersion = { major: 2, minor: 0 };
    const detectedVersion = cmakeCacheContent.version;
    if (detectedVersion.major !== expectedVersion.major || detectedVersion.minor < expectedVersion.minor) {
        log.warning(localize(
            'cache.object.version',
            'Cache object version ({0}.{1}) of cmake-file-api is unexpected. Expecting ({2}.{3}). IntelliSense configuration may be incorrect.',
            detectedVersion.major,
            detectedVersion.minor,
            expectedVersion.major,
            expectedVersion.minor));
    }

    return convertFileApiCacheToExtensionCache(cmakeCacheContent);
}

function findPropertyValue(cacheElement: cmakeFileApi.Cache.CMakeCacheEntry, name: string): string {
    const propertyElement = cacheElement.properties.find(prop => prop.name === name);
    return propertyElement ? propertyElement.value : '';
}

function convertFileApiCacheToExtensionCache(cmakeCacheContent: cmakeFileApi.Cache.CacheContent): Map<string, api.CacheEntry> {
    return cmakeCacheContent.entries.reduce((acc, el) => {
        const FileApiToExtensionCacheMap: { [key: string]: api.CacheEntryType | undefined } = {
            BOOL: api.CacheEntryType.Bool,
            STRING: api.CacheEntryType.String,
            PATH: api.CacheEntryType.Path,
            FILEPATH: api.CacheEntryType.FilePath,
            INTERNAL: api.CacheEntryType.Internal,
            UNINITIALIZED: api.CacheEntryType.Uninitialized,
            STATIC: api.CacheEntryType.Static
        };
        const type = FileApiToExtensionCacheMap[el.type];
        if (type === undefined) {
            log.warning(localize('cache.entry.unknowntype', 'Unknown cache entry type: {0}.', el.type));
            return acc;
        }
        const helpString = findPropertyValue(el, 'HELPSTRING');
        const advanced = findPropertyValue(el, 'ADVANCED');
        acc.set(el.name, new cache.Entry(el.name, el.value, type, helpString, advanced === '1'));
        return acc;
    }, new Map<string, api.CacheEntry>());
}

export async function loadCodeModelContent(filename: string): Promise<cmakeFileApi.CodeModelKind.Content> {
    const fileContent = await fs.readFile(filename);
    const codemodel = JSON.parse(fileContent.toString()) as cmakeFileApi.CodeModelKind.Content;
    const expectedVersion = { major: 2, minor: 0 };
    const detectedVersion = codemodel.version;

    if (detectedVersion.major !== expectedVersion.major || detectedVersion.minor < expectedVersion.minor) {
        log.warning(localize(
            'code.model.version',
            'Code model version ({0}.{1}) of cmake-file-api is unexpected. Expecting ({2}.{3}). IntelliSense configuration may be incorrect.',
            detectedVersion.major,
            detectedVersion.minor,
            expectedVersion.major,
            expectedVersion.minor));
    }

    return codemodel;
}

export async function loadTargetObject(filename: string): Promise<cmakeFileApi.CodeModelKind.TargetObject> {
    const fileContent = await fs.readFile(filename);
    return JSON.parse(fileContent.toString()) as cmakeFileApi.CodeModelKind.TargetObject;
}

async function convertTargetObjectFileToExtensionTarget(buildDirectory: string, filePath: string): Promise<api.Target> {
    const targetObject = await loadTargetObject(filePath);

    let executablePath;
    if (targetObject.artifacts) {
        executablePath = targetObject.artifacts.find(artifact => artifact.path.endsWith(targetObject.nameOnDisk));
        if (executablePath) {
            executablePath = convertToAbsolutePath(executablePath.path, buildDirectory);
        }
    }

    return {
        name: targetObject.name,
        filepath: executablePath,
        targetType: targetObject.type,
        type: 'rich' as 'rich'
    } as api.RichTarget;
}

export async function loadAllTargetsForBuildTypeConfiguration(replyPath: string,
    buildDirectory: string,
    configuration: cmakeFileApi.CodeModelKind.Configuration):
    Promise<{ name: string; targets: api.Target[] }> {
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
        t => convertTargetObjectFileToExtensionTarget(buildDirectory, path.join(replyPath, t.jsonFile))));

    return { name: configuration.name, targets: [...metaTargets, ...await targetsList] };
}

export async function loadConfigurationTargetMap(replyPath: string, codeModelFileName: string) {
    const codeModelContent = await loadCodeModelContent(path.join(replyPath, codeModelFileName));
    const buildDirectory = codeModelContent.paths.build;
    const targets = await Promise.all(codeModelContent.configurations.map(
        config => loadAllTargetsForBuildTypeConfiguration(replyPath, buildDirectory, config)));
    return targets.reduce((acc, el) => {
        acc.set(el.name, el.targets);
        return acc;
    }, new Map<string, api.Target[]>());
}

function convertToAbsolutePath(inputPath: string, basePath: string) {
    // Prepend the base path to the input path if the input path is relative.
    const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(basePath, inputPath);
    return path.normalize(absolutePath);
}

function convertToExtCodeModelFileGroup(targetObject: cmakeFileApi.CodeModelKind.TargetObject,
    rootPaths: cmakeFileApi.CodeModelKind.PathInfo): CodeModelFileGroup[] {
    const fileGroup: CodeModelFileGroup[] = !targetObject.compileGroups ? [] : targetObject.compileGroups.map(group => {
        const compileFlags = group.compileCommandFragments ? group.compileCommandFragments.map(frag => frag.fragment).join(' ') : '';

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
    const defaultIndex = fileGroup.push({ sources: [], isGenerated: false } as CodeModelFileGroup) - 1;

    const targetRootSource = convertToAbsolutePath(targetObject.paths.source, rootPaths.source);
    targetObject.sources.forEach(sourceFile => {
        const fileAbsolutePath = convertToAbsolutePath(sourceFile.path, rootPaths.source);
        const fileRelativePath = path.relative(targetRootSource, fileAbsolutePath).replace('\\', '/');
        if (sourceFile.compileGroupIndex !== undefined) {
            fileGroup[sourceFile.compileGroupIndex].sources.push(fileRelativePath);
        } else {
            fileGroup[defaultIndex].sources.push(fileRelativePath);
            if (!!sourceFile.isGenerated) {
                fileGroup[defaultIndex].isGenerated = sourceFile.isGenerated;
            }
        }
    });
    return fileGroup;
}

async function loadCodeModelTarget(rootPaths: cmakeFileApi.CodeModelKind.PathInfo, jsonFile: string) {
    const targetObject = await loadTargetObject(jsonFile);

    const fileGroups = convertToExtCodeModelFileGroup(targetObject, rootPaths);

    // This implementation expects that there is only one sysroot in a target.
    // The ServerAPI only has provided one sysroot. In the FileAPI,
    // each compileGroup has its separate sysroot.
    let sysroot;
    if (targetObject.compileGroups) {
        const allSysroots = targetObject.compileGroups.map(x => !!x.sysroot ? x.sysroot.path : undefined).filter(x => x !== undefined);
        sysroot = allSysroots.length !== 0 ? allSysroots[0] : undefined;
    }

    return {
        name: targetObject.name,
        type: targetObject.type,
        sourceDirectory: convertToAbsolutePath(targetObject.paths.source, rootPaths.source),
        fullName: targetObject.nameOnDisk,
        artifacts: targetObject.artifacts ? targetObject.artifacts.map(
            a => convertToAbsolutePath(path.join(targetObject.paths.build, a.path), rootPaths.build))
            : [],
        fileGroups,
        sysroot
    } as CodeModelTarget;
}

export async function loadProject(rootPaths: cmakeFileApi.CodeModelKind.PathInfo,
    replyPath: string,
    projectIndex: number,
    configuration: cmakeFileApi.CodeModelKind.Configuration) {
    const project = configuration.projects[projectIndex];
    const projectPaths = {
        build: project.directoryIndexes
            ? path.join(rootPaths.build, configuration.directories[project.directoryIndexes[0]].build)
            : rootPaths.build,
        source: project.directoryIndexes
            ? path.join(rootPaths.source, configuration.directories[project.directoryIndexes[0]].source)
            : rootPaths.source
    };
    const targets = await Promise.all((project.targetIndexes || []).map(targetIndex => loadCodeModelTarget(rootPaths, path.join(replyPath, configuration.targets[targetIndex].jsonFile))));

    return { name: project.name, targets, sourceDirectory: projectPaths.source } as CodeModelProject;
}

export async function loadConfig(paths: cmakeFileApi.CodeModelKind.PathInfo,
    replyPath: string,
    configuration: cmakeFileApi.CodeModelKind.Configuration) {
    const projects = await Promise.all(
        (configuration.projects).map((_, index) => loadProject(paths, replyPath, index, configuration)));
    return { name: configuration.name, projects } as CodeModelConfiguration;
}
export async function loadExtCodeModelContent(replyPath: string, codeModelFileName: string) {
    const codeModelContent = await loadCodeModelContent(path.join(replyPath, codeModelFileName));

    const configurations = await Promise.all(codeModelContent.configurations.map(config => loadConfig(codeModelContent.paths, replyPath, config)));

    return { configurations } as CodeModelContent;
}

export async function loadToolchains(filename: string): Promise<Map<string, CodeModelToolchain>> {
    const fileContent = await fs.readFile(filename);
    const toolchains = JSON.parse(fileContent.toString()) as cmakeFileApi.Toolchains.Content;

    const expectedVersion = { major: 1, minor: 0 };
    const detectedVersion = toolchains.version;
    if (detectedVersion.major !== expectedVersion.major || detectedVersion.minor < expectedVersion.minor) {
        log.warning(localize(
            'toolchains.object.version',
            'Toolchains object version ({0}.{1}) of cmake-file-api is unexpected. Expecting ({2}.{3}). IntelliSense configuration may be incorrect.',
            detectedVersion.major,
            detectedVersion.minor,
            expectedVersion.major,
            expectedVersion.minor));
    }

    return toolchains.toolchains.reduce((acc, el) => {
        if (el.compiler.path) {
            if (el.compiler.target) {
                acc.set(el.language, { path: el.compiler.path, target: el.compiler.target });
            } else {
                acc.set(el.language, { path: el.compiler.path });
            }
        }
        return acc;
    }, new Map<string, CodeModelToolchain>());
}
