import {CMakeTools} from '@cmt/cmake-tools';
import {expect} from 'chai';

import {smokeSuite} from '../smoke';

// tslint:disable:no-unused-expression

smokeSuite('good-project', suite => {
  let cmt: CMakeTools;
  suite.setup('create cmake-tools', async test => { cmt = await test.createCMakeTools({kit: '__unspec__'}); });
  suite.teardown('dispose cmake-tools', async () => {
    if (cmt) {
      await cmt.asyncDispose();
    }
  });
  suite.smokeTest('configure', async () => { expect(await cmt.configure()).to.eq(0); });
});

// smokeSuite(async ctx => {
//   return ctx.withCMakeTools({
//     kit: '__unspec__',
//     async test(cmt) {
//       // Configure should pass:
//       expect(await cmt.configure()).to.eq(0);

//       // Build should pass:
//       expect(await cmt.build()).to.eq(0);

//       // Clean should work:
//       expect(await cmt.clean()).to.eq(0);

//       // Building a target by name should work
//       expect(await cmt.build('test-exe')).to.eq(0);

//       // Building a target with the wrong name will fail
//       expect(await cmt.build('non-existent-target')).to.not.eq(0);

//       // Find an executabel target with the correct name
//       const targets = await cmt.executableTargets;
//       const exe = targets.find(t => t.name === 'test-exe');
//       expect(exe).to.not.eq(undefined);

//       // Launch a target with the given name
//       await cmt.setLaunchTargetByName('test-exe');
//       const term = (await cmt.launchTarget())!;
//       expect(term).to.not.be.null;
//       term.dispose();
//     }
//   });
// });
