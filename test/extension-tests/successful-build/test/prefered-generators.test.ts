import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {clearExistingKitConfigurationFile} from '../../../test-helpers';
import {DefaultEnvironment} from '../../../helpers/test/default-environment';

import {CMakeTools} from '../../../../src/cmake-tools';
import {ITestCallbackContext, IHookCallbackContext} from 'mocha';

interface BuildSystemConfiguration {
  defaultKit: string;
  expectedDefaultGenerator: string;
  path?: string;
}

let workername = process.env.APPVEYOR_BUILD_WORKER_IMAGE;
if (workername === undefined) {
  workername = 'DevPC';
}

const DefaultCompilerMakeSystem: {[os: string]: BuildSystemConfiguration[]} = {
  ['DevPC']: [
    {defaultKit: 'VisualStudio.14.0', expectedDefaultGenerator: 'Visual Studio 14 2015', path: 'c:\\Temp'},
    {
      defaultKit: 'GCC',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: 'C:\\Program Files\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    },
    {
      defaultKit: 'Clang',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: 'C:\\Anaconda2\\Library\\bin;C:\\Program Files\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    }
  ],
  ['Visual Studio 2017']: [
    {defaultKit: 'Visual Studio Community 2017', expectedDefaultGenerator: 'Visual Studio 15 2017'},
    {
      defaultKit: 'GCC',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: 'C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    }
  ],
  ['Visual Studio 2017 Preview']: [
    {defaultKit: 'Visual Studio Community 2017', expectedDefaultGenerator: 'Visual Studio 15 2017'},
    {
      defaultKit: 'Clang',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: 'C:\\Program Files\\LLVM\\bin;C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    },
    {
      defaultKit: 'Clang',
      expectedDefaultGenerator: 'Visual Studio 14 2015',
      path: 'C:\\Program Files\\LLVM\\bin;C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    }
  ],
  ['Visual Studio 2015']: [
    {defaultKit: 'VisualStudio.14.0', expectedDefaultGenerator: 'Visual Studio 14 2015'},
    {
      defaultKit: 'GCC',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: 'C:\\mingw-w64\\x86_64-6.3.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    }
  ],
  ['Visual Studio 2013']: [
    {defaultKit: 'VisualStudio.11.0', expectedDefaultGenerator: 'Visual Studio 11 2012'},
    {defaultKit: 'GCC', expectedDefaultGenerator: 'MinGW Makefiles', path: 'C:\\MinGW\\bin'}
  ]
};

/*
function testWithOutPreferedGeneratorInKit(buildsystem : BuildSystemConfiguration) {
  return (!isPreferedGeneratorInKit(buildsystem.defaultKit) ? test : test.skip);
}*/

DefaultCompilerMakeSystem[workername].forEach(buildsystem => {
  suite.only(`Prefered generators (${buildsystem.defaultKit})`, async() => {
    let cmt: CMakeTools;
    let testEnv: DefaultEnvironment;
    const pathBackup = process.env.PATH;
    const SCAN_TIMEOUT: number = 120000;
    const BUILD_TIMEOUT: number = 120000;
    const CLEANUP_TIMEOUT: number = 30000;


    function isPreferedGeneratorInKit(defaultKit: string): boolean { return RegExp('^VisualStudio').test(defaultKit); }

    function skipTestWithoutPreferedGeneratorInKit(testContext: ITestCallbackContext|IHookCallbackContext): void {
      if (!isPreferedGeneratorInKit(buildsystem.defaultKit)) {
        testContext.skip();
      }
    }

    function skipTestIfVisualStudioIsNotPresent(testContext: ITestCallbackContext|IHookCallbackContext): void {
      if ((process.env.HasVs != 'true')) {
        testContext.skip();
      }
    }

    suiteSetup(async function(this: Mocha.IBeforeAndAfterContext) {
      skipTestIfVisualStudioIsNotPresent(this);

      this.timeout(SCAN_TIMEOUT);

      testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder',
                                       'build',
                                       'output.txt',
                                       buildsystem.defaultKit);
      cmt = await CMakeTools.create(testEnv.vsContext);

      // This test will use all on the same kit.
      // No rescan of the tools is needed
      // No new kit selection is needed
      process.env.PATH = buildsystem.path;
      await clearExistingKitConfigurationFile();
      await cmt.scanForKits();
    });

    setup(async function(this: Mocha.IBeforeAndAfterContext) {
      testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder',
                                       'build',
                                       'output.txt',
                                       buildsystem.defaultKit);
      cmt = await CMakeTools.create(testEnv.vsContext);

      testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(CLEANUP_TIMEOUT);

      await cmt.asyncDispose();
      testEnv.teardown();

      process.env.PATH = pathBackup;
    });

    // Test only one visual studio, because there is only a preferred generator in kit by default
    // Prefered generator selection order is settings.json -> cmake-kit.json -> error
    test('Use preferred generator from kit file', async function(this: ITestCallbackContext) {
      skipTestWithoutPreferedGeneratorInKit(this);
      this.timeout(BUILD_TIMEOUT);

      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', []);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    });

    test('Get no error messages for missing preferred generators', async function(this: ITestCallbackContext) {
      skipTestWithoutPreferedGeneratorInKit(this);
      this.timeout(BUILD_TIMEOUT);

      process.env.PATH = '';
      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', ['Ninja']);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    });

    // // Test to non visual studio, in that case is no prefered generator in kit present by default
    // testWithOutPreferedGeneratorInKit(buildsystem)('Use invalid preferred generators from settings.json', async() =>
    // {
    //   await cmt.selectKit();
    //   await testEnv.setting.changeSetting('preferredGenerators', ['BlaBla']);
    //   expect(await cmt.build()).to.be.eq(-1);
    //   expect(testEnv.errorMessagesQueue.length).to.be.eq(1); // There should be a warninf
    // });

    // This test will fail always because the driver
    // testWithOutPreferedGeneratorInKit(buildsystem)('Non preferred generators configured in settings and kit', async
    // function(this : ITestCallbackContext) {
    //   this.timeout(10000);
    //   await cmt.selectKit();
    //   await testEnv.setting.changeSetting('preferredGenerators', []);

    //   cmt.build().then(() =>{ }).catch((ex:Error) => expect(ex.message).to.be('Unable to determine CMake Generator to
    //   use'));// <--- this is wrong behavior to destorys the use

    //   expect(testEnv.errorMessagesQueue.length).to.be.eq(1); // Message that no make system was found
    // });

    test('Use preferred generators from settings.json', async function(this: ITestCallbackContext) {
      this.timeout(BUILD_TIMEOUT);

      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', ['Unix Makefiles', 'MinGW Makefiles']);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    });

  });
});
