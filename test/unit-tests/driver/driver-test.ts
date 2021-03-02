import {CMakeExecutable, getCMakeExecutableInformation} from '@cmt/cmake/cmake-executable';
import {ConfigureTrigger} from '@cmt/cmake-tools';
import {ConfigurationReader} from '@cmt/config';
import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiString from 'chai-string';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import {CMakeFileApiDriver} from '@cmt/drivers/cmfileapi-driver';
import {CMakeServerClientDriver} from '@cmt/drivers/cms-driver';

chai.use(chaiString);

import {Kit, CMakeGenerator} from '@cmt/kit';
import {CMakePreconditionProblems, CMakeDriver, CMakePreconditionProblemSolver} from '@cmt/drivers/driver';

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

// tslint:disable-next-line: no-unused-expression

export function makeDriverTestsuite(driver_generator: (cmake: CMakeExecutable,
                                                       config: ConfigurationReader,
                                                       kit: Kit|null,
                                                       workspaceFolder: string|null,
                                                       preconditionHandler: CMakePreconditionProblemSolver,
                                                       preferredGenerators: CMakeGenerator[]) => Promise<CMakeDriver>) {
  let driver: CMakeDriver|null = null;
  // tslint:disable:no-unused-expression

  suite('CMake-Driver tests', () => {
    const cmakePath: string = process.env.CMAKE_EXECUTABLE ? process.env.CMAKE_EXECUTABLE : 'cmake';
    const defaultWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/test_project');
    const emptyWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/empty_project');
    const badCommandWorkspaceFolder = getTestRootFilePath('test/unit-tests/driver/workspace/bad_command');

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

    setup(async function(this: Mocha.Context, done) {
      driver = null;

      if (!cleanupBuildDir(path.join(defaultWorkspaceFolder, 'build'))) {
        done('Default build folder still exists');
      }

      if (!cleanupBuildDir(path.join(emptyWorkspaceFolder, 'build'))) {
        done('Empty project build folder still exists');
      }

      if (!cleanupBuildDir(path.join(badCommandWorkspaceFolder, 'build'))) {
        done('Bad command build folder still exists');
      }
      done();
    });

    teardown(async function(this: Mocha.Context) {
      this.timeout(20000);
      if (driver) {
        return driver.asyncDispose();
      }
    });

    test(`All target for ${kitDefault.name}`, async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
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

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      expect(driver.binaryDir).to.endsWith('test/unit-tests/driver/workspace/test_project/build');
    }).timeout(60000);

    test('Configure fails', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, badCommandWorkspaceFolder, async () => {}, []);
      expect(await driver.cleanConfigure(ConfigureTrigger.runTests, [])).to.be.eq(1);
    }).timeout(90000);

    test('Build', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      expect(await driver.cleanConfigure(ConfigureTrigger.runTests, [])).to.be.eq(0);
      expect(await driver.build(driver.allTargetName)).to.be.eq(0);

      expect(driver.executableTargets.length).to.be.eq(2);
      const targetInTopLevelBuildDir = driver.executableTargets.find(t => t.name == 'TestBuildProcess');
      expect(targetInTopLevelBuildDir).to.not.undefined;
      expect(fs.existsSync(targetInTopLevelBuildDir!.path)).to.be.true;

      const targetInRuntimeOutputDir = driver.executableTargets.find(t => t.name == 'TestBuildProcessOtherOutputDir');
      expect(targetInRuntimeOutputDir).to.not.undefined;
      expect(fs.existsSync(targetInRuntimeOutputDir!.path)).to.be.true;
    }).timeout(90000);

    test('Configure fails on invalid preferred generator', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      const kit = {name: 'GCC', preferredGenerator: {name: 'BlaBla'}} as Kit;

      // tslint:disable-next-line: no-floating-promises
      expect(driver_generator(executable, config, kit, defaultWorkspaceFolder, async () => {}, []))
          .to.be.rejectedWith('No usable generator found.');
    }).timeout(60000);

    test('Set kit without a preferred generator', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);

      // Set kit without a preferred generator
      await driver.setKit({name: 'GCC'}, []);
      expect(await driver.cleanConfigure(ConfigureTrigger.runTests, [])).to.be.eq(0);
      const kit1 = driver.cmakeCacheEntries?.get('CMAKE_GENERATOR')!.value;

      // Set kit with a list of two default preferred generators, for comparison
      await driver.setKit({name: 'GCC'}, [{name: 'Ninja'}, {name: 'Unix Makefiles'}]);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.eq(0);
      const kit2 = driver.cmakeCacheEntries?.get('CMAKE_GENERATOR')!.value;

      expect(kit1).to.be.equal(kit2);
    }).timeout(90000);

    test('Try build on empty dir', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      let called = false;
      const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
        expect(e).to.be.eq(CMakePreconditionProblems.MissingCMakeListsFile);
        called = true;
      };
      driver
          = await driver_generator(executable, config, kitDefault, emptyWorkspaceFolder, checkPreconditionHelper, []);
      expect(await driver.cleanConfigure(ConfigureTrigger.runTests, [])).to.be.eq(-2);
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
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      const configure1 = driver.configure(ConfigureTrigger.runTests, []);
      const configure2 = driver.configure(ConfigureTrigger.runTests, []);

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
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      const configure1 = driver.cleanConfigure(ConfigureTrigger.runTests, []);
      const configure2 = driver.cleanConfigure(ConfigureTrigger.runTests, []);

      expect(await configure1).to.be.equal(0);
      expect(await configure2).to.be.equal(-1);
      expect(called).to.be.true;
    }).timeout(90000);

    test('No parallel builds', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      let called = false;
      const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
        if (e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
          called = true;
        }
      };
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.equal(0);
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
        if (e == CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
          called = true;
        }
      };
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.equal(0);
      const configure = driver.configure(ConfigureTrigger.runTests, []);
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
        if (e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
          called = true;
        }
      };
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.equal(0);
      const build = driver.build(driver.allTargetName);
      const configure = driver.configure(ConfigureTrigger.runTests, []);

      expect(await build).to.be.equal(0);
      expect(await configure).to.be.equal(-1);
      expect(called).to.be.true;
    }).timeout(90000);

    test('No build parallel to clean configuration', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      let called = false;
      const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
        if (e == CMakePreconditionProblems.ConfigureIsAlreadyRunning) {
          called = true;
        }
      };
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      const configure = driver.cleanConfigure(ConfigureTrigger.runTests, []);
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
        if (e == CMakePreconditionProblems.BuildIsAlreadyRunning) {
          called = true;
        }
      };
      driver
          = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, checkPreconditionHelper, []);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.equal(0);
      const build = driver.build(driver.allTargetName);
      const configure = driver.cleanConfigure(ConfigureTrigger.runTests, []);

      expect(await build).to.be.equal(0);
      expect(await configure).to.be.equal(-1);
      expect(called).to.be.true;
    }).timeout(90000);


    test('Test pre-configured workspace', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitNinja, defaultWorkspaceFolder, async () => {}, []);
      await driver.cleanConfigure(ConfigureTrigger.runTests, []);
      await driver.asyncDispose();

      driver = null;
      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.eq(0);

      const expFileApi = driver instanceof CMakeFileApiDriver;
      const expSrv = driver instanceof CMakeServerClientDriver;
      expect (!expFileApi || !expSrv); // mutually exclusive

      // Configure with a different generator should overwrite the previous Ninja generator
      // for fileApi and not for cmakeServer communication modes.
      const kitBaseline = expFileApi ? kitDefault : kitNinja;
      expect(driver.generatorName).to.be.eq(kitBaseline.preferredGenerator!.name);
      expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq(kitBaseline.preferredGenerator!.name);
    }).timeout(60000);

    test('Test generator switch', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      await driver.cleanConfigure(ConfigureTrigger.runTests, []);
      expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.not.eq('Ninja');

      await driver.setKit(kitNinja, [{name: 'Ninja'}]);
      expect(await driver.configure(ConfigureTrigger.runTests, [])).to.be.eq(0);
      expect(driver.cmakeCacheEntries.get('CMAKE_GENERATOR')!.value).to.be.eq('Ninja');
    }).timeout(90000);

    test('Test Visual Studio kit with wrong all target name', async () => {
      if (process.platform !== 'win32')
        return;

      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      await driver.cleanConfigure(ConfigureTrigger.runTests, []);
      expect(await driver.build('all')).to.be.eq(0, 'Automatic correction of all target failed');
    }).timeout(90000);

    test('Test Ninja kit with wrong all target name', async () => {
      if (process.platform !== 'win32')
        return;
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitNinja, defaultWorkspaceFolder, async () => {}, []);
      await driver.cleanConfigure(ConfigureTrigger.runTests, []);
      expect(await driver.build('ALL_BUILD')).to.be.eq(0, 'Automatic correction of ALL_BUILD target failed');
    }).timeout(90000);

    test('Test extra arguments on configure', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      await driver.configure(ConfigureTrigger.runTests, ['-DEXTRA_ARGS_TEST=Hallo']);
      expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')!.value).to.be.eq('Hallo');
    }).timeout(90000);

    test('Test extra arguments on clean and configure', async () => {
      const config = ConfigurationReader.create();
      const executable = await getCMakeExecutableInformation(cmakePath);

      driver = await driver_generator(executable, config, kitDefault, defaultWorkspaceFolder, async () => {}, []);
      await driver.cleanConfigure(ConfigureTrigger.runTests, ['-DEXTRA_ARGS_TEST=Hallo']);
      expect(driver.cmakeCacheEntries.get('extraArgsEnvironment')!.value).to.be.eq('Hallo');
    }).timeout(90000);
  });
}