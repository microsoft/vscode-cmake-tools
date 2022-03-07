import { ConfigureTrigger } from '@cmt/cmake-tools';
import { expect } from 'chai';
import * as path from 'path';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';

/**
 * This test aims to check what occurs when CTest is not in the same directory
 * as the cmake executable
 */

suite('Smoke test: No ctest in bin dir', async () => {
    test('Successful configure', async () => {
        smokeSuite('Smoke test: No ctest in bin dir', suite => {
            suite.smokeTest('Successful configure', async ctx => ctx.withCMakeTools({
                kit: await smokeTestDefaultKit(),
                async run(cmt) {
                    const cmake_filename = process.platform === 'win32' ? 'cmake.bat' : 'cmake.sh';
                    cmt.workspaceContext.config.updatePartial({
                        cmakePath: path.join(ctx.projectDir.uri.fsPath, 'bin', cmake_filename)
                    });
                    expect(await cmt.configureInternal(ConfigureTrigger.runTests)).to.eq(0);
                    expect(await cmt.build()).to.eq(0);
                    expect(await cmt.ctest()).to.eq(0);
                }
            }));
        });
    });
});
