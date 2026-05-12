import { CMakeProject } from '@cmt/cmakeProject';
import { expect } from 'chai';
import * as vscode from 'vscode';

import { smokeSuite, smokeTestDefaultKit } from '@test/smoke/smoke';

suite('Smoke test: good project', () => {
    test('Successful configure', async () => {
        smokeSuite('Smoke test: good project', suite => {
            let cmakeProject: CMakeProject;
            suite.setup('create cmake-tools', async test => {
                cmakeProject = await test.createCMakeProject({
                    kit: await smokeTestDefaultKit()
                });
            });
            suite.teardown('dispose cmake-tools', async () => {
                if (cmakeProject) {
                    await cmakeProject.asyncDispose();
                }
            });
            suite.smokeTest('Successful configure', async () => {
                expect((await cmakeProject.configure()).exitCode).to.eq(0);
            });
        });
    });

    test('languageServerOnlyMode: getCMakeDriverInstance returns null', async () => {
        smokeSuite('Smoke test: languageServerOnlyMode driver', suite => {
            let cmakeProject: CMakeProject;
            suite.setup('create cmake-tools', async test => {
                cmakeProject = await test.createCMakeProject({
                    kit: await smokeTestDefaultKit()
                });
            });
            suite.teardown('dispose cmake-tools', async () => {
                if (cmakeProject) {
                    await cmakeProject.asyncDispose();
                }
            });
            suite.smokeTest('getCMakeDriverInstance returns null when languageServerOnlyMode is enabled', async () => {
                // Enable languageServerOnlyMode
                cmakeProject.workspaceContext.config.updatePartial({ languageServerOnlyMode: true });

                // Verify getCMakeDriverInstance returns null
                const driver = await cmakeProject.getCMakeDriverInstance();
                expect(driver).to.be.null;
            });
        });
    });

    test('languageServerOnlyMode: doCMakeFileChangeReconfigure skips reconfiguration', async () => {
        smokeSuite('Smoke test: languageServerOnlyMode reconfigure', suite => {
            let cmakeProject: CMakeProject;
            suite.setup('create cmake-tools', async test => {
                cmakeProject = await test.createCMakeProject({
                    kit: await smokeTestDefaultKit()
                });
            });
            suite.teardown('dispose cmake-tools', async () => {
                if (cmakeProject) {
                    await cmakeProject.asyncDispose();
                }
            });
            suite.smokeTest('doCMakeFileChangeReconfigure returns early when languageServerOnlyMode is enabled', async () => {
                // Enable languageServerOnlyMode
                cmakeProject.workspaceContext.config.updatePartial({ languageServerOnlyMode: true });

                // Call doCMakeFileChangeReconfigure - should return early without error
                // Use a dummy URI for testing
                const dummyUri = vscode.Uri.file(cmakeProject.sourceDir + '/CMakeLists.txt');
                await cmakeProject.doCMakeFileChangeReconfigure(dummyUri);

                // If we get here without error and no driver was created, the test passes
                const driver = await cmakeProject.getCMakeDriverInstance();
                expect(driver).to.be.null;
            });
        });
    });
});
