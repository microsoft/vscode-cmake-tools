import * as chai from 'chai';
import {expect} from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import {clearExistingKitConfigurationFile} from '../../../test-helpers';
import {DefaultEnvironment} from '../../../helpers/test/default-environment';

import {CMakeTools} from '../../../../src/cmake-tools';

interface BuildSystemConfiguration {
  defaultKit: string;
  expectedDefaultGenerator: string;
}

let workername = process.env.APPVEYOR_BUILD_WORKER_IMAGE;
if( workername === undefined) {
  workername = 'DevPC';
}

const DefaultCompilerMakeSystem: {[os: string]: BuildSystemConfiguration[]} = {
  ['DevPC']: [{defaultKit: 'VisualStudio.14.0', expectedDefaultGenerator: 'Visual Studio 14 2015'}],
  ['Visual Studio 2017']: [{defaultKit: 'Visual Studio Community 2017', expectedDefaultGenerator: 'Visual Studio 15 2017'}],
  ['Visual Studio 2017 Preview']: [{defaultKit: 'Visual Studio Community 2017', expectedDefaultGenerator: 'Visual Studio 15 2017'}],
  ['Visual Studio 2015']: [{defaultKit: 'VisualStudio.14.0', expectedDefaultGenerator: 'Visual Studio 14 2015'}],
  ['Visual Studio 2013']: [{defaultKit: 'VisualStudio.11.0', expectedDefaultGenerator: 'Visual Studio 11 2012'}]
};

DefaultCompilerMakeSystem[workername].forEach(buildsystem => {
  suite(`Prefered generators (${buildsystem.defaultKit})`, async() => {
    let cmt: CMakeTools;
    let testEnv: DefaultEnvironment;
    const path_backup = process.env.PATH;

    setup(async function(this: Mocha.IBeforeAndAfterContext) {
      if (process.env.HasVs != 'true') {
        this.skip();
      }
      this.timeout(100000);

      testEnv = new DefaultEnvironment('test/extension_tests/successful_build/project_folder',
                                       'build',
                                       'output.txt',
                                       buildsystem.defaultKit);
      cmt = await CMakeTools.create(testEnv.vsContext);

      // This test will use all on the same kit.
      // No rescan of the tools is needed
      // No new kit selection is needed
      await clearExistingKitConfigurationFile();
      await cmt.scanForKits();

      testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function(this: Mocha.IBeforeAndAfterContext) {
      this.timeout(30000);

      await cmt.asyncDispose();
      testEnv.teardown();

      process.env.PATH = path_backup;
    });

    test('Use kit preferred generator', async() => {
      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', []);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    }).timeout(60000);

    test('Get no error messages for missing preferred generators', async() => {
      process.env.PATH = '';
      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', ['Ninja', 'Unix Makefiles']);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq(buildsystem.expectedDefaultGenerator);
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    }).timeout(60000);

    test('Use settings preferred generators', async() => {
      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', ['Ninja', 'Unix Makefiles']);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq("Ninja");
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    }).timeout(60000);

    test.skip('Non preferred generators configured in settings and kit', async() => {
      await cmt.selectKit();
      await testEnv.setting.changeSetting('preferredGenerators', []);
      expect(await cmt.build()).to.be.eq(0);
      const result = await testEnv.result.getResultAsJson();
      expect(result['cmake-generator']).to.eq("Ninja");
      expect(testEnv.errorMessagesQueue.length).to.be.eq(0);
    });
  });
});
