import { ConfigureTrigger } from '@cmt/cmake-tools';
import { expect } from 'chai';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';

suite('Smoke test: bad project', async () => {
    test('Fails to build', async () => {
        smokeSuite('Smoke test: bad project', suite => {
            suite.smokeTest('Fails to build', async test => test.withCMakeTools({
                kit: await smokeTestDefaultKit(),
                async run(cmt) {
                    expect((await cmt.getCMakeExecutable()).isFileApiModeSupported).to.be.equal(true);
                    const retc = await cmt.configureInternal(ConfigureTrigger.runTests);
                    // Test will fail because of a bad command:
                    expect(retc, 'Configure should have failed').to.eq(1);
                }
            }));
        });
    });
});

