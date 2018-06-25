import {expect} from 'chai';

import {smokeSuite, smokeTestDefaultKit} from '../smoke';

smokeSuite('bad-project', suite => {
  suite.smokeTest('fails to build', async test => {
    return test.withCMakeTools({
      kit: await smokeTestDefaultKit(),
      async run(cmt) {
        const retc = await cmt.configure();
        // Test will fail because of a bad command:
        expect(retc, 'Configure should have failed').to.eq(1);
      }
    });
  });
});
