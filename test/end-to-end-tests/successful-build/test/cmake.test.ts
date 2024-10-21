import { CMakeProject } from '@cmt/cmakeProject';
import { clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';

suite('cmake', () => {
    let cmakeProject: CMakeProject;
    let testEnv: DefaultEnvironment;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        const build_loc = 'build';
        const exe_res = 'output.txt';

        testEnv = new DefaultEnvironment('test/end-to-end-tests/successful-build/project-folder', build_loc, exe_res);
        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}/");

        // This test will use all on the same kit.
        // No rescan of the tools is needed
        // No new kit selection is needed
        await clearExistingKitConfigurationFile();
        await cmakeProject.setKit(await getFirstSystemKit());

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await cmakeProject.asyncDispose();
        testEnv.teardown();
    });

    test('No cmake present message', async () => {
        testEnv.config.updatePartial({ cmakePath: 'cmake3' });
        await cmakeProject.allTargetName;  // Using an cmaketools command which creates the instance once.

        expect(testEnv.errorMessagesQueue.length).to.eql(1);  // Expect only cmake error message
        expect(testEnv.errorMessagesQueue[0]).to.contain('Bad CMake executable');
        expect(testEnv.errorMessagesQueue[0]).to.contain('Check to make sure it is installed');
    }).timeout(60000);
});
