import {CMakeTools} from '@cmt/cmake-tools';
import {TestProgramResult} from '@test/helpers/testprogram/test-program-result';
import {DefaultEnvironment, expect} from '@test/util';

suite('Build', async () => {
  let cmt: CMakeTools;
  let testEnv: DefaultEnvironment;

  setup(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(100000);

    const build_loc = 'build';
    const exe_res = 'output.txt';

    testEnv = new DefaultEnvironment('test/extension-tests/successful-build/project-folder', build_loc, exe_res);
    cmt = await CMakeTools.create(testEnv.vsContext, testEnv.wsContext);

    // This test will use all on the same kit.
    // No rescan of the tools is needed
    // No new kit selection is needed
    //await clearExistingKitConfigurationFile();
    //await cmt.scanForKits();
    //await cmt.selectKit();

    testEnv.projectFolder.buildDirectory.clear();
  });

  teardown(async function(this: Mocha.IBeforeAndAfterContext) {
    this.timeout(30000);
    await cmt.asyncDispose();
    testEnv.teardown();
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

  test('Test kit switch after missing preferred generator', async () => {
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build();

    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();

    await cmt.build();
    const result1 = await testEnv.result.getResultAsJson();
    expect(result1['compiler']).to.eql('Microsoft Visual Studio');
  }).timeout(100000);

  test('Test kit switch between different preferrred generators and compilers', async () => { // Failed
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build(); // Test invalid build target (like all on visual studio project<)
    //const result = await testEnv.result.getResultAsJson();

    //expect(result['compiler']).to.eql('GNU GCC/G++');

    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();

    await cmt.build();
    const result1 = await testEnv.result.getResultAsJson();
    expect(result1['compiler']).to.eql('Microsoft Visual Studio');

    // The test did not clean up the build directory so that the vs compiler is used
  }).timeout(100000);

  test.only('Test kit switch between different preferrred generators and same compiler', async () => { // Failed
    testEnv.config.updatePartial({preferredGenerators: []});

    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build(); // Test invalid build target (like all on visual studio project<)
    //const result = await testEnv.result.getResultAsJson();

    //expect(result['compiler']).to.eql('GNU GCC/G++');

    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1 - Ninja";
    await cmt.selectKit();

    await cmt.build();
    //const result1 = await testEnv.result.getResultAsJson();
    //expect(result1['compiler']).to.eql('Microsoft Visual Studio');

    // The test did not clean up the build directory so that the vs compiler is used
  }).timeout(100000);

  test('Test kit switch kits after configure', async () => { // Failed
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build(); // Test invalid build target (like all on visual studio project<)
    //const result = await testEnv.result.getResultAsJson();

    //expect(result['compiler']).to.eql('GNU GCC/G++');

    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();
    await cmt.configure();

    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('GNU GCC/G++');
  }).timeout(100000);

  test('Test build twice', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('GNU GCC/G++');
  }).timeout(100000);

  test('Test build twice with clean', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build();
    await cmt.clean();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('GNU GCC/G++');
  }).timeout(100000);

  test('Test build twice with clean configure', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build();
    await cmt.cleanConfigure();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('GNU GCC/G++');
  }).timeout(100000);

  test('Test build twice with rebuild configure', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="GCC 4.8.1";
    await cmt.selectKit();

    await cmt.build();
    await cmt.cleanRebuild();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('GNU GCC/G++');
  }).timeout(100000);


  test('Test build twice', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();

    await cmt.build();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('Microsoft Visual Studio');
  }).timeout(100000);

  test('Test build twice with clean', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();

    await cmt.build();
    await cmt.clean();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('Microsoft Visual Studio'');
  }).timeout(100000);

  test('Test build twice with clean configure', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();

    await cmt.build();
    await cmt.cleanConfigure();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('Microsoft Visual Studio');
  }).timeout(100000);

  test('Test build twice with rebuild configure', async () => { // OK
    testEnv.kitSelection.defaultKitLabel="VisualStudio";
    await cmt.selectKit();

    await cmt.build();
    await cmt.cleanRebuild();
    await cmt.build();
    // const result1 = await testEnv.result.getResultAsJson();
    // expect(result1['compiler']).to.eql('Microsoft Visual Studio');
  }).timeout(100000);
});
