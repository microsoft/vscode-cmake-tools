import { ConfigureTrigger } from '@cmt/cmakeProject';
import { expect } from 'chai';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';
import { ConfigureResult } from '@cmt/drivers/cmakeDriver';

suite('Smoke test: bad project', () => {
    test('Fails to build', async () => {
        smokeSuite('Smoke test: bad project', suite => {
            suite.smokeTest('Fails to build', async test => test.withCMakeProject({
                kit: await smokeTestDefaultKit(),
                async run(cmakeProject) {
                    expect((await cmakeProject.getCMakeExecutable()).isFileApiModeSupported).to.be.equal(true);
                    const retc = (await cmakeProject.configureInternal(ConfigureTrigger.runTests)).exitCode;
                    // Test will fail because of a bad command:
                    expect(retc, 'Configure should have failed').to.eq(1);
                }
            }));
        });
    });

    test('Fires onConfigureResult on failure', async () => {
        smokeSuite('Smoke test: bad project', suite => {
            suite.smokeTest('Fires onConfigureResult on failure', async test => test.withCMakeProject({
                kit: await smokeTestDefaultKit(),
                async run(cmakeProject) {
                    let receivedResult: ConfigureResult | undefined;
                    let fireCount = 0;
                    const sub = cmakeProject.onConfigureResult(result => {
                        receivedResult = result;
                        fireCount++;
                    });

                    try {
                        await cmakeProject.configureInternal(ConfigureTrigger.runTests);

                        expect(fireCount, 'onConfigureResult should fire exactly once').to.eq(1);
                        expect(receivedResult, 'onConfigureResult should have fired').to.not.be.undefined;
                        expect(receivedResult!.exitCode, 'Exit code should indicate failure').to.not.eq(0);
                    } finally {
                        sub.dispose();
                    }
                }
            }));
        });
    });
});

