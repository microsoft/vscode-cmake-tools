import {getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import {ConfigurationReader} from '@cmt/config';
import * as cmfile_driver from '@cmt/drivers/cmfileapi-driver';
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

let driver: CMakeDriver|null = null;
// tslint:disable:no-unused-expression

if (process.platform === 'win32') {
  suite('CMake-FileApi-Driver tests', () => {
    const cmake_path: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';

    let kitVS: Kit;
    kitVS = {
      name: 'Visual Studio Community 2017 - amd64',
      visualStudio: 'VisualStudio.15.0',
      visualStudioArchitecture: 'amd64',
      preferredGenerator: {name: 'Visual Studio 15 2017', platform: 'x64'}
    } as Kit;

    let kitNinja: Kit;
    kitNinja = {
      name: 'Visual Studio Community 2017 - amd64',
      visualStudio: 'VisualStudio.15.0',
      visualStudioArchitecture: 'amd64',
      preferredGenerator: {name: 'Ninja'}
    } as Kit;

    setup(async function(this: Mocha.IBeforeAndAfterContext, done) {
      const build_dir = getTestRootFilePath('test/unit-tests/cmfileapi-driver/workspace/test_project/build');
      if (fs.existsSync(build_dir)) {
        rimraf.sync(build_dir);
      }
      if (fs.existsSync(build_dir)) {
        done('Build folder still exists');
      }
      done();
    });

    teardown(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(20000);
      if (driver) {
        return driver.asyncDispose();
      }
    });


    test('Test kit with wrong all target name for Visual Studio', async () => {
      const root = getTestRootFilePath('test/unit-tests/cmfileapi-driver/workspace');
      const project_root = getTestRootFilePath('test/unit-tests/cmfileapi-driver/workspace/test_project');
      const config = ConfigurationReader.createForDirectory(root);
      const executeable = await getCMakeExecutableInformation(cmake_path);

      driver
          = await cmfile_driver.CMakeFileApiDriver.create(executeable, config, kitVS, project_root, async () => {}, []);
      await driver.cleanConfigure([]);
      expect(await driver.build('all')).to.be.eq(0, 'Automatic correction of all target failed');
    }).timeout(90000);

    test('Test kit switch with wrong all target name for Ninja', async () => {
      const root = getTestRootFilePath('test/unit-tests/cmfileapi-driver/workspace');
      const project_root = getTestRootFilePath('test/unit-tests/cmfileapi-driver/workspace/test_project');
      const config = ConfigurationReader.createForDirectory(root);
      const executeable = await getCMakeExecutableInformation(cmake_path);

      driver = await cmfile_driver.CMakeFileApiDriver
                   .create(executeable, config, kitNinja, project_root, async () => {}, []);
      await driver.cleanConfigure([]);
      expect(await driver.build('ALL_BUILD')).to.be.eq(0, 'Automatic correction of ALL_BUILD target failed');
    }).timeout(90000);
  });
}