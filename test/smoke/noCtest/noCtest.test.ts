import { ConfigureTrigger } from '@cmt/cmakeProject';
import { expect } from 'chai';
import * as path from 'path';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';

/**
 * This test aims to check what occurs when CTest is not in the same directory
 * as the cmake executable
 */

suite('Smoke test: No ctest in bin dir', () => {
    test('Successful configure', async () => {
        smokeSuite('Smoke test: No ctest in bin dir', suite => {
            suite.smokeTest('Successful configure', async ctx => ctx.withCMakeProject({
                kit: await smokeTestDefaultKit(),
                async run(cmakeProject) {
                    const cmake_filename = process.platform === 'win32' ? 'cmake.bat' : 'cmake.sh';
                    cmakeProject.workspaceContext.config.updatePartial({
                        cmakePath: path.join(ctx.projectDir.uri.fsPath, 'bin', cmake_filename)
                    });
                    expect((await cmakeProject.configureInternal(ConfigureTrigger.runTests)).result).to.eq(0);
                    expect(await cmakeProject.build()).to.eq(0);
                    expect(await cmakeProject.ctest()).to.eq(0);
                }
            }));
        });
    });
});
