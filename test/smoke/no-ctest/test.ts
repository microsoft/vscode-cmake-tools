import {ConfigureTrigger} from '@cmt/cmake-tools';
import {expect} from 'chai';
import * as path from 'path';

import {smokeSuite, smokeTestDefaultKit} from '../smoke';

/**
 * This test aims to check what occurs when CTest is not in the same directory
 * as the cmake executable
 */

// tslint:disable:no-unused-expression

smokeSuite('no-ctest-in-bindir', suite => {
  suite.smokeTest('configure', async ctx => {
    return ctx.withCMakeTools({
      kit: await smokeTestDefaultKit(),
      async run(cmt) {
        const cmake_filename = process.platform == 'win32' ? 'cmake.bat' : 'cmake.sh';
        cmt.workspaceContext.config.updatePartial({
          cmakePath: path.join(ctx.projectDir.uri.fsPath, 'bin', cmake_filename),
        });
        expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.eq(0);
        expect(await cmt.build()).to.eq(0);
        expect(await cmt.ctest()).to.eq(0);
      }
    });
  });
});
