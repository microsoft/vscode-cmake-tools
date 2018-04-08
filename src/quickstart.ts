import * as path from 'path';

import {CMakeToolsAPI} from './api';
import * as logging from './logging';
import {fs} from './pr';
import {isCMakeListFilePresent} from './util';

const log = logging.createLogger('quickstart');

export enum ProjectType {
  Library,
  Exectable
}

export interface ProjectTypeDesciption {
  label: string;
  type: ProjectType;
  description: string;
}

export const projectTypeDescriptions: ProjectTypeDesciption[] = [
  {label: 'Library', type: ProjectType.Library, description: 'Create a library'},
  {label: 'Executable', type: ProjectType.Exectable, description: 'Create an executable'}
];

export interface CreateProjectInformation {
  name: string;
  type: ProjectType;
  sourceDirectory: string;
}

export interface GeneratedProjectFiles {
  cmakeListFile: string;
  sourceFiles: string[];
}

async function createCMakeListFile(projectInformation: CreateProjectInformation): Promise<string> {
  const cmakeFilePath = path.join(projectInformation.sourceDirectory, 'CMakeLists.txt');
  if (await fs.exists(cmakeFilePath)) {
    throw new Error('Source code directory contains already a CMakeLists.txt');
  }

  const init = [
    'cmake_minimum_required(VERSION 3.0.0)',
    `project(${projectInformation.name} VERSION 0.1.0)`,
    '',
    'include(CTest)',
    'enable_testing()',
    '',
    projectInformation.type == ProjectType.Library
        ? `add_library(${projectInformation.name} ${projectInformation.name}.cpp)`
        : `add_executable(${projectInformation.name} main.cpp)`,
    '',
    'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
    'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
    'include(CPack)',
    '',
  ].join('\n');

  await fs.writeFile(cmakeFilePath, init);

  return cmakeFilePath;
}

async function createLibrarySourceFile(projectInformation: CreateProjectInformation): Promise<string> {
  const sourceCodeFilePath = path.join(projectInformation.sourceDirectory, `${projectInformation.name}.cpp`);
  if (await fs.exists(sourceCodeFilePath)) {
    throw new Error('Library source file is already present.');
  }

  await fs.writeFile(sourceCodeFilePath, [
    '#include <iostream>',
    '',
    'void say_hello(){',
    `    std::cout << "Hello, from ${projectInformation.name}!\\n";`,
    '}',
    '',
  ].join('\n'));
  return sourceCodeFilePath;
}

async function createMainSourceCodeFile(projectInformation: CreateProjectInformation) {
  const sourceCodeFilePath = path.join(projectInformation.sourceDirectory, 'main.cpp');
  if (await fs.exists(sourceCodeFilePath)) {
    throw new Error('Main source file is already present.');
  }

  await fs.writeFile(sourceCodeFilePath, [
    '#include <iostream>',
    '',
    'int main(int, char**) {',
    '   std::cout << "Hello, world!\\n";',
    '}',
    '',
  ].join('\n'));

  return sourceCodeFilePath;
}

export async function createProject(projectInformation: CreateProjectInformation):
    Promise<GeneratedProjectFiles> {
  const cmakeFile = await createCMakeListFile(projectInformation);

  let sourceFile: string = '';
  try {
    if (projectInformation.type == ProjectType.Exectable) {
      sourceFile = await createMainSourceCodeFile(projectInformation);
    } else if (projectInformation.type == ProjectType.Library) {
      sourceFile = await createLibrarySourceFile(projectInformation);
    }
  } catch (err) { log.debug(err); }

  return {cmakeListFile: cmakeFile, sourceFiles: [sourceFile]} as GeneratedProjectFiles;
}

export interface UiControlCallbacks {
  onProjectNameRequest: () => Promise<string|undefined>;
  onProjectTypeRequest: (items: ProjectTypeDesciption[]) => Promise<ProjectTypeDesciption|undefined>;
  onOpenSourceFiles: (filePaths: GeneratedProjectFiles) => Promise<void>;
  onError: (message: string) => void;
  onWarning: (message: string) => void;
}

export enum ControlErrors {
  NONE = 0,
  NO_FOLDER = -1,
  PRESENT_CMAKELISTFILE = -2,
  EMPTY_FIELD,
  PRE_EXISTING_FILES
}

export async function runUiControl(workspaceFolders: string[], cmt: CMakeToolsAPI, callbacks: UiControlCallbacks):
    Promise<ControlErrors> {
  if (workspaceFolders.length == 0) {
    callbacks.onError('CMake Quick Start: No open folder found.');
    return ControlErrors.NO_FOLDER;
  }

  const sourcePath = workspaceFolders[0];
  if (await isCMakeListFilePresent(sourcePath)) {
    callbacks.onError('Source code directory contains already a CMakeLists.txt');
    return ControlErrors.PRESENT_CMAKELISTFILE;
  }

  const projectName = await callbacks.onProjectNameRequest();
  if (!projectName) {
    return ControlErrors.EMPTY_FIELD;
  }

  const projectType = await callbacks.onProjectTypeRequest(projectTypeDescriptions);
  if (!projectType) {
    return ControlErrors.EMPTY_FIELD;
  }

  const project: CreateProjectInformation
      = {name: projectName, type: projectType.type, sourceDirectory: sourcePath};

  const projectFiles = await createProject(project);
  await callbacks.onOpenSourceFiles(projectFiles);

  await cmt.configure();
  return ControlErrors.NONE;
}