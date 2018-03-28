import {CMakeTools} from '@cmt/cmake-tools';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect} from '@test/util';
import {ITestCallbackContext} from 'mocha';

interface KitEnvironment {
  defaultKit: string;
  excludeKit?: string;
  expectedDefaultGenerator: string;
  path?: string[];
}

let workername = process.env.APPVEYOR_BUILD_WORKER_IMAGE;

if (process.env.TRAVIS_OS_NAME) {
  workername = process.env.TRAVIS_OS_NAME;
}

if (workername === undefined) {
  workername = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
}

const VISUAL_STUDIO_KITS: KitEnvironment[] = [
  // Visual Studio 2017
  {
    defaultKit: 'Visual Studio Community 2017',
    excludeKit: 'Preview',
    expectedDefaultGenerator: 'Visual Studio 15 2017'
  },
  {defaultKit: 'Visual Studio Community 2017 Preview', expectedDefaultGenerator: 'Visual Studio 15 2017'},
  {
    defaultKit: 'Visual Studio Professional 2017',
    excludeKit: 'Preview',
    expectedDefaultGenerator: 'Visual Studio 15 2017'
  },
  {defaultKit: 'Visual Studio Professional 2017 Preview', expectedDefaultGenerator: 'Visual Studio 15 2017'},
  {
    defaultKit: 'Visual Studio Enterprise 2017',
    excludeKit: 'Preview',
    expectedDefaultGenerator: 'Visual Studio 15 2017'
  },
  {defaultKit: 'Visual Studio Enterprise 2017 Preview', expectedDefaultGenerator: 'Visual Studio 15 2017'},

  // Visual Studio 2015
  {defaultKit: 'VisualStudio.14.0', expectedDefaultGenerator: 'Visual Studio 14 2015'},

  // Visual Studio 2012
  {defaultKit: 'VisualStudio.11.0', expectedDefaultGenerator: 'Visual Studio 11 2012'},
];

const KITS_BY_PLATFORM: {[osName: string]: KitEnvironment[]} = {
  ['windows']: VISUAL_STUDIO_KITS.concat([
    {
      defaultKit: 'GCC 7.2.0',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: ['C:\\Program Files\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin']
    },
    {defaultKit: 'GCC 6.4.0', expectedDefaultGenerator: 'Unix Makefiles', path: ['c:\\temp']},
    {defaultKit: 'Clang 4.0.1', expectedDefaultGenerator: 'Unix Makefiles', path: ['c:\\temp']},
    {defaultKit: 'Clang 5.0.1', expectedDefaultGenerator: 'Unix Makefiles', path: ['c:\\temp']}
  ]),
  ['Visual Studio 2017']: VISUAL_STUDIO_KITS.concat([
    {
      defaultKit: 'GCC 7.2.0',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: ['C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin']
    },
    {defaultKit: 'GCC 6.4.0', expectedDefaultGenerator: 'Unix Makefiles', path: ['c:\\temp']}
  ]),
  ['Visual Studio 2017 Preview']: VISUAL_STUDIO_KITS.concat(
      [{defaultKit: 'GCC 6.4.0', expectedDefaultGenerator: 'Unix Makefiles', path: ['c:\\temp']}]),
  ['Visual Studio 2015']: VISUAL_STUDIO_KITS.concat([
    {
      defaultKit: 'GCC 7.2.0',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: ['C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin']
    },
    {
      defaultKit: 'GCC 6.3.0',
      expectedDefaultGenerator: 'MinGW Makefiles',
      path: ['C:\\mingw-w64\\x86_64-6.3.0-posix-seh-rt_v5-rev1\\mingw64\\bin']
    },
    {defaultKit: 'GCC 5.3.0', expectedDefaultGenerator: 'MinGW Makefiles', path: ['C:\\MinGW\\bin']},
    {defaultKit: 'GCC 6.4.0', expectedDefaultGenerator: 'Unix Makefiles', path: ['c:\\temp']}
  ]),
  ['linux']: [
    {defaultKit: 'Clang', expectedDefaultGenerator: 'Unix Makefiles'},
    {defaultKit: 'GCC', expectedDefaultGenerator: 'Unix Makefiles'}
  ],
  ['osx']: [{
    defaultKit: 'Clang',
    expectedDefaultGenerator: 'Unix Makefiles',
    path: [
      '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
      '/Applications/Xcode.app/Contents/Developer/usr/bin',
      '/Users/travis/.local/share/CMakeTools/test-cmake-root/3.10.0/bin'
    ]
  }]
};

interface CMakeContext {
  cmt: CMakeTools;
  testEnv: DefaultEnvironment;
  pathBackup: string;
  buildSystem: KitEnvironment;
}

function isKitAvailable(context: CMakeContext): boolean {
  const kits = context.cmt.getKits();
  let isAvailable: boolean = false;
  kits.forEach(value => {
    if (value.name.includes(context.buildSystem.defaultKit)
        && (context.buildSystem.excludeKit ? !value.name.includes(context.buildSystem.excludeKit) : true))
      isAvailable = true;
  });

  return isAvailable;
}

function isPreferredGeneratorAvailable(context: CMakeContext): boolean {
  const kits = context.cmt.getKits();
  let isAvailable: boolean = false;
  kits.forEach(value => {
    if (value.name.includes(context.buildSystem.defaultKit)
        && (context.buildSystem.excludeKit ? !value.name.includes(context.buildSystem.excludeKit) : true)
        && value.preferredGenerator)
      isAvailable = true;
  });

  return isAvailable;
}

