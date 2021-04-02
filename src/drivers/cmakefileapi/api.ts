/**
 * This module defines the cmake file API for typescript. This makes the use of
 * the FileAPI simpler to use.
 *
 * For details see (cmake-file-api(7))[https://cmake.org/cmake/help/v3.15/manual/cmake-file-api.7.html].
 * This file implements only the now required structures.
 */ /** */
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

export interface CompileGroup {
  language: string;
  includes: IncludeMetadata[];
  defines: PreprocessorDefinitionMetadata[];
  compileCommandFragments: CompileCommandFragments[];
  sourceIndexes: number[];
  sysroot: SysRoot;
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
