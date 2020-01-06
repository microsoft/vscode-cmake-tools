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
  'build': string;
  'source': string;
}
export interface Configuration {
  name: string;
  targets: Target[];
  directories: {source: string, build: string, hasInstallRule: boolean;}[];
  projects: {name: string; targetIndexes?: number[], directoryIndexes: number[]}[];
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

export interface CompileGroup {
  language: string;
  includes: {path: string;}[];
  defines: {define: string;}[];
  compileCommandFragments: {fragment: string;}[];
  sourceIndexes: number[];
  sysroot: {path:string;};
}

export interface TargetObject {
  name: string;
  type: string;
  artifacts: [{path: string}];
  nameOnDisk: string;
  paths: PathInfo;
  sources: {path: string; compileGroupIndex?: number, isGenerated?: boolean}[];
  compileGroups?: CompileGroup[];
}
}
