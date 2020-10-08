import {CMakeTools} from '@cmt/cmake-tools';
import {Kit, scanForKits} from '@cmt/kit';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect} from '@test/util';
import * as path from 'path';

interface KitEnvironment {
  defaultKit: RegExp;
  excludeKit?: RegExp;
  expectedDefaultGenerator: RegExp;
  path?: string[];
  isVsNewerThan14?: boolean;
}

let workername = process.env.APPVEYOR_BUILD_WORKER_IMAGE;

if (process.env.TRAVIS_OS_NAME) {
  workername = process.env.TRAVIS_OS_NAME;
}

if (workername === undefined) {
  workername = process.platform;
}

const DEFAULT_VS_KITS: KitEnvironment[] = [
  // Visual Studio 2017
  {
    defaultKit: /^Visual Studio Community 2017/,
    excludeKit: /Preview/,
    expectedDefaultGenerator: /^Visual Studio 15 2017/,
    isVsNewerThan14: true
  },
  {
    defaultKit: /^Visual Studio Community 2017 Preview/,
    expectedDefaultGenerator: /^Visual Studio 15 2017/,
    isVsNewerThan14: true
  },
  {
    defaultKit: /^Visual Studio Professional 2017/,
    excludeKit: /Preview/,
    expectedDefaultGenerator: /Visual Studio 15 2017/,
    isVsNewerThan14: true
  },
  {
    defaultKit: /^Visual Studio Professional 2017 Preview/,
    expectedDefaultGenerator: /^Visual Studio 15 2017/,
    isVsNewerThan14: true
  },
  {
    defaultKit: /^Visual Studio Enterprise 2017/,
    excludeKit: /Preview/,
    expectedDefaultGenerator: /^Visual Studio 15 2017/,
    isVsNewerThan14: true
  },
  {
    defaultKit: /^Visual Studio Enterprise 2017 Preview/,
    expectedDefaultGenerator: /^Visual Studio 15 2017/,
    isVsNewerThan14: true
  },

  // Visual Studio 2015
  {
    defaultKit: /^VisualStudio.14.0/,
    expectedDefaultGenerator: /^Visual Studio 14 2015/,
    path: [''],
    isVsNewerThan14: false
  },

  // Visual Studio 2012
  {
    defaultKit: /^VisualStudio.11.0/,
    expectedDefaultGenerator: /^Visual Studio 11 2012/,
    path: [''],
    isVsNewerThan14: false
  },
];

const DEFAULT_CYGWIN_KITS: KitEnvironment[] =
    [{defaultKit: /^GCC/, expectedDefaultGenerator: /^Unix Makefiles/, path: ['c:\\cygwin64\\bin']}];

