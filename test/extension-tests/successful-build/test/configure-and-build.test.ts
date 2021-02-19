import {CMakeTools, ConfigureTrigger} from '@cmt/cmake-tools';
import {fs} from '@cmt/pr';
import {TestProgramResult} from '@test/helpers/testprogram/test-program-result';
import {logFilePath} from '@cmt/logging';
import {
  clearExistingKitConfigurationFile,
  DefaultEnvironment,
  expect,
  getFirstSystemKit,
  getMatchingProjectKit,
  getMatchingSystemKit
} from '@test/util';
import * as path from 'path';

// tslint:disable:no-unused-expression

let workername: string = process.platform;

if (process.env.APPVEYOR_BUILD_WORKER_IMAGE) {
  workername = process.env.APPVEYOR_BUILD_WORKER_IMAGE;
}

if (process.env.TRAVIS_OS_NAME) {
  workername = process.env.TRAVIS_OS_NAME;
}

suite('Build', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;
  let compdb_cp_path: string;

  suiteSetup(async function(this: Mocha.Context) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', build_loc, exe_res);
    compdb_cp_path = path.join(testEnv.projectFolder.location, 'compdb_cp.json');
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    await clearExistingKitConfigurationFile();
    await cmt.asyncDispose();
  });

  setup(async function(this: Mocha.Context) {
    this.timeout(100000);

    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);
    const kit = await getFirstSystemKit(cmt);
    console.log("Using following kit in next test: ", kit);
    await cmt.setKit(kit);
    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.Context) {
    this.timeout(100000);
    await cmt.asyncDispose();
    const logPath = logFilePath();
    testEnv.clean();
    if (await fs.exists(logPath)) {
      if (this.currentTest?.state == "failed") {
        const logContent = await fs.readFile(logPath);
        logContent.toString().split('\n').forEach(line => {
          console.log(line);
        });
      }
      await fs.writeFile(logPath, "");
    }
  });

  suiteTeardown(async () => {
    if (testEnv) {
      testEnv.teardown();
    }
    if (await fs.exists(compdb_cp_path)) {
      await fs.unlink(compdb_cp_path);
    }
  });

  test('Configure', async () => {
    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0);

    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
  }).timeout(100000);

  test('Build', async () => {
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);


  test('Configure and Build', async () => {
    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0);
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);

  test('Configure and Build run target', async () => {
    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0);

    const targets = await cmt.targets;
    const runTestTargetElement = targets.find(item => item.name === 'runTestTarget');
    expect(runTestTargetElement).to.be.not.an('undefined');

    await cmt.setDefaultTarget('runTestTarget');
    expect(await cmt.build()).to.be.eq(0);

    const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
    const result = await resultFile.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);

  test('Configure with cache-initializer', async () => {
    testEnv.config.updatePartial({cacheInit: 'TestCacheInit.cmake'});
    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.be.eq(0);
    await cmt.setDefaultTarget('runTestTarget');
    expect(await cmt.build()).to.be.eq(0);
    const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
    const result = await resultFile.getResultAsJson();
    expect(result['cookie']).to.eq('cache-init-cookie');
  }).timeout(100000);

  test('Test kit switch after missing preferred generator', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    const os_compilers: {[osName: string]: {kitLabel: RegExp, compiler: string}[]} = {
      linux: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^Clang \d/, compiler: 'Clang'}],
      win32: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^VisualStudio/, compiler: 'MSVC'}]
    };
    if (!(workername in os_compilers))
      this.skip();
    const compiler = os_compilers[workername];

    // Run test
    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.setKit(await getMatchingSystemKit(cmt, compiler[0].kitLabel));

    await cmt.build();

    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await cmt.setKit(await getMatchingSystemKit(cmt, compiler[1].kitLabel));

    await cmt.build();
    const result1 = await testEnv.result.getResultAsJson();
    expect(result1['compiler']).to.eql(compiler[1].compiler);
  }).timeout(100000);

  test('Test kit switch after missing preferred generator #512', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    const os_compilers: {[osName: string]: {kitLabel: RegExp, generator: string}[]} = {
      linux: [
        {kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles'},
        {kitLabel: /^Generator switch test GCC no generator$/, generator: ''}
      ],
      win32: [
        {kitLabel: /^Generator switch test GCC Mingw - Win/, generator: 'MinGW Makefiles'},
        {kitLabel: /^Generator switch test GCC no generator - Win/, generator: ''}
      ]
    };
    if (!(workername in os_compilers))
      this.skip();
    // Remove all preferred generator (Remove config dependenies, auto detection)
    testEnv.config.updatePartial({preferredGenerators: []});
    const compiler = os_compilers[workername];

    // Run configure kit
    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));
    await cmt.build();

    // Run Configure kit without preferred generator
    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
    await cmt.build();
    // Keep result1 for a later comparison
    const result1 = await testEnv.result.getResultAsJson();

    // Test return to previous kit
    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));
    await cmt.build();

    const result2 = await testEnv.result.getResultAsJson();
    expect(result2['cmake-generator']).to.eql(compiler[0].generator);

    // result1 (for no preferred generator given) should be the same as
    // a list of default preferred generators: Ninja + Unix Makefiles.
    // These defaults take effect only when no other preferred generator
    // is deduced from other sources: settings (cmake.generator, cmake.preferredGenerators)
    // or kits preferred generator in cmake-tools-kits.json.
    testEnv.config.updatePartial({preferredGenerators: ["Ninja", "Unix Makefiles"]});
    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
    await cmt.build();
    const result3 = await testEnv.result.getResultAsJson();
    expect(result1['cmake-generator']).to.eql(result3['cmake-generator']);
  }).timeout(100000);

  test('Test kit switch between different preferred generators and compilers',
       async function(this: Mocha.Context) {
         // Select compiler build node dependent
         const os_compilers: {[osName: string]: {kitLabel: RegExp, compiler: string}[]} = {
           linux: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^Clang \d/, compiler: 'Clang'}],
           win32: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^VisualStudio/, compiler: 'MSVC'}]
         };
         if (!(workername in os_compilers))
           this.skip();
         const compiler = os_compilers[workername];

         testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
         await cmt.setKit(await getMatchingSystemKit(cmt, compiler[0].kitLabel));
         await cmt.build();

         testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
         await cmt.setKit(await getMatchingSystemKit(cmt, compiler[1].kitLabel));
         await cmt.build();

         const result1 = await testEnv.result.getResultAsJson();
         expect(result1['compiler']).to.eql(compiler[1].compiler);
       })
      .timeout(100000);

  test('Test kit switch between different preferred generators and same compiler',
       async function(this: Mocha.Context) {
         // Select compiler build node dependent
         const os_compilers: {[osName: string]: {kitLabel: RegExp, generator: string}[]} = {
           linux: [
             {kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles'},
             {kitLabel: /^Generator switch test GCC Ninja$/, generator: 'Ninja'}
           ],
           win32: [
             {kitLabel: /^Generator switch test GCC Mingw - Win/, generator: 'MinGW Makefiles'},
             {kitLabel: /^Generator switch test GCC Ninja - Win/, generator: 'Ninja'}
           ]
         };
         if (!(workername in os_compilers))
           this.skip();
         const compiler = os_compilers[workername];

         testEnv.config.updatePartial({preferredGenerators: []});
         testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
         await cmt.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));

         let retc = await cmt.build();
         expect(retc).eq(0);

         testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
         await cmt.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));

         retc = await cmt.build();
         expect(retc).eq(0);
         const result1 = await testEnv.result.getResultAsJson();
         expect(result1['cmake-generator']).to.eql(compiler[1].generator);
       })
      .timeout(100000);

  test('Test kit switch kits after configure', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    const os_compilers: {[osName: string]: {kitLabel: RegExp, generator: string}[]} = {
      linux: [
        {kitLabel: /^Generator switch test GCC Make$/, generator: 'Unix Makefiles'},
        {kitLabel: /^Generator switch test GCC Ninja$/, generator: 'Ninja'}
      ],
      win32: [
        {kitLabel: /^Generator switch test GCC Mingw - Win/, generator: 'MinGW Makefiles'},
        {kitLabel: /^Generator switch test GCC Ninja - Win/, generator: 'Ninja'}
      ]
    };
    if (!(workername in os_compilers))
      this.skip();
    const compiler = os_compilers[workername];

    testEnv.config.updatePartial({preferredGenerators: []});
    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));

    await cmt.build();

    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[1].kitLabel, testEnv.projectFolder.location));
    await cmt.configureInternal(ConfigureTrigger.runTests);

    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.setKit(await getMatchingProjectKit(compiler[0].kitLabel, testEnv.projectFolder.location));

    await cmt.build();
    const result1 = await testEnv.result.getResultAsJson();
    expect(result1['cmake-generator']).to.eql(compiler[0].generator);
  }).timeout(200000);

  test('Test build twice', async function(this: Mocha.Context) {
    console.log('1. Build');
    expect(await cmt.build()).eq(0);
    console.log('2. Build');
    expect(await cmt.build()).eq(0);
    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with clean', async function(this: Mocha.Context) {
    expect(await cmt.build()).eq(0);
    await cmt.clean();
    expect(await cmt.build()).eq(0);
    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with clean configure', async function(this: Mocha.Context) {
    expect(await cmt.build()).eq(0);
    await cmt.cleanConfigure(ConfigureTrigger.runTests);
    expect(await cmt.build()).eq(0);

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with rebuild configure', async function(this: Mocha.Context) {
    // Select compiler build node dependent
    await cmt.build();
    expect(await cmt.build()).eq(0);
    await cmt.cleanRebuild();
    expect(await cmt.build()).eq(0);

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Copy compile_commands.json to a pre-determined path', async () => {
    expect(await fs.exists(compdb_cp_path), 'File shouldn\'t be there!').to.be.false;
    let retc = await cmt.configureInternal(ConfigureTrigger.runTests);
    expect(retc).to.eq(0);
    expect(await fs.exists(compdb_cp_path), 'File still shouldn\'t be there').to.be.false;
    testEnv.config.updatePartial({copyCompileCommands: compdb_cp_path});
    retc = await cmt.configureInternal(ConfigureTrigger.runTests);
    expect(retc).to.eq(0);
    expect(await fs.exists(compdb_cp_path), 'File wasn\'t copied').to.be.true;
  }).timeout(100000);
});
