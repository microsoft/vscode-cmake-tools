import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiString from 'chai-string';
import * as path from 'path';
import * as fs from 'fs';
import * as rimraf from 'rimraf';

import * as cms_driver from '@cmt/cms-driver';
import { FakeContextDefinition } from '@test/helpers/vscodefake/extensioncontext';
import { ConfigurationReader } from '@cmt/config';
import { DirectoryContext } from '@cmt/workspace';
import { StateManager } from '@cmt/state';
import { getCMakeExecutableInformation } from '@cmt/cmake/cmake-executable';

chai.use(chaiString);

import { Kit } from '@cmt/kit';
import { CMakePreconditionProblems } from '@cmt/driver';

const here = __dirname;
function getTestRootFilePath(filename: string): string {
  return path.normalize(path.join(here, "../../../..", filename));
}

// tslint:disable:no-unused-expression

suite('CMake-Server-Driver tests', () => {
  let kitDefault: Kit;
  if (process.platform === "win32") {
    kitDefault = {
      name: "Visual Studio Community 2017 - amd64",
      visualStudio: "VisualStudio.15.0",
      visualStudioArchitecture: "amd64",
      preferredGenerator: {
        name: "Visual Studio 15 2017",
        platform: "x64"
      }
    } as Kit;
  } else {
    kitDefault = {
      name: "GCC",
      compilers: {
        C: "gcc",
        CXX: "g++"
      },
      preferredGenerator: {
        name: "Unix Makefiles"
      }
    } as Kit;
  }

  let kitNinja: Kit;
  if (process.platform === "win32") {
    kitNinja = {
      name: "Visual Studio Community 2017 - amd64",
      visualStudio: "VisualStudio.15.0",
      visualStudioArchitecture: "amd64",
      preferredGenerator: {
        name: "Ninja"
      }
    } as Kit;
  } else {
    kitNinja = {
      name: "GCC",
      compilers: {
        C: "gcc",
        CXX: "g++"
      },
      preferredGenerator: {
        name: "Ninja"
      }
    } as Kit;
  }

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    const build_dir = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project/build');
    if(fs.existsSync(build_dir)) {
      rimraf.sync(build_dir);
    }
  });

  test(`All target for ${kitDefault.name}`, async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, async () => {}, []);
    const allTargetName = d.allTargetName;
    if (process.platform === "win32") {
      expect(allTargetName).to.eq('ALL_BUILD');
    } else {
      expect(allTargetName).to.eq('all');
    }

    d.dispose();
  }).timeout(60000);

  test('Check binary dir', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, async () => {}, []);
    expect(d.binaryDir).to.endsWith('test/unit-tests/cms-driver/workspace/test_project/build');
    d.dispose();
  }).timeout(60000);

  test('Build', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, async () => {}, []);
    expect(await d.cleanConfigure()).to.be.eq(0);
    expect(await d.build(d.allTargetName)).to.be.eq(0);

    expect(d.executableTargets.length).to.be.eq(1);
    expect(d.executableTargets[0].name).to.be.equal("TestBuildProcess");
    expect(fs.existsSync(d.executableTargets[0].path)).to.be.true;
    d.dispose();
  }).timeout(60000);

  test('Reuse workspace', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, async () => {}, []);
    expect(await d.cleanConfigure()).to.be.eq(0);
    expect(await d.build(d.allTargetName)).to.be.eq(0);

    expect(d.executableTargets.length).to.be.eq(1);
    expect(d.executableTargets[0].name).to.be.equal("TestBuildProcess");
    expect(fs.existsSync(d.executableTargets[0].path)).to.be.true;
    d.dispose();
  }).timeout(60000);

  test('Configure fails on invalid prefered generator', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const kit = {
      name: "GCC",
      preferredGenerator: {
        name: "BlaBla"
      }
    } as Kit;

    // tslint:disable-next-line: no-floating-promises
    expect(cms_driver.CMakeServerClientDriver.create(
      executeable, wsContext, kit, project_root, async () => {}, [])
      ).to.be.rejectedWith('No usable generator found.');
  }).timeout(60000);

  test('Try build on empty dir', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/empty_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.MissingCMakeListsFile);
      called = true;
    };
    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, checkPreconditionHelper, []);
    expect(await d.cleanConfigure()).to.be.eq(-1);
    expect(called).to.be.true;
    d.dispose();
  }).timeout(60000);

  test('No parallel configuration', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      called = true;
    };
    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, checkPreconditionHelper, []);
    const configure1 = d.configure([]);
    const configure2 = d.configure([]);

    expect(await configure1).to.be.equal(0);
    expect(await configure2).to.be.equal(-99);
    expect(called).to.be.true;

    d.dispose();
  }).timeout(60000);

  test('No parallel clean configuration', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    let called = false;
    const checkPreconditionHelper = async (e: CMakePreconditionProblems) => {
      expect(e).to.be.eq(CMakePreconditionProblems.ConfigureIsAlreadyRunning);
      called = true;
    };
    const d = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, checkPreconditionHelper, []);
    const configure1 = d.cleanConfigure();
    const configure2 = d.cleanConfigure();

    expect(await configure1).to.be.equal(0);
    expect(await configure2).to.be.equal(-99);
    expect(called).to.be.true;

    d.dispose();
  }).timeout(60000);


  test('Test preconfigured workspace', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const drvSetupBuildDir = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitNinja, project_root, async () => {}, []);
    await drvSetupBuildDir.cleanConfigure();
    drvSetupBuildDir.dispose();

    const drvTest = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, async () => {}, []);
    try {
      expect(await drvTest.configure([])).to.be.eq(0);
      expect(drvTest.cmakeCacheEntries.get("CMAKE_GENERATOR")!.value).to.be.eq("Ninja");
    } finally {
      drvTest.dispose();
    }
  }).timeout(60000);

  test('Test generator switch', async () => {
    const root = getTestRootFilePath('test/unit-tests/cms-driver/workspace');
    const project_root = getTestRootFilePath('test/unit-tests/cms-driver/workspace/test_project');
    const vsContext = new FakeContextDefinition();
    const config = ConfigurationReader.createForDirectory(root);
    const wsContext = new DirectoryContext(project_root, config, new StateManager(vsContext));
    const executeable = await getCMakeExecutableInformation("cmake");

    const drvSetupBuildDir = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitDefault, project_root, async () => {}, []);
    await drvSetupBuildDir.cleanConfigure();
    try {
      expect(drvSetupBuildDir.cmakeCacheEntries.get("CMAKE_GENERATOR")!.value).to.be.not.eq("Ninja");
    } finally {
      drvSetupBuildDir.dispose();
    }

    const drvTest = await cms_driver.CMakeServerClientDriver.create(executeable, wsContext, kitNinja, project_root, async () => {}, []);
    try {
      expect(await drvTest.cleanConfigure()).to.be.eq(0);
      expect(drvTest.cmakeCacheEntries.get("CMAKE_GENERATOR")!.value).to.be.eq("Ninja");
    } finally {
      drvTest.dispose();
    }
  }).timeout(60000);
});