const DEFAULT_MINGW_KITS: KitEnvironment[] = [
  {
    defaultKit: /^GCC 7.3.0/,
    expectedDefaultGenerator: /^MinGW Makefiles/,
    path: [
      'C:\\Program Files\\mingw-w64\\x86_64-7.3.0-posix-seh-rt_v5-rev0\\mingw64\\bin',
      'C:\\mingw-w64\\x86_64-7.3.0-posix-seh-rt_v5-rev0\\mingw64\\bin'
    ]
  },
  {
    defaultKit: /^GCC 7.2.0/,
    expectedDefaultGenerator: /^MinGW Makefiles/,
    path: [
      'C:\\Program Files\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin',
      'C:\\mingw-w64\\x86_64-7.2.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    ]
  },
  {
    defaultKit: /^GCC 6.3.0/,
    expectedDefaultGenerator: /^MinGW Makefiles/,
    path: [
      'C:\\Program Files\\mingw-w64\\x86_64-6.3.0-posix-seh-rt_v5-rev1\\mingw64\\bin',
      'C:\\mingw-w64\\x86_64-6.3.0-posix-seh-rt_v5-rev1\\mingw64\\bin'
    ]
  },
  {defaultKit: /^GCC 5.3.0/, expectedDefaultGenerator: /^MinGW Makefiles/, path: ['C:\\MinGW\\bin']}
];

const DEFAULT_WINDOWS_KITS: KitEnvironment[]
    = DEFAULT_VS_KITS.concat(DEFAULT_CYGWIN_KITS, DEFAULT_MINGW_KITS);

const KITS_BY_PLATFORM: {[osName: string]: KitEnvironment[]} = {
  ['win32']: DEFAULT_WINDOWS_KITS.concat([{
    defaultKit: /^Clang .* for MSVC/,
    expectedDefaultGenerator: /^Unix Makefiles/,
    path: [' C:\\Program Files\\LLVM\\bin']
  }]),
  ['Visual Studio 2017']: DEFAULT_VS_KITS,
  ['Visual Studio 2017 Preview']: DEFAULT_VS_KITS,
  ['Visual Studio 2015']: DEFAULT_VS_KITS,
  ['linux']: [
    {defaultKit: /Clang/, expectedDefaultGenerator: /Unix Makefiles/},
    {defaultKit: /GCC/, expectedDefaultGenerator: /Unix Makefiles/}
  ],
  ['darwin']: [
    {defaultKit: /^Clang/, expectedDefaultGenerator: /^Unix Makefiles/},
    {defaultKit: /^GCC/, expectedDefaultGenerator: /^Unix Makefiles/}
  ],
  // This is a special case for travis
  ['osx']: [{
    defaultKit: /^Clang/,
    expectedDefaultGenerator: /^Unix Makefiles/,
    path: [
      '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
      '/Applications/Xcode.app/Contents/Developer/usr/bin',
      process.env.CMAKE_EXECUTABLE ? path.dirname(process.env.CMAKE_EXECUTABLE)
                                   : '/Users/travis/.local/share/CMakeTools/test-cmake-root/3.10.0/bin'
    ]
  }]
};

interface CMakeContext {
  cmt: CMakeTools;
  kits: Kit[];
  testEnv: DefaultEnvironment;
  pathBackup: string;
  buildSystem: KitEnvironment;
}

// This exactly matches the kit name
function exactKitCheck(kitName: string, defaultKit: RegExp): boolean { return defaultKit.test(kitName); }

// This only does a fuzzy check with the ability to exclude kits which have a substring included
// in their name.
function fuzzyKitCheck(kitName: string, defaultKit: RegExp, excludeKit?: RegExp): boolean {
  return defaultKit.test(kitName) && (excludeKit ? !excludeKit.test(kitName) : true);
}

// Check if the kit provided by the buildSystem is available
// by first doing an exact check and if that didn't yield any
// results, a fuzzy check.
function isKitAvailable(context: CMakeContext): boolean {
  const kits = context.kits;
  return kits.find(kit => exactKitCheck(kit.name, context.buildSystem.defaultKit))
      ? true
      : kits.find(kit => fuzzyKitCheck(kit.name, context.buildSystem.defaultKit, context.buildSystem.excludeKit))
          ? true
          : false;
}

// Check if the kit provided by the buildSystem has a preferred generator
// defined in the kits file.
function isPreferredGeneratorAvailable(context: CMakeContext): boolean {
  const kits = context.kits;
  return kits.find(kit => exactKitCheck(kit.name, context.buildSystem.defaultKit) && kit.preferredGenerator ? true
                                                                                                            : false)
      ? true
      : kits.find(kit => fuzzyKitCheck(kit.name, context.buildSystem.defaultKit, context.buildSystem.excludeKit)
                          && kit.preferredGenerator
                      ? true
                      : false)
          ? true
          : false;
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

    suiteSetup(async function(this: Mocha.Context) {
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

      context.cmt = await CMakeTools.create(context.testEnv.vsContext, context.testEnv.wsContext);
      // This test will use all on the same kit.
      // No rescan of the tools is needed
      // No new kit selection is needed
      await clearExistingKitConfigurationFile();
      context.kits = await scanForKits(context.cmt);
      skipTestIf({kitIsNotAvailable: true}, this, context);
    });

    setup(async function(this: Mocha.Context) {
      this.timeout(10000);
      context.cmt = await CMakeTools.create(context.testEnv.vsContext, context.testEnv.wsContext);
      const kit = context.kits.find(k => expectedBuildSystem.defaultKit.test(k.name));
      // tslint:disable-next-line:no-unused-expression
      expect(kit, `Kit required for test "${expectedBuildSystem.defaultKit}" is not available.`).to.not.be.null;
      await context.cmt.setKit(kit!);
      context.testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function(this: Mocha.Context) {
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

// Preferred generator selection order is settings.json -> cmake-kit.json -> error
KITS_BY_PLATFORM[workername].forEach(buildSystem => {
  makeExtensionTestSuite(`Preferred generators (${buildSystem.defaultKit})`, buildSystem, (context: CMakeContext) => {
    const BUILD_TIMEOUT: number = 120000;

    // This test is only valid for kits which have at least one preferred generator defined.
    test(`Use preferred generator from kit file (${buildSystem.defaultKit})`,
         async function(this: Mocha.Context) {
           skipTestIf({preferredGeneratorIsNotAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           context.testEnv.config.updatePartial({preferredGenerators: []});
           expect(await context.cmt.build()).to.eql(0);
           const result = await context.testEnv.result.getResultAsJson();
           expect(result['cmake-generator']).to.match(buildSystem.expectedDefaultGenerator);
           expect(context.testEnv.errorMessagesQueue.length).to.eql(0);
         });

    test(`Use preferred generator from settings file (${buildSystem.defaultKit})`,
         async function(this: Mocha.Context) {
           this.timeout(BUILD_TIMEOUT);

           context.testEnv.config.updatePartial({
             preferredGenerators: [
               'NMake Makefiles',
               'Unix Makefiles',
               'MinGW Makefiles',
             ],
           });
           expect(await context.cmt.build()).to.eql(0);
           const result = await context.testEnv.result.getResultAsJson();

           expect(result['cmake-generator'])
               .to.be.match((context.buildSystem.isVsNewerThan14 === true)
                                ? /^NMake Makefiles/
                                : context.buildSystem.expectedDefaultGenerator);

           expect(context.testEnv.errorMessagesQueue.length).to.eql(0);
         });

    // This test is NOT valid for kits which have any preferred generator defined
    // since we expect CMT to reject the build.
    test(`Reject invalid preferred generator in settings file (${buildSystem.defaultKit})`,
         async function(this: Mocha.Context) {
           skipTestIf({preferredGeneratorIsAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);

           context.testEnv.config.updatePartial({preferredGenerators: ['BlaBla']});
           await expect(context.cmt.build()).to.eventually.be.rejected;

           expect(context.testEnv.errorMessagesQueue.length).to.be.gte(1);
           expect(context.testEnv.errorMessagesQueue[0])
               .to.be.contains('Unable to determine what CMake generator to use.');
         });

    // This test verifies that kits without any preferred generator defined
    // are still able to pick one preferred generator from the default list
    // (Ninja + Unix Makefiles)
    test(`Select default if all \'preferredGenerators\' fields are empty (${buildSystem.defaultKit})`,
         async function(this: Mocha.Context) {
           skipTestIf({preferredGeneratorIsAvailable: true}, this, context);
           this.timeout(BUILD_TIMEOUT);
           context.testEnv.config.updatePartial({preferredGenerators: []});
           expect(await context.cmt.build()).to.eql(0);

           const result = await context.testEnv.result.getResultAsJson();
           // "Ninja" and "Unix Makefiles" are always the default preferred generators
           // if no other overriding property is set.
           // The extension verifies for each if they are present (installed)
           // and starts with "Ninja".
           const isNinjaInstalled = await context.cmt.isNinjaInstalled();
           expect(result['cmake-generator']).to.eql(isNinjaInstalled ? "Ninja" : "Unix Makefiles");

           expect(context.testEnv.errorMessagesQueue.length)
               .to.eql(0, 'Wrong message ' + context.testEnv.errorMessagesQueue[0]);
         });

    test(`Use preferred generator from settings or kit file (${buildSystem.defaultKit})`,
         async function(this: Mocha.Context) {
           this.timeout(BUILD_TIMEOUT);

           context.testEnv.config.updatePartial({preferredGenerators: ['Unix Makefiles', 'MinGW Makefiles']});
           expect(await context.cmt.build()).to.eql(0);
           const result = await context.testEnv.result.getResultAsJson();
           expect(result['cmake-generator']).to.match(buildSystem.expectedDefaultGenerator);
           expect(context.testEnv.errorMessagesQueue.length)
               .to.eql(0, 'Wrong message ' + context.testEnv.errorMessagesQueue[0]);
         });
  });
});
