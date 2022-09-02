import { CMakeProject } from '@cmt/cmakeProject';
import { expect } from 'chai';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';

suite('Smoke test: good project', () => {
    test('Successful configure', async () => {
        smokeSuite('Smoke test: good project', suite => {
            let cmt: CMakeProject;
            suite.setup('create cmake-tools', async test => {
                cmt = await test.createCMakeTools({
                    kit: await smokeTestDefaultKit()
                });
            });
            suite.teardown('dispose cmake-tools', async () => {
                if (cmt) {
                    await cmt.asyncDispose();
                }
            });
            suite.smokeTest('Successful configure', async () => {
                expect(await cmt.configure()).to.eq(0);
            });
        });
    });
});
