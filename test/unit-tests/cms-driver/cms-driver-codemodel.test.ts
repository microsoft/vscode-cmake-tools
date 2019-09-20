import {getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import * as cms_driver from '@cmt/drivers/cms-driver';
import * as codemodel_api from '@cmt/drivers/codemodel-driver-interface';
import {ConfigurationReader} from '@cmt/config';
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
  const cmakePath: string = process.env.CMAKE_EXECUTABLE? process.env.CMAKE_EXECUTABLE: 'cmake';
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

  test('Test generation of code model', async () => {
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    let codemodel_data: null | codemodel_api.CodeModelContent = null;
    if (driver instanceof codemodel_api.CodeModelDriver) {
      driver.onCodeModelChanged(cm => { codemodel_data = cm; });
    }
    await driver.configure([]);
    expect(codemodel_data).to.be.not.null;
    expect(codemodel_data!.configurations.length).to.be.eql(4);
  }).timeout(90000);
});
