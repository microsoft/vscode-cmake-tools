/**
 * This module defines the cmake file API for typescript. This makes the use of
 * the FileAPI simpler to use.
 *
 * For details see (cmake-file-api(7))[https://cmake.org/cmake/help/v3.15/manual/cmake-file-api.7.html].
 * This file implements only the new required structures.
 */

import * as cache from '@cmt/cache';
import {
    CodeModelConfiguration,
    CodeModelContent,
    CodeModelFileGroup,
    CodeModelProject,
    CodeModelTarget,
    CodeModelToolchain
} from '@cmt/drivers/codeModel';
import * as logging from '@cmt/logging';
import { fs } from '@cmt/pr';
import * as path from 'path';
import * as nls from 'vscode-nls';
import rollbar from '@cmt/rollbar';
import { removeEmpty } from '@cmt/util';
import { RichTarget, Target } from '@cmt/drivers/drivers';

export interface ApiVersion {
    major: number;
    minor: number;
}

export namespace Index {
    export interface GeneratorInformation {
        name: string;
        platform?: string;
    }

    export interface CMake {
        generator: GeneratorInformation;
    }

    export interface ObjectKind {
        kind: string;
        version: ApiVersion;
        jsonFile: string;
    }

    export interface IndexFile {
        cmake: CMake;
        objects: ObjectKind[];
    }
}

export namespace Cache {
    export interface CacheContent {
        version: ApiVersion;
        entries: CMakeCacheEntry[];
    }

    export interface CacheEntryProperties {
        name: string;
        value: string;
    }

    export interface CMakeCacheEntry {
        name: string;
        properties: CacheEntryProperties[];
        type: string;
        value: string;
    }
}

export namespace CodeModelKind {
    export interface PathInfo {
        build: string;
        source: string;
    }

    export interface DirectoryMetadata {
        source: string;
        build: string;
        hasInstallRule: boolean;
    }

    export interface ProjectMetadata {
        name: string;
        targetIndexes?: number[];
        directoryIndexes: number[];
    }

    export interface Configuration {
        name: string;
        targets: Target[];
        directories: DirectoryMetadata[];
        projects: ProjectMetadata[];
    }

    export interface Content {
        version: ApiVersion;
        paths: PathInfo;
        configurations: Configuration[];
    }

    export interface Target {
        name: string;
        type: string;
        jsonFile: string;
    }

    export interface PreprocessorDefinitionMetadata {
        define: string;
    }

    export interface IncludeMetadata {
        path: string;
    }

    export interface SysRoot {
        path: string;
    }

    export interface CompileCommandFragments {
        fragment: string;
    }

    export interface FrameworkMetadata {
        isSystem?: boolean;
        path: string;
    }

    export interface CompileGroup {
        language: string;
        includes: IncludeMetadata[];
        defines: PreprocessorDefinitionMetadata[];
        compileCommandFragments: CompileCommandFragments[];
        sourceIndexes: number[];
        sysroot: SysRoot;

        // Added in CMake 3.27, codemodel version 2.6.
        frameworks?: FrameworkMetadata[];
    }

    export interface ArtifactPath {
        path: string;
    }

    export interface TargetSourcefile {
        path: string;
        compileGroupIndex?: number;
        isGenerated?: boolean;
    }

    export interface TargetObject {
        name: string;
        type: string;
        artifacts: ArtifactPath[];
        nameOnDisk: string;
        paths: PathInfo;
        sources: TargetSourcefile[];
        compileGroups?: CompileGroup[];
    }
}

export namespace Toolchains {
    export interface Content {
        version: ApiVersion;
        toolchains: Toolchain[];
    }

    export interface Toolchain {
        language: string;
        compiler: Compiler;
        sourceFileExtensions?: string[];
    }

    export interface Compiler {
        path?: string;
        id?: string;
        version?: string;
        target?: string;
        implicit: ImplicitCompilerInfo;
    }

    export interface ImplicitCompilerInfo {
        includeDirectories?: string[];
        linkDirectories?: string[];
        linkFrameworkDirectories?: string[];
        linkLibraries?: string[];
    }
}

export namespace CMakeFiles {
    export interface Content {
        version: ApiVersion;
        paths: PathInfo[];
        inputs: InputFileInfo[];
    }

    export interface PathInfo {
        build: string;
        source: string;
    }

    export interface InputFileInfo {
        path: string;
        isGenerated?: boolean;
        isExternal?: boolean;
        isCMake?: boolean;
    }
}

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const log = logging.createLogger('cmakefileapi-parser');

/**
 * Attempt to read from a file path. Log a message if it's not readable.
 */
