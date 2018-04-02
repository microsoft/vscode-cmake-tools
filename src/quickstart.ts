import * as fsNode from 'fs';
import * as path from 'path';

import {fs} from './pr';

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

  constructor(readonly workingPath: string,
      readonly projectName: string,
      readonly type: ProjectType) {

    if (type == ProjectType.Exectable) {
      this.sourceCodeFilePath = path.join(this.workingPath, 'main.cpp');
    } else {
      this.sourceCodeFilePath = path.join(this.workingPath, `${projectName}.cpp`);
    }

    this.cmakeFilePath = path.join(this.workingPath, 'CMakeLists.txt');

    if (fsNode.existsSync(this.cmakeFilePath)) {
      throw Error('Source code directory contains already a CMakeLists.txt');
    }
  }

  private async createCMakeListFile() {
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

    return fs.writeFile(this.cmakeFilePath, init);
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

  private async createExampleSourcecodeFile() {
    if (!(await fs.exists(this.sourceCodeFilePath))) {
      switch (this.type) {
      case ProjectType.Library:
        return this.createLibrarySourceFile();
      case ProjectType.Exectable:
        return this.createMainSourceCodeFile();
      }
    }
  }

  public async createProject() {
    await this.createCMakeListFile();
    await this.createExampleSourcecodeFile();
  }
}