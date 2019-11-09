import {getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import {ConfigurationReader} from '@cmt/config';
import * as cms_driver from '@cmt/drivers/cms-driver';
import * as codemodel_api from '@cmt/drivers/codemodel-driver-interface';
import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiString from 'chai-string';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';

chai.use(chaiString);

import {Kit} from '@cmt/kit';
import {CMakeDriver} from '@cmt/drivers/driver';

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

suite('CMake-Server-Driver tests', () => {
  const cmakePath: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';
  const workspacePath: string = 'test/unit-tests/cms-driver/workspace';
  const root = getTestRootFilePath(workspacePath);
  const defaultWorkspaceFolder = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
  const emptyWorkspaceFolder = getTestRootFilePath('test/unit-tests/cms-driver/workspace/empty_project');

  let kitDefault: Kit;
  if (process.platform === 'win32') {
    kitDefault = {
      name: 'Visual Studio Community 2017 - amd64',
      visualStudio: 'VisualStudio.15.0',
      visualStudioArchitecture: 'amd64',
      preferredGenerator: {name: 'Visual Studio 15 2017', platform: 'x64'}
    } as Kit;
  } else {
    kitDefault = {name: 'GCC', compilers: {C: 'gcc', CXX: 'g++'}, preferredGenerator: {name: 'Unix Makefiles'}} as Kit;
  }

  setup(async function(this: Mocha.IBeforeAndAfterContext, done) {
    driver = null;

    if (!cleanupBuildDir(path.join(defaultWorkspaceFolder, 'build'))) {
      done('Default build folder still exists');
    }

    if (!cleanupBuildDir(path.join(emptyWorkspaceFolder, 'build'))) {
      done('Empty project build folder still exists');
    }
    done();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(20000);
    if (driver) {
      return driver.asyncDispose();
    }
  });

  test('Test generation of code model with multi configuration like VS', async () => {
    if (process.platform !== 'win32')
      return;

    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    let codemodel_data: null|codemodel_api.CodeModelContent = null;
    if (driver instanceof codemodel_api.CodeModelDriver) {
      driver.onCodeModelChanged(cm => { codemodel_data = cm; });
    }
    await driver.configure([]);
    expect(codemodel_data).to.be.not.null;
    expect(codemodel_data!.configurations.length).to.be.eql(4);
  }).timeout(90000);

  test('Test project information', async () => {
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    let codemodel_data: null|codemodel_api.CodeModelContent = null;
    if (driver instanceof codemodel_api.CodeModelDriver) {
      driver.onCodeModelChanged(cm => { codemodel_data = cm; });
    }
    await driver.configure([]);
    expect(codemodel_data).to.be.not.null;

    const project = codemodel_data!.configurations[0].projects[0];

    // Test project name
    expect(project.name).to.be.eq('TestBuildProcess');

    // Test location of project source directory
    // Used by tree view to make paths relative
    expect(path.normalize(project.sourceDirectory).toLowerCase())
        .to.eq(path.normalize(path.join(root, 'test_project')).toLowerCase());
  }).timeout(90000);


  test('Test first executable target directory', async () => {
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    let codemodel_data: null|codemodel_api.CodeModelContent = null;
    if (driver instanceof codemodel_api.CodeModelDriver) {
      driver.onCodeModelChanged(cm => { codemodel_data = cm; });
    }
    await driver.configure([]);
    expect(codemodel_data).to.be.not.null;

    const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'EXECUTABLE');
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
    expect(target!.fileGroups![0].sources[0]).to.eq('main.cpp');
  }).timeout(90000);

  test('Test first static library target directory', async () => {
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    let codemodel_data: null|codemodel_api.CodeModelContent = null;
    if (driver instanceof codemodel_api.CodeModelDriver) {
      driver.onCodeModelChanged(cm => { codemodel_data = cm; });
    }
    await driver.configure([]);
    expect(codemodel_data).to.be.not.null;

    const target = codemodel_data!.configurations[0].projects[0].targets.find(t => t.type == 'STATIC_LIBRARY');
    expect(target).to.be.not.undefined;

    // Test target name used for node label
    expect(target!.name).to.be.eq('Test');
    const executableName = process.platform === 'win32' ? 'Test.lib' : 'libTest.a';
    expect(target!.fullName).to.be.eq(executableName);
    expect(target!.type).to.be.eq('STATIC_LIBRARY');

    // Test location of project source directory
    // Used by tree view to make paths relative
    expect(path.normalize(target!.sourceDirectory!).toLowerCase())
        .to.eq(path.normalize(path.join(root, 'test_project', 'dir1')).toLowerCase());

    // Test main source file
    expect(target!.fileGroups).to.be.not.undefined;
    expect(target!.fileGroups![0].sources[0]).to.eq('info.cpp');
    expect(target!.fileGroups![0].sources[1]).to.eq('test2.cpp');
  }).timeout(90000);

  test('Test generation of code model with one configuration like make on linux', async () => {
    if (process.platform === 'win32')
      return;

    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    let codemodel_data: null|codemodel_api.CodeModelContent = null;
    if (driver instanceof codemodel_api.CodeModelDriver) {
      driver.onCodeModelChanged(cm => { codemodel_data = cm; });
    }
    await driver.configure([]);
    expect(codemodel_data).to.be.not.null;
    expect(codemodel_data!.configurations.length).to.be.eql(1);
  }).timeout(90000);
});