async function tryReadFile(file: string): Promise<string | undefined> {
    const fileInfo = await fs.stat(file);
    if (fileInfo.isFile()) {
        return fs.readFile(file);
    } else {
        log.debug(localize('path.not.a.file', 'Unable to read {0} because it is not a file. Code model information is incomplete or corrupt. You may need to delete the cache and reconfigure.', `"${file}"`));
        return undefined;
    }
}

export async function createQueryFileForApi(apiPath: string): Promise<string> {
    const queryPath = path.join(apiPath, 'query', 'client-vscode');
    const queryFilePath = path.join(queryPath, 'query.json');
    const requests = {
        requests: [
            { kind: 'cache', version: 2 },
            { kind: 'codemodel', version: 2 },
            { kind: 'toolchains', version: 1 },
            { kind: 'cmakeFiles', version: 1 }
        ]
    };
    try {
        await fs.mkdir_p(queryPath);
        await fs.writeFile(queryFilePath, JSON.stringify(requests));
    } catch (e: any) {
        rollbar.exception(localize('failed.writing.to.file', 'Failed writing to file {0}', queryFilePath), e);
        throw e;
    }
    return queryFilePath;
}

export async function loadIndexFile(replyPath: string): Promise<Index.IndexFile | null> {
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
    const fileContent = await tryReadFile(indexFilePath);
    if (!fileContent) {
        return null;
    }
    return JSON.parse(fileContent.toString()) as Index.IndexFile;
}

