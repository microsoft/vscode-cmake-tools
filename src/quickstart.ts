import {CMakeToolsAPI} from '@cmt/api';
import {isCMakeListFilePresent} from '@cmt/util';
import {fs} from './pr';

import * as fsNode from 'fs';
import * as path from 'path';

export enum ProjectType {
  Library,
  Exectable
}

export interface ProjectTypeDesciptor {
  label: string;
  type: ProjectType;
  description: string;
}

export const projectTypeDescriptions: ProjectTypeDesciptor[] = [
  {label: 'Library', type: ProjectType.Library, description: 'Create a library'},
  {label: 'Executable', type: ProjectType.Exectable, description: 'Create an executable'}
];

export class CMakeQuickStart {

  public readonly cmakeFilePath: string;
  public readonly sourceCodeFilePath: string;

  constructor(readonly workingPath: string, readonly projectName: string, readonly type: ProjectType) {

    if (type == ProjectType.Exectable) {
      this.sourceCodeFilePath = path.join(this.workingPath, 'main.cpp');
    } else {
      this.sourceCodeFilePath = path.join(this.workingPath, `${projectName}.cpp`);
    }

    this.cmakeFilePath = path.join(this.workingPath, 'CMakeLists.txt');

  }

  private async createCMakeListFile() : Promise<boolean>{
    if (fsNode.existsSync(this.cmakeFilePath)) {
      return false;
    }

    const init = [
      'cmake_minimum_required(VERSION 3.0.0)',
      `project(${this.projectName} VERSION 0.1.0)`,
      '',
      'include(CTest)',
      'enable_testing()',
      '',
      this.type == ProjectType.Library ? `add_library(${this.projectName} ${this.projectName}.cpp)`
      : `add_executable(${this.projectName} main.cpp)`,
      '',
      'set(CPACK_PROJECT_NAME ${PROJECT_NAME})',
      'set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})',
      'include(CPack)',
      '',
    ].join('\n');

    await fs.writeFile(this.cmakeFilePath, init);

    return true;
  }

  private async createLibrarySourceFile() {
    return fs.writeFile(this.sourceCodeFilePath, [
      '#include <iostream>',
      '',
      'void say_hello(){',
      `    std::cout << "Hello, from ${this.projectName}!\\n";`,
      '}',
      '',
    ].join('\n'));
  }

  private async createMainSourceCodeFile() {
    return fs.writeFile(this.sourceCodeFilePath, [
      '#include <iostream>',
      '',
      'int main(int, char**) {',
      '   std::cout << "Hello, world!\\n";',
      '}',
      '',
    ].join('\n'));
  }

  private async createExampleSourcecodeFile() : Promise<boolean> {
    if (!(await fs.exists(this.sourceCodeFilePath))) {
      switch (this.type) {
      case ProjectType.Library:
        await this.createLibrarySourceFile();
        break;
      case ProjectType.Exectable:
        await this.createMainSourceCodeFile();
        break;
      }
      return true;
    } else {
      return false;
    }
  }

  public async createProject() : Promise<boolean>{
    let createdFiles = await this.createCMakeListFile();
    createdFiles = createdFiles && await this.createExampleSourcecodeFile();

    return createdFiles;
  }
}

export interface UiControlCallbacks {
  onProjectNameRequest: () => Promise<string|undefined>;
  onProjectTypeRequest: (items: ProjectTypeDesciptor[]) => Promise<ProjectTypeDesciptor|undefined>;
  onOpenSourceFiles: (filePaths: string) => void;
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

export async function runUiControl(workspaceFolders: string[],
                                         cmt: CMakeToolsAPI,
                                         callbacks: UiControlCallbacks): Promise<ControlErrors> {
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

  const helper = new CMakeQuickStart(sourcePath, projectName, projectType.type);
  if( !await helper.createProject()) {
    callbacks.onWarning('Not all files are created, because they exist already.');
  }

  callbacks.onOpenSourceFiles(helper.sourceCodeFilePath);

  await cmt.configure();
  return ControlErrors.NONE;
}