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
  const defaultWorkspaceFolder = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
  const emptyWorkspaceFolder = getTestRootFilePath('test/unit-tests/cms-driver/workspace/empty_project');
  const badCommandWorkspaceFolder = getTestRootFilePath('test/unit-tests/cms-driver/workspace/bad_command');

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
    let isDone = false;
    if (!cleanupBuildDir(path.join(defaultWorkspaceFolder, 'build'))) {
      done('Default build folder still exists');
      isDone = true;
    }

    if (!cleanupBuildDir(path.join(emptyWorkspaceFolder, 'build'))) {
      if (!isDone) {
        done('Empty project build folder still exists');
        isDone = true;
      }
    }

    if (!cleanupBuildDir(path.join(badCommandWorkspaceFolder, 'build'))) {
      if (!isDone) {
        done('Bad command build folder still exists');
        isDone = true;
      }
    }

    if(!isDone)
      done();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(20000);
    if (driver) {
      return driver.asyncDispose();
    }
  });

  test(`All target for ${kitDefault.name}`, async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    const allTargetName = driver.allTargetName;
    if (process.platform === 'win32') {
      expect(allTargetName).to.eq('ALL_BUILD');
    } else {
      expect(allTargetName).to.eq('all');
    }
  }).timeout(60000);

  test('Check binary dir', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    expect(driver.binaryDir).to.endsWith('test/unit-tests/cms-driver/workspace/test_project/build');
  }).timeout(60000);

  test('Configure fails', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, badCommandWorkspaceFolder, async () => {}, []);
    expect(await driver.cleanConfigure([])).to.be.eq(1);
  }).timeout(90000);

  test('Build', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    expect(await driver.cleanConfigure([])).to.be.eq(0);
    expect(await driver.build(driver.allTargetName)).to.be.eq(0);

    expect(driver.executableTargets.length).to.be.eq(1);
    expect(driver.executableTargets[0].name).to.be.equal('TestBuildProcess');
    expect(fs.existsSync(driver.executableTargets[0].path)).to.be.true;
  }).timeout(90000);

  test('Configure fails on invalid preferred generator', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    const kit = {name: 'GCC', preferredGenerator: {name: 'BlaBla'}} as Kit;

    // tslint:disable-next-line: no-floating-promises
    expect(cms_driver.CMakeServerClientDriver.create(executable, config, kit, defaultWorkspaceFolder, async () => {}, []))
        .to.be.rejectedWith('No usable generator found.');
  }).timeout(60000);

  test('Throw exception on set kit without preferred generator found', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);

    await expect(driver.setKit({name: 'GCC'}, [])).to.be.rejectedWith('No usable generator found.');
  }).timeout(90000);

  test('Try build on empty dir', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.MissingCMakeListsFile);
      called = true;
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, emptyWorkspaceFolder, checkPreconditionHelper, []);
    expect(await driver.cleanConfigure([])).to.be.eq(-1);
    expect(called).to.be.true;
  }).timeout(60000);

  test('No parallel configuration', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      called = true;
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    const configure1 = driver.configure([]);
    const configure2 = driver.configure([]);

    expect(await configure1).to.be.equal(0);
    expect(await configure2).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No parallel clean configuration', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      called = true;
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    const configure1 = driver.cleanConfigure([]);
    const configure2 = driver.cleanConfigure([]);

    expect(await configure1).to.be.equal(0);
    expect(await configure2).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No parallel builds', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const build1 = driver.build(driver.allTargetName);
    const build2 = driver.build(driver.allTargetName);

    expect(await build1).to.be.equal(0);
    expect(await build2).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No build parallel to configure', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const configure = driver.configure([]);
    const build = driver.build(driver.allTargetName);

    expect(await configure).to.be.equal(0);
    expect(await build).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No configure parallel to build', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const build = driver.build(driver.allTargetName);
    const configure = driver.configure([]);

    expect(await build).to.be.equal(0);
    expect(await configure).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);

  test('No build parallel to clean configuration', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    const configure = driver.cleanConfigure([]);
    const build = driver.build(driver.allTargetName);

    expect(await configure).to.be.equal(0);
    expect(await build).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);


  test('No clean configuration parallel to build', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      if(e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
        called = true;
      }
    };
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
    expect(await driver.configure([])).to.be.equal(0);
    const build = driver.build(driver.allTargetName);
    const configure = driver.cleanConfigure([]);

    expect(await build).to.be.equal(0);
    expect(await configure).to.be.equal(-1);
    expect(called).to.be.true;
  }).timeout(90000);


  test('Test pre-configured workspace', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitNinja, defaultWorkspaceFolder, async () => {}, []);
    await driver.cleanConfigure([]);
    await driver.asyncDispose();

    driver = null;
    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    expect(await driver.configure([])).to.be.eq(0);
    expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq('Ninja');
  }).timeout(60000);

  test('Test generator switch', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    await driver.cleanConfigure([]);
    expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.not.eq('Ninja');

    await driver.setKit(kitNinja, [{name:'Ninja'}]);
    expect(await driver.configure([])).to.be.eq(0);
    expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq('Ninja');
  }).timeout(90000);

  test('Test extra arguments on configure', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    await driver.configure(['-DEXTRA_ARGS_TEST=Hallo']);
    expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')!.value).to.be.eq('Hallo');
  }).timeout(90000);

  test('Test extra arguments on clean and configure', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    await driver.cleanConfigure(['-DEXTRA_ARGS_TEST=Hallo']);
    expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')!.value).to.be.eq('Hallo');
  }).timeout(90000);

  test('Cancel build', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    expect(await driver.cleanConfigure(['-DDELAY_BUILD=1'])).to.be.equal(0);

    // Start build
    const build_prom = driver.build(driver.allTargetName);

    // Prepare delayed build cancel
    let cancel_prom: any;
    const d = driver;
    setTimeout(() => { cancel_prom = d.stopCurrentProcess(); }, 3000);

    // Wait for build
    const ret = await build_prom;

    // Check results
    await cancel_prom;
    expect(ret).to.be.not.eq(0);

    // Test driver is still working
    expect(await driver.configure([])).to.be.equal(0);
  }).timeout(90000);


  test('Stop and start cmake-server client', async () => {
    const config = ConfigurationReader.create();
    const executable = await getCMakeExecutableInformation(cmakePath);

    driver = await cms_driver.CMakeServerClientDriver
                 .create(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
    expect(await driver.configure([])).to.be.equal(0);
    await driver.stopCurrentProcess();
    expect(await driver.configure([])).to.be.equal(0);
  }).timeout(90000);
});
