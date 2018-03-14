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

if (process.env.TRAVIS_OS_NAME) {
  workername = process.env.TRAVIS_OS_NAME;
}

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
    {defaultKit: 'Clang', expectedDefaultGenerator: 'MinGW Makefiles', path: 'C:\\Program Files\\LLVM\\bin'}
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
    {defaultKit: 'Visual Studio Community 2017', expectedDefaultGenerator: 'Visual Studio 15 2017'}
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
  ],
  ['linux']: [
    {defaultKit: 'Clang', expectedDefaultGenerator: 'Unix Makefiles'},
    {defaultKit: 'GCC', expectedDefaultGenerator: 'Unix Makefiles'}
  ],
  ['osx']: [{
    defaultKit: 'Apple',
    expectedDefaultGenerator: 'Unix Makefiles',
    path:
        '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin;/Applications/Xcode.app/Contents/Developer/usr/bin'
  }]
};

interface CmakeContext {
  cmt: CMakeTools;
  testEnv: DefaultEnvironment;
  pathBackup: string;
  buildsystem: BuildSystemConfiguration;
}

function isPreferedGeneratorInKit(defaultKit: string): boolean { return RegExp('^VisualStudio').test(defaultKit); }

function skipTestWithoutPreferredGeneratorInKit(testContext: any, context: CmakeContext): void {
  if (!isPreferedGeneratorInKit(context.buildsystem.defaultKit)) {
    testContext.skip();
  }
}

// function skipTestWithPreferredGeneratorInKit(testContext: any, context :CmakeContext): void {
//   if (isPreferedGeneratorInKit(context.buildsystem.defaultKit)) {
//     testContext.skip();
//   }
// }

function skipTestIfVisualStudioIsNotPresent(testContext: ITestCallbackContext|IHookCallbackContext): void {
  if ((process.env.HasVs != 'true')) {
    testContext.skip();
  }
}

function makeExtensionTestSuite(name: string,
                                _buildsystem: BuildSystemConfiguration,
                                cb: (context: CmakeContext) => void) {
  suite(name, () => {
    const context = { buildsystem: _buildsystem } as CmakeContext;

    suiteSetup(() => {
      context.pathBackup = process.env.PATH!;
      context.testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder',
                                               'build',
                                               'output.txt',
                                               context.buildsystem.defaultKit);
    });

    setup(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(10000);
      context.cmt = await CMakeTools.create(context.testEnv!.vsContext);
      if (context.buildsystem.path) {
        process.env.PATH = context.buildsystem.path;
      }

      context.testEnv.projectFolder.buildDirectory.clear();

      // This test will use all on the same kit.
      // No rescan of the tools is needed
      // No new kit selection is needed
      await clearExistingKitConfigurationFile();
      await context.cmt.scanForKits();
    });

    teardown(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(10000);
      await context.cmt.asyncDispose();
      context.testEnv.clean();
    });

    suiteTeardown(() => {
      context.testEnv.teardown();

      process.env.PATH = context.pathBackup;
    });

    cb(context);
  });
}
DefaultCompilerMakeSystem[workername].forEach(buildsystem => {
  makeExtensionTestSuite(`Prefered generators (${buildsystem.defaultKit})`, buildsystem, (context: CmakeContext) => {

    const BUILD_TIMEOUT: number = 120000;

    // \todo Disable until travis and Mac Tests are ready.
    suiteSetup(async function(this: Mocha.IBeforeAndAfterContext) { skipTestIfVisualStudioIsNotPresent(this); });

    // Test only one visual studio, because there is only a preferred generator in kit by default
    // Prefered generator selection order is settings.json -> cmake-kit.json -> error
    test('Use preferred generator from kit file', async function(this: ITestCallbackContext) {
      skipTestWithoutPreferredGeneratorInKit(this, context);
      this.timeout(BUILD_TIMEOUT);
      await context.cmt.selectKit();
      await context.testEnv.setting.changeSetting('preferredGenerators', []);
      expect(await context.cmt.build()).to.be.eq(0);
      const result = await context.testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(context.testEnv.errorMessagesQueue.length).to.be.eq(0);
    });

    test('Get no error messages for missing preferred generators', async function(this: ITestCallbackContext) {
      skipTestWithoutPreferredGeneratorInKit(this, context);
      this.timeout(BUILD_TIMEOUT);

      process.env.PATH = '';
      await context.cmt.selectKit();
      await context.testEnv.setting.changeSetting('preferredGenerators', ['Ninja']);
      expect(await context.cmt.build()).to.be.eq(0);
      const result = await context.testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(context.testEnv.errorMessagesQueue.length).to.be.eq(0);
    });

    // Test to non visual studio, in that case is no prefered generator in kit present by default
    // test('Use invalid preferred generators from settings.json', async function(this: ITestCallbackContext)
    // {
    //   skipTestWithPreferredGeneratorInKit(this, context);
    //   await context.cmt.selectKit();
    //   await context.testEnv.setting.changeSetting('preferredGenerators', ['BlaBla']);
    //   expect(await context.cmt.build()).to.be.eq(-1);
    //   expect(context.testEnv.errorMessagesQueue.length).to.be.eq(1); // \todo Should be a warning?
    // });

    // \todo  This test will fail always because the driver
    // test('Non preferred generators configured in settings and kit', async function(this : ITestCallbackContext) {
    //   skipTestWithPreferredGeneratorInKit(this, context);
    //   this.timeout(10000);
    //   await context.cmt.selectKit();
    //   await context.testEnv.setting.changeSetting('preferredGenerators', []);

    //   context.cmt.build().then(() =>{ }).catch((ex:Error) => expect(ex.message).to.be('Unable to determine CMake
    //   Generator to use'));// <--- this is wrong behavior it breaks the output of a message or it is redundant

    //   expect(context.testEnv.errorMessagesQueue.length).to.be.eq(1); // Message that no make system was found
    // });

    test('Use preferred generators from settings.json', async function(this: ITestCallbackContext) {
      this.timeout(BUILD_TIMEOUT);
      await context.cmt.selectKit();
      await context.testEnv.setting.changeSetting('preferredGenerators', ['Unix Makefiles', 'MinGW Makefiles']);
      expect(await context.cmt.build()).to.be.eq(0);
      const result = await context.testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(context.testEnv.errorMessagesQueue.length)
          .to.be.eq(0, 'Wrong message ' + context.testEnv.errorMessagesQueue[0]);
    });

  });
});
