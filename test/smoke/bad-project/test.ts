import {expect} from 'chai';

import { smokeSuite } from '../smoke';

smokeSuite('bad-project', suite => {
  suite.smokeTest('fails to build', test => {
    return test.withCMakeTools({
      kit: '__unspec__',
      async run(cmt) {
        const retc = await cmt.configure();
        // Test will fail because of a bad command:
        expect(retc, 'Configure should have failed').to.eq(1);
      }
    });
  });
});

