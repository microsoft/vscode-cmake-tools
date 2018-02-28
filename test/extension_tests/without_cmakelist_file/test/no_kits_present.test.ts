import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {expect} from 'chai';

import {clearExistingKitConfigurationFile, getExtension} from '../../../test_helpers';

// This test will be skip when a Visual Studio installation marker (Env.HasVs=true) is present.
// At the moment it is not possible to hide an installation against the test. In that case
// it is not possible to test a no present kit, because VS will provid always kits.
(process.env.HasVs == 'true' ? suite.skip : suite)('No present kit',() => {
  let path_backup = '';
  suiteSetup(()=>{
    clearExistingKitConfigurationFile();

    // Test will use path to scan for compilers
    // with no path content there is no compiler found
    path_backup = process.env.PATH!;
    process.env.PATH = '';
  });
  suiteTeardown(() => {
    // restores old path
    process.env.PATH = path_backup;
  })

  test('Scan for no existing kit should return no selected kit', async() => {
    const cmt = await getExtension();
    await cmt.scanForKits();
    expect(await cmt.selectKit()).to.be.eq(null);
  });

  test('Configure ', async() => {
    const cmt = await getExtension();
    await cmt.scanForKits();

    expect(await cmt.configure()).to.be.eq(-1);
  });

  test('Build', async() => {
    const cmt = await getExtension();
    await cmt.scanForKits();

    expect(await cmt.build()).to.be.eq(-1);
  });
});