import {clearExistingKitConfigurationFile, expect, getExtension} from '@test/util';

// This tests will be skipped when a Visual Studio installation marker (Env.HasVs=true) is present.
// It is not possible to hide an installation against the test. In that case
// it is not possible to test a no present kit, because VS will provide always kits.
(process.env.HasVs == 'true' ? suite.skip.bind(suite) : suite)('No present kit', () => {
  let path_backup = '';
  suiteSetup(async () => {
    await clearExistingKitConfigurationFile();

    path_backup = process.env.PATH!;
    // The tests will use the PATH environment variable to scan for compilers,
    // with no PATH content no compiler will be found.
    process.env.PATH = '';
  });
  suiteTeardown(() => {
    // restores old path
    process.env.PATH = path_backup;
  });

  test('Scan for no existing kit should return no selected kit', async () => {
    const cmt = await getExtension();
    await cmt.scanForKits();
    expect(await cmt.selectKit()).to.be.eq(null);
  });

  test('Configure ', async () => {
    const cmt = await getExtension();
    await cmt.scanForKits();

    expect(await cmt.configure()).to.be.eq(-1);
  });

  test('Build', async () => {
    const cmt = await getExtension();
    await cmt.scanForKits();

    expect(await cmt.build()).to.be.eq(-1);
  });
});