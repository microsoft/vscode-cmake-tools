import {CMakeTools} from '@cmt/cmake-tools';
import {fs} from '@cmt/pr';
import {TestProgramResult} from '@test/helpers/testprogram/test-program-result';
import {clearExistingKitConfigurationFile, DefaultEnvironment, expect} from '@test/util';
import {ITestCallbackContext} from 'mocha';
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

  suiteSetup(async function(this: Mocha.IHookCallbackContext) {
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
    await cmt.scanForKits();
    await cmt.selectKit();
    await cmt.asyncDispose();
  });

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);
    await cmt.selectKit();
    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);
    await cmt.asyncDispose();
    testEnv.clean();
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
    expect(await cmt.configure()).to.be.eq(0);

    expect(testEnv.projectFolder.buildDirectory.isCMakeCachePresent).to.eql(true, 'no expected cache present');
  }).timeout(100000);

  test('Build', async () => {
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);


  test('Configure and Build', async () => {
    expect(await cmt.configure()).to.be.eq(0);
    expect(await cmt.build()).to.be.eq(0);

    const result = await testEnv.result.getResultAsJson();
    expect(result['cookie']).to.eq('passed-cookie');
  }).timeout(100000);

  test('Configure and Build run target', async () => {
    expect(await cmt.configure()).to.be.eq(0);

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
    expect(await cmt.configure()).to.be.eq(0);
    await cmt.setDefaultTarget('runTestTarget');
    expect(await cmt.build()).to.be.eq(0);
    const resultFile = new TestProgramResult(testEnv.projectFolder.buildDirectory.location, 'output_target.txt');
    const result = await resultFile.getResultAsJson();
    expect(result['cookie']).to.eq('cache-init-cookie');
  }).timeout(100000);

  test('Test kit switch after missing preferred generator', async function(this: ITestCallbackContext) {
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
    await cmt.selectKit();

    await cmt.build();

    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await cmt.selectKit();

    await cmt.build();
    const result1 = await testEnv.result.getResultAsJson();
    expect(result1['compiler']).to.eql(compiler[1].compiler);
  }).timeout(100000);

  test('Test kit switch between different preferred generators and compilers',
       async function(this: ITestCallbackContext) {
         // Select compiler build node dependent
         const os_compilers: {[osName: string]: {kitLabel: RegExp, compiler: string}[]} = {
           linux: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^Clang \d/, compiler: 'Clang'}],
           win32: [{kitLabel: /^GCC \d/, compiler: 'GNU'}, {kitLabel: /^VisualStudio/, compiler: 'MSVC'}]
         };
         if (!(workername in os_compilers))
           this.skip();
         const compiler = os_compilers[workername];

         testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
         await cmt.selectKit();
         await cmt.build();

         testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
         await cmt.selectKit();
         await cmt.build();

         const result1 = await testEnv.result.getResultAsJson();
         expect(result1['compiler']).to.eql(compiler[1].compiler);
       })
      .timeout(100000);

  test('Test kit switch between different preferred generators and same compiler',
       async function(this: ITestCallbackContext) {
         // Select compiler build node dependent
         const os_compilers: {[osName: string]: {kitLabel: RegExp, generator: string}[]} = {
           linux: [
             {kitLabel: /^Generator switch test GCC Make/, generator: 'Unix Makefiles'},
             {kitLabel: /^Generator switch test GCC Ninja/, generator: 'Ninja'}
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
         await cmt.selectKit();

         await cmt.build();

         testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
         await cmt.selectKit();

         await cmt.build();
         const result1 = await testEnv.result.getResultAsJson();
         expect(result1['cmake-generator']).to.eql(compiler[1].generator);
       })
      .timeout(100000);

  test('Test kit switch kits after configure', async function(this: ITestCallbackContext) {
    // Select compiler build node dependent
    const os_compilers: {[osName: string]: {kitLabel: RegExp, generator: string}[]} = {
      linux: [
        {kitLabel: /^Generator switch test GCC Make/, generator: 'Unix Makefiles'},
        {kitLabel: /^Generator switch test GCC Ninja/, generator: 'Ninja'}
      ],
      win32: [
        {kitLabel: /^Generator switch test GCC Mingw - Win/, generator: 'MinGW Makefiles'},
        {kitLabel: /^Generator switch test GCC Ninja - Win/, generator: 'Ninja'}
      ]
    };
    if (!(workername in os_compilers))
      this.skip();
    const compiler = os_compilers[workername];

    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.selectKit();

    await cmt.build();

    testEnv.kitSelection.defaultKitLabel = compiler[1].kitLabel;
    await cmt.selectKit();
    await cmt.configure();

    testEnv.kitSelection.defaultKitLabel = compiler[0].kitLabel;
    await cmt.selectKit();

    await cmt.build();
    const result1 = await testEnv.result.getResultAsJson();
    expect(result1['cmake-generator']).to.eql(compiler[0].generator);
  }).timeout(200000);

  test('Test build twice', async function(this: ITestCallbackContext) {
    await cmt.selectKit();

    await cmt.build();
    await cmt.build();
    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with clean', async function(this: ITestCallbackContext) {
    await cmt.selectKit();

    await cmt.build();
    await cmt.clean();
    await cmt.build();

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with clean configure', async function(this: ITestCallbackContext) {
    await cmt.selectKit();

    await cmt.build();
    await cmt.cleanConfigure();
    await cmt.build();

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Test build twice with rebuild configure', async function(this: ITestCallbackContext) {
    // Select compiler build node dependent
    await cmt.selectKit();

    await cmt.build();
    await cmt.cleanRebuild();
    await cmt.build();

    await testEnv.result.getResultAsJson();
  }).timeout(100000);

  test('Copy compile_commands.json to a pre-determined path', async () => {
    await cmt.selectKit();
    expect(await fs.exists(compdb_cp_path), 'File shouldn\'t be there!').to.be.false;
    let retc = await cmt.configure();
    expect(retc).to.eq(0);
    expect(await fs.exists(compdb_cp_path), 'File still shouldn\'t be there').to.be.false;
    testEnv.config.updatePartial({copyCompileCommands: compdb_cp_path});
    retc = await cmt.configure();
    expect(retc).to.eq(0);
    expect(await fs.exists(compdb_cp_path), 'File wasn\'t copied').to.be.true;
  }).timeout(100000);
});