interface SkipOptions {
  kitIsNotAvailable?: boolean;
  preferredGeneratorIsAvailable?: boolean;
  preferredGeneratorIsNotAvailable?: boolean;
}

function skipTestIf(skipOptions: SkipOptions, testContext: any, context: CMakeContext): void {
  // Skip if kit is not available (matched by default name)
  if (skipOptions.kitIsNotAvailable && !isKitAvailable(context))
    testContext.skip();

  if ((skipOptions.preferredGeneratorIsAvailable && isPreferredGeneratorAvailable(context))
      || (skipOptions.preferredGeneratorIsNotAvailable && !isPreferredGeneratorAvailable(context)))
    testContext.skip();
}

function makeExtensionTestSuite(name: string,
                                expectedBuildSystem: KitEnvironment,
                                cb: (context: CMakeContext) => void) {
  suite(name, () => {
    const context = {buildSystem: expectedBuildSystem} as CMakeContext;

    suiteSetup(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(100000);
      context.testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder',
                                               'build',
                                               'output.txt',
                                               context.buildSystem.defaultKit,
                                               context.buildSystem.excludeKit);

      context.pathBackup = process.env.PATH!;
      if (context.buildSystem.path && context.buildSystem.path.length != 0) {
        process.env.PATH = context.buildSystem.path.join(process.platform == 'win32' ? ';' : ':');
      }

      context.cmt = await CMakeTools.create(context.testEnv!.vsContext);
      // This test will use all on the same kit.
      // No rescan of the tools is needed
      // No new kit selection is needed
      await clearExistingKitConfigurationFile();
      await context.cmt.scanForKits();
    });

    setup(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(10000);
      context.cmt = await CMakeTools.create(context.testEnv!.vsContext);
      context.testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(100000);
      await context.cmt.asyncDispose();
      context.testEnv.clean();
    });

    suiteTeardown(() => {
      process.env.PATH = context.pathBackup;

      if (context.testEnv) {
        context.testEnv.teardown();
      }
    });

    cb(context);
  });
}

KITS_BY_PLATFORM[workername].forEach(buildSystem => {
  makeExtensionTestSuite(`Preferred generators (${buildSystem.defaultKit})`, buildSystem, (context: CMakeContext) => {
    const BUILD_TIMEOUT: number = 120000;

    // Test only one visual studio, because there is only a preferred generator in kit by default
    // Preferred generator selection order is settings.json -> cmake-kit.json -> error
    test(`Use preferred generator from kit file (${buildSystem.defaultKit})`,
         async function(this: ITestCallbackContext) {
           skipTestIf({preferredGeneratorIsNotAvailable: true, kitIsNotAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           await context.cmt.selectKit();
           await context.testEnv.setting.changeSetting('preferredGenerators', []);
           expect(await context.cmt.build()).to.be.eq(0);
           const result = await context.testEnv.result.getResultAsJson();
           expect(result['cmake-generator']).to.eq(buildSystem.expectedDefaultGenerator);
           expect(context.testEnv.errorMessagesQueue.length).to.be.eq(0);
         });

    test(`Use preferred generator from settings file (${buildSystem.defaultKit})`,
         async function(this: ITestCallbackContext) {
           skipTestIf({preferredGeneratorIsNotAvailable: true, kitIsNotAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           process.env.PATH = '';
           await context.cmt.selectKit();
           await context.testEnv.setting.changeSetting('preferredGenerators', ['Ninja']);
           expect(await context.cmt.build()).to.be.eq(0);
           const result = await context.testEnv.result.getResultAsJson();
           expect(result['cmake-generator']).to.eq(buildSystem.expectedDefaultGenerator);
           expect(context.testEnv.errorMessagesQueue.length).to.be.eq(0);
         });

    test(`Reject invalid preferred generator in settings file (${buildSystem.defaultKit})`,
         async function(this: ITestCallbackContext) {
           skipTestIf({preferredGeneratorIsAvailable: true, kitIsNotAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           await context.cmt.selectKit();
           await context.testEnv.setting.changeSetting('preferredGenerators', ['BlaBla']);
           await expect(context.cmt.build()).to.eventually.be.rejected;

           expect(context.testEnv.errorMessagesQueue.length).to.be.eq(1);
           expect(context.testEnv.errorMessagesQueue[0])
               .to.be.contains('Unable to determine what CMake generator to use.');
         });

    test(`Reject if all \'preferredGenerators\' fields are empty (${buildSystem.defaultKit})`,
         async function(this: ITestCallbackContext) {
           skipTestIf({preferredGeneratorIsAvailable: true, kitIsNotAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           await context.cmt.selectKit();
           await context.testEnv.setting.changeSetting('preferredGenerators', []);
           await expect(context.cmt.build()).to.eventually.be.rejected;

           expect(context.testEnv.errorMessagesQueue.length).to.be.eq(1);
           expect(context.testEnv.errorMessagesQueue[0])
               .to.be.contains('Unable to determine what CMake generator to use.');
         });

    test(`Use preferred generator from settings.json (${buildSystem.defaultKit})`,
         async function(this: ITestCallbackContext) {
           skipTestIf({kitIsNotAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           await context.cmt.selectKit();
           await context.testEnv.setting.changeSetting('preferredGenerators', ['Unix Makefiles', 'MinGW Makefiles']);
           expect(await context.cmt.build()).to.be.eq(0);
           const result = await context.testEnv.result.getResultAsJson();
           expect(result['cmake-generator']).to.eq(buildSystem.expectedDefaultGenerator);
           expect(context.testEnv.errorMessagesQueue.length)
               .to.be.eq(0, 'Wrong message ' + context.testEnv.errorMessagesQueue[0]);
         });
  });
});
