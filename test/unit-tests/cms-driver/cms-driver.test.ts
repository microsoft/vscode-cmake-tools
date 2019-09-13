import {getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import * as cms_driver from '@cmt/drivers/cms-driver';
import {ConfigurationReader} from '@cmt/config';
import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiString from 'chai-string';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';

chai.use(chaiString);

import {Kit} from '@cmt/kit';
import {CMakePreconditionProblems, CMakeDriver} from '@cmt/drivers/driver';

const here = __dirname;
function getTestRootFilePath(filename: string): string {
  return path.normalize(path.join(here, '../../../..', filename));
}

let driver: CMakeDriver|null = null;
// tslint:disable:no-unused-expression

suite('CMake-Server-Driver tests', () => {
  const cmakePath: string = process.env.CMAKE_EXECUTABLE? process.env.CMAKE_EXECUTABLE: 'cmake';
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

  let kitNinja: Kit;
  if (process.platform === 'win32') {
    kitNinja = {
      name: 'Visual Studio Community 2017 - amd64',
      visualStudio: 'VisualStudio.15.0',
      visualStudioArchitecture: 'amd64',
      preferredGenerator: {name: 'Ninja'}
    } as Kit;
  } else {
    kitNinja = {name: 'GCC', compilers: {C: 'gcc', CXX: 'g++'}, preferredGenerator: {name: 'Ninja'}} as Kit;
  }

  setup(async function(this: Mocha.IBeforeAndAfterContext, done) {
    driver = null;
    const build_dir = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project/build');
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

  test(`All target for ${kitDefault.name}`, async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    const allTargetName = driver.allTargetName;
    if (process.platform === 'win32') {
      expect(allTargetName).to.eq('ALL_BUILD');
    } else {
      expect(allTargetName).to.eq('all');
    }
  }).timeout(60000);

  test('Check binary dir', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    expect(driver.binaryDir).to.endsWith('test/unit-tests/cms-driver/workspace/test_project/build');
  }).timeout(60000);

  test('Build', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);
    expect(executable.isFileApiModSupported).to.be.true;

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    expect(await driver.cleanConfigure([])).to.be.eq(0);
    expect(await driver.build(driver.allTargetName)).to.be.eq(0);

    expect(driver.executableTargets.length).to.be.eq(1);
    expect(driver.executableTargets[0].name).to.be.equal('TestBuildProcess');
    expect(fs.existsSync(driver.executableTargets[0].path)).to.be.true;
  }).timeout(90000);

  test('Configure fails on invalid preferred generator', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    const kit = {name: 'GCC', preferredGenerator: {name: 'BlaBla'}} as Kit;

    // tslint:disable-next-line: no-floating-promises
    expect(cms_driver.CMakeServerClientDriver.create(executable, config, kit, projectRoot, async () => {}, []))
        .to.be.rejectedWith('No usable generator found.');
  }).timeout(60000);

  test('Try build on empty dir', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/empty_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.MissingCMakeListsFile);
      called = true;
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    expect(await driver.cleanConfigure([])).to.be.eq(-1);
    expect(called).to.be.true;
  }).timeout(60000);

  test('No parallel configuration', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      called = true;
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    const configure1 = driver.configure([]);
    const configure2 = driver.configure([]);

    expect(await configure1).to.be.equal(0);
    expect(await configure2).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No parallel clean configuration', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      called = true;
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    const configure1 = driver.cleanConfigure([]);
    const configure2 = driver.cleanConfigure([]);

    expect(await configure1).to.be.equal(0);
    expect(await configure2).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No parallel builds', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation('cmake');

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const build1 = driver.build(driver.allTargetName);
    const build2 = driver.build(driver.allTargetName);

    expect(await build1).to.be.equal(0);
    expect(await build2).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No build parallel to configure', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation('cmake');

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const configure = driver.configure([]);
    const build = driver.build(driver.allTargetName);

    expect(await configure).to.be.equal(0);
    expect(await build).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No configure parallel to build', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation('cmake');

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const build = driver.build(driver.allTargetName);
    const configure = driver.configure([]);

    expect(await build).to.be.equal(0);
    expect(await configure).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No build parallel to clean configuration', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation('cmake');

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    const configure = driver.cleanConfigure([]);
    const build = driver.build(driver.allTargetName);

    expect(await configure).to.be.equal(0);
    expect(await build).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);


  test('No clean configuration parallel to build', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation('cmake');

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const build = driver.build(driver.allTargetName);
    const configure = driver.cleanConfigure([]);

    expect(await build).to.be.equal(0);
    expect(await configure).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);


  test('Test preconfigured workspace', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitNinja, projectRoot, async () => {}, []);
    await driver.cleanConfigure([]);
    await driver.asyncDispose();

    driver = null;
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    expect(await driver.configure([])).to.be.eq(0);
    expect(driver.generatorName).to.be.eq(kitNinja.preferredGenerator!.name);
    expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq('Ninja');
  }).timeout(60000);

  test('Test generator switch', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    await driver.cleanConfigure([]);
    expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.not.eq('Ninja');
    await driver.asyncDispose();
    driver = null;

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitNinja, projectRoot, async () => {}, []);
    expect(await driver.cleanConfigure([])).to.be.eq(0);
    expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq('Ninja');
  }).timeout(90000);

  test('Test extra arguments on configure', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    await driver.configure(['-DEXTRA_ARGS_TEST=Hallo']);
    expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')!.value).to.be.eq('Hallo');
  }).timeout(90000);

  test('Test extra arguments on clean and configure', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const projectRoot = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const config = ConfigurationReader.createForDirectory(root);
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, projectRoot, async () => {}, []);
    await driver.cleanConfigure(['-DEXTRA_ARGS_TEST=Hallo']);
    expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')!.value).to.be.eq('Hallo');
  }).timeout(90000);
});