export async function loadCacheContent(filename: string): Promise<Map<string, cache.CacheEntry>> {
    const fileContent = await tryReadFile(filename);
    if (!fileContent) {
        return new Map();
    }
    const cmakeCacheContent = JSON.parse(fileContent.toString()) as Cache.CacheContent;

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

export async function loadCMakeFiles(filename: string): Promise<string[]> {
    const fileContent = await tryReadFile(filename);
    if (!fileContent) {
        return [];
    }
    const cmakeFilesContent = JSON.parse(fileContent.toString()) as CMakeFiles.Content;

    const expectedVersion = { major: 1, minor: 0 };
    const detectedVersion = cmakeFilesContent.version;
    if (detectedVersion.major !== expectedVersion.major || detectedVersion.minor < expectedVersion.minor) {
        log.warning(localize(
            'cmake.files.object.version',
            'CMake Files object version ({0}.{1}) of cmake-file-api is unexpected. Expecting ({2}.{3}).',
            detectedVersion.major,
            detectedVersion.minor,
            expectedVersion.major,
            expectedVersion.minor));
        return [];
    }

    return cmakeFilesContent.inputs.map(input => input.path);
}

function findPropertyValue(cacheElement: Cache.CMakeCacheEntry, name: string): string {
    const propertyElement = cacheElement.properties.find(prop => prop.name === name);
    return propertyElement ? propertyElement.value : '';
}

function convertFileApiCacheToExtensionCache(cmakeCacheContent: Cache.CacheContent): Map<string, cache.CacheEntry> {
    return cmakeCacheContent.entries.reduce((acc, el) => {
        const fileApiToExtensionCacheMap: { [key: string]: cache.CacheEntryType | undefined } = {
            BOOL: cache.CacheEntryType.Bool,
            STRING: cache.CacheEntryType.String,
            PATH: cache.CacheEntryType.Path,
            FILEPATH: cache.CacheEntryType.FilePath,
            INTERNAL: cache.CacheEntryType.Internal,
            UNINITIALIZED: cache.CacheEntryType.Uninitialized,
            STATIC: cache.CacheEntryType.Static
        };
        const type = fileApiToExtensionCacheMap[el.type];
        if (type === undefined) {
            log.warning(localize('cache.entry.unknowntype', 'Unknown cache entry type: {0}.', el.type));
            return acc;
        }
        const helpString = findPropertyValue(el, 'HELPSTRING');
        const advanced = findPropertyValue(el, 'ADVANCED');
        acc.set(el.name, new cache.CacheEntry(el.name, el.value, type, helpString, advanced === '1'));
        return acc;
    }, new Map<string, cache.CacheEntry>());
}

export async function loadCodeModelContent(filename: string): Promise<CodeModelKind.Content | null> {
    const fileContent = await tryReadFile(filename);
    if (!fileContent) {
        return null;
    }
    const codemodel = JSON.parse(fileContent.toString()) as CodeModelKind.Content;
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

export async function loadTargetObject(filename: string): Promise<CodeModelKind.TargetObject | null> {
    const fileContent = await tryReadFile(filename);
    if (!fileContent) {
        return null;
    }
    return JSON.parse(fileContent.toString()) as CodeModelKind.TargetObject;
}

async function convertTargetObjectFileToExtensionTarget(buildDirectory: string, filePath: string): Promise<Target | null> {
    const targetObject = await loadTargetObject(filePath);
    if (!targetObject) {
        return null;
    }

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
    } as RichTarget;
}

export async function loadAllTargetsForBuildTypeConfiguration(replyPath: string, buildDirectory: string, configuration: CodeModelKind.Configuration): Promise<{ name: string; targets: Target[] }> {
    const metaTargets = [];
    if (configuration.directories[0].hasInstallRule) {
        metaTargets.push({
            type: 'rich' as 'rich',
            name: 'install',
            filepath: localize('install.all.target', 'A special target to install all available targets'),
            targetType: 'META'
        });
    }
    const targetsList = await Promise.all(configuration.targets.map(t => convertTargetObjectFileToExtensionTarget(buildDirectory, path.join(replyPath, t.jsonFile))));

    return {
        name: configuration.name,
        targets: [...metaTargets, ...removeEmpty(targetsList)]
    };
}

export async function loadConfigurationTargetMap(replyPath: string, codeModelFileName: string): Promise<Map<string, Target[]>> {
    const codeModelContent = await loadCodeModelContent(path.join(replyPath, codeModelFileName));
    if (!codeModelContent) {
        return new Map();
    }
    const buildDirectory = codeModelContent.paths.build;
    const targets = await Promise.all(codeModelContent.configurations.map(
        config => loadAllTargetsForBuildTypeConfiguration(replyPath, buildDirectory, config)));
    return targets.reduce((acc, el) => {
        acc.set(el.name, el.targets);
        return acc;
    }, new Map<string, Target[]>());
}

function convertToAbsolutePath(inputPath: string, basePath: string) {
    // Prepend the base path to the input path if the input path is relative.
    const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(basePath, inputPath);
    return path.normalize(absolutePath);
}

function convertToExtCodeModelFileGroup(targetObject: CodeModelKind.TargetObject, rootPaths: CodeModelKind.PathInfo): CodeModelFileGroup[] {
    const fileGroup: CodeModelFileGroup[] = !targetObject.compileGroups ? [] : targetObject.compileGroups.map(group => {
        const compileCommandFragments = group.compileCommandFragments ? group.compileCommandFragments.map(frag => frag.fragment) : [];

        return {
            isGenerated: false,
            sources: [],
            language: group.language,
            includePath: group.includes ? group.includes : [],
            compileCommandFragments,
            defines: group.defines ? group.defines.map(define => define.define) : [],
            frameworks: group.frameworks
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

async function loadCodeModelTarget(rootPaths: CodeModelKind.PathInfo, jsonFile: string): Promise<CodeModelTarget | null> {
    const targetObject = await loadTargetObject(jsonFile);
    if (!targetObject) {
        return null;
    }

    const fileGroups = convertToExtCodeModelFileGroup(targetObject, rootPaths);

    // This implementation expects that there is only one sysroot in a target.
    // The ServerAPI only has provided one sysroot. In the FileAPI,
    // each compileGroup has its separate sysroot.
    let sysroot;
    if (targetObject.compileGroups) {
        const allSysroots = removeEmpty(targetObject.compileGroups.map(x => !!x.sysroot ? x.sysroot.path : undefined));
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

export async function loadProject(rootPaths: CodeModelKind.PathInfo, replyPath: string, projectIndex: number, configuration: CodeModelKind.Configuration) {
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

export async function loadConfig(paths: CodeModelKind.PathInfo, replyPath: string, configuration: CodeModelKind.Configuration) {
    const projects = await Promise.all((configuration.projects).map((_, index) => loadProject(paths, replyPath, index, configuration)));
    return { name: configuration.name, projects } as CodeModelConfiguration;
}

export async function loadExtCodeModelContent(replyPath: string, codeModelFileName: string): Promise<CodeModelContent | null> {
    const codeModelContent = await loadCodeModelContent(path.join(replyPath, codeModelFileName));
    if (!codeModelContent) {
        return null;
    }
    const configurations = await Promise.all(codeModelContent.configurations.map(config_element => loadConfig(codeModelContent.paths, replyPath, config_element)));

    return { configurations } as CodeModelContent;
}

export async function loadToolchains(filename: string): Promise<Map<string, CodeModelToolchain>> {
    const fileContent = await tryReadFile(filename);
    if (!fileContent) {
        return new Map();
    }
    const toolchains = JSON.parse(fileContent.toString()) as Toolchains.Content;

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
