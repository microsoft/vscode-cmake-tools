import {CMakeExecutable, getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import {ConfigurationReader} from '@cmt/config';
import {ConfigureTrigger} from '@cmt/cmake-tools';
import * as codemodel_api from '@cmt/drivers/codemodel-driver-interface';
import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiString from 'chai-string';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';

chai.use(chaiString);

import {Kit, CMakeGenerator} from '@cmt/kit';
import {CMakeDriver, CMakePreconditionProblemSolver} from '@cmt/drivers/driver';

const here = __dirname;
function getTestRootFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../..', filename));
}

function cleanupBuildDir(build_dir: string): boolean {
  if (fs.existsSync(build_dir)) {
    rimraf.sync(build_dir);
  }
  return !fs.existsSync(build_dir);
}

let driver: CMakeDriver|null = null;
// tslint:disable:no-unused-expression

export function makeCodeModelDriverTestsuite(
    driver_generator: (cmake: CMakeExecutable,
                       config: ConfigurationReader,
                       kit: Kit|null,
                       workspaceFolder: string|null,
                       preconditionHandler: CMakePreconditionProblemSolver,
                       preferredGenerators: CMakeGenerator[]) => Promise<CMakeDriver>) {
  suite('CMake-CodeModel-Driver tests', () => {
    const cmakePath: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';
    const workspacePath: string = 'test/unit-tests/driver/workspace';
    const root = getTestRootFilePath(workspacePath);
    const defaultWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/test_project');
    const emptyWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/empty_project');

    let kitDefault: Kit;
    if (process.platform === 'win32') {
      kitDefault = {
        name: 'Visual Studio Community 2017 - amd64',
        visualStudio: 'VisualStudio.15.0',
        visualStudioArchitecture: 'amd64',
        preferredGenerator: {name: 'Visual Studio 15 2017', platform: 'x64'}
      } as Kit;
    } else {
      kitDefault
          = {name: 'GCC', compilers: {C: 'gcc', CXX: 'g++'}, preferredGenerator: {name: 'Unix Makefiles'}} as Kit;
    }

    setup(async function(this: Mocha.Context, done) {
      driver = null;

      if (!cleanupBuildDir(path.join(defaultWorkspaceFolder, 'build'))) {
        done('Default build folder still exists');
      }

      if (!cleanupBuildDir(path.join(emptyWorkspaceFolder, 'build'))) {
        done('Empty project build folder still exists');
      }
      done();
    });

    teardown(async function(this: Mocha.Context) {
      this.timeout(20000);
      if (driver) {
        return driver.asyncDispose();
      }
    });


    async function generateCodeModelForConfiguredDriver(args: string[] =
                                                            []): Promise<null|codemodel_api.CodeModelContent> {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      let code_model: null|codemodel_api.CodeModelContent = null;
      if (driver instanceof codemodel_api.CodeModelDriver) {
        driver.onCodeModelChanged(cm => { code_model = cm; });
      }
      expect(await driver.configure(ConfigureTrigger.runTests, args)).to.be.eq(0);
      return code_model;
    }

    test('Test generation of code model with multi configuration like VS', async () => {
      if (process.platform !== 'win32')
        return;

      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;
      expect(codemodel_data!.configurations.length).to.be.eql(4);
    }).timeout(90000);

    test('Test generation of code model with one configuration like make on linux', async () => {
      if (process.platform === 'win32')
        return;

      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;
      expect(codemodel_data!.configurations.length).to.be.eql(1);
    }).timeout(90000);

    test('Test project information', async () => {
      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;

      const project = codemodel_data!.configurations[0].projects[0];

      // Test project name
      expect(project.name).to.be.eq('TestBuildProcess');

      // Test location of project source directory
      // Used by tree view to make paths relative
      expect(path.normalize(project.sourceDirectory).toLowerCase())
          .to.eq(path.normalize(path.join(root, 'test_project')).toLowerCase());
    }).timeout(90000);


    test('Test executable target information', async () => {
      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;

      const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'EXECUTABLE' && t.name == 'TestBuildProcess');
      expect(target).to.be.not.undefined;

      // Test target name used for node label
      expect(target!.name).to.be.eq('TestBuildProcess');
      const executableName = process.platform === 'win32' ? 'TestBuildProcess.exe' : 'TestBuildProcess';
      expect(target!.fullName).to.be.eq(executableName);
      expect(target!.type).to.be.eq('EXECUTABLE');

      // Test location of project source directory
      // used by tree view to make paths relative
      expect(path.normalize(target!.sourceDirectory!).toLowerCase())
          .to.eq(path.normalize(path.join(root, 'test_project')).toLowerCase());

      // Test main source file used in by tree view
      expect(target!.fileGroups).to.be.not.undefined;
      const compile_information = target!.fileGroups!.find(t => !!t.language);

      expect(compile_information).to.be.not.undefined;
      expect(compile_information!.sources).to.include('main.cpp');
    }).timeout(90000);

    test('Test first static library target directory', async () => {
      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;

      const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'STATIC_LIBRARY');
      expect(target).to.be.not.undefined;

      // Test target name used for node label
      expect(target!.name).to.be.eq('StaticLibDummy');
      const executableName = process.platform === 'win32' ? 'StaticLibDummy.lib' : 'libStaticLibDummy.a';
      expect(target!.fullName).to.be.eq(executableName);
      expect(target!.type).to.be.eq('STATIC_LIBRARY');

      // Test location of project source directory
      // Used by tree view to make paths relative
      expect(path.normalize(target!.sourceDirectory!).toLowerCase())
          .to.eq(path.normalize(path.join(root, 'test_project', 'static_lib_dummy')).toLowerCase());

      // Language
      const compile_information = target!.fileGroups!.find(t => !!t.language);
      expect(compile_information).to.be.not.undefined;
      expect(compile_information!.language).to.eq('CXX');

      // Test main source file
      expect(compile_information!.sources).to.include('info.cpp');
      expect(compile_information!.sources).to.include('test2.cpp');

      // compile flags for file groups
      if (process.platform === 'win32') {
        expect(compile_information!.compileFlags).to.eq('/DWIN32 /D_WINDOWS /W3 /GR /EHsc /MDd /Zi /Ob0 /Od /RTC1  ');
      }
    }).timeout(90000);

    test('Test first shared library target directory', async () => {
      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;

      const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'SHARED_LIBRARY');
      expect(target).to.be.not.undefined;

      // Test target name used for node label
      expect(target!.name).to.be.eq('SharedLibDummy');
      const executableNameRegex
          = process.platform === 'win32' ? /^SharedLibDummy.dll/ : /^libSharedLibDummy.(so|dylib)/;
      expect(target!.fullName).to.match(executableNameRegex);
      expect(target!.type).to.be.eq('SHARED_LIBRARY');

      // Test location of project source directory
      // Used by tree view to make paths relative
      expect(path.normalize(target!.sourceDirectory!).toLowerCase())
          .to.eq(path.normalize(path.join(root, 'test_project', 'shared_lib_dummy')).toLowerCase());

      // Test main source file
      expect(target!.fileGroups).to.be.not.undefined;
      expect(target!.fileGroups![0].sources[0]).to.eq('src/info.c');
      expect(target!.fileGroups![0].defines).contains('TEST_CMAKE_DEFINE');
      expect(target!.fileGroups![0].isGenerated).to.be.false;
      expect(path.normalize(target!.fileGroups![0].includePath![0].path).toLowerCase())
          .to.eq(path.normalize(path.join(root, 'test_project', 'shared_lib_dummy', 'inc')).toLowerCase());

      // Language
      expect(target!.fileGroups![0].language).to.eq('C');

      // compile flags for file groups
      if (process.platform === 'win32') {
        expect(target!.fileGroups![0].compileFlags).to.eq('/DWIN32 /D_WINDOWS /W3 /MDd /Zi /Ob0 /Od /RTC1  ');
      }
    }).timeout(90000);

    test('Test cache access', async () => {
      const codemodel_data = await generateCodeModelForConfiguredDriver();
      expect(codemodel_data).to.be.not.null;

      const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'UTILITY'
                                                                                    && t.name == 'runTestTarget');
      expect(target).to.be.not.undefined;

      // maybe could be used to exclude file list from utility targets
      expect(target!.fileGroups![0].isGenerated).to.be.true;
    }).timeout(90000);

    test('Test sysroot access', async () => {
      // This test does not work with VisualStudio.
      // VisualStudio generator does not provide the sysroot in the code model.
      // macOS has separate sysroot variable (see CMAKE_OSX_SYSROOT); this build fails.
      if (process.platform === 'win32' || process.platform === 'darwin')
        return;

      const codemodel_data = await generateCodeModelForConfiguredDriver(['-DCMAKE_SYSROOT=/tmp']);
      expect(codemodel_data).to.be.not.null;

      const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'EXECUTABLE');
      expect(target).to.be.not.undefined;
      expect(target!.sysroot).to.be.eq('/tmp');
    }).timeout(90000);
  });
}
