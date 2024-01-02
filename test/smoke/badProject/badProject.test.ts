import { ConfigureTrigger } from '@cmt/cmakeProject';
import { expect } from 'chai';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';

suite('Smoke test: bad project', () => {
    test('Fails to build', async () => {
        smokeSuite('Smoke test: bad project', suite => {
            suite.smokeTest('Fails to build', async test => test.withCMakeProject({
                kit: await smokeTestDefaultKit(),
                async run(cmakeProject) {
                    expect((await cmakeProject.getCMakeExecutable()).isFileApiModeSupported).to.be.equal(true);
                    const retc = (await cmakeProject.configureInternal(ConfigureTrigger.runTests)).result;
                    // Test will fail because of a bad command:
                    expect(retc, 'Configure should have failed').to.eq(1);
                }
            }));
        });
    });
});

