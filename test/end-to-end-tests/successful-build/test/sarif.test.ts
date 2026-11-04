import { CMakeProject, ConfigureTrigger } from '@cmt/cmakeProject';
import collections from '@cmt/diagnostics/collections';
import { clearExistingKitConfigurationFile, DefaultEnvironment, expect, getFirstSystemKit } from '@test/util';
import * as path from 'path';
import * as vscode from 'vscode';

suite('SARIF configure diagnostics', () => {
    let cmakeProject: CMakeProject;
    let testEnv: DefaultEnvironment;
    let warningFile: string;

    setup(async function (this: Mocha.Context) {
        this.timeout(100000);

        testEnv = new DefaultEnvironment('test/end-to-end-tests/successful-build/project-folder', 'build', 'output.txt');
        warningFile = path.join(testEnv.projectFolder.location, 'sarif-warning.cmake');
        cmakeProject = await CMakeProject.create(testEnv.wsContext, "${workspaceFolder}/");
        if (!(await cmakeProject.getCMakeExecutable()).isRichSarifSupported) {
            this.skip();
        }

        await clearExistingKitConfigurationFile();
        await cmakeProject.setKit(await getFirstSystemKit());

        testEnv.projectFolder.buildDirectory.clear();
    });

    teardown(async function (this: Mocha.Context) {
        this.timeout(30000);
        await cmakeProject.asyncDispose();
        testEnv.teardown();
    });

    /** Configure with a warning raised from `sarif-warning.cmake`, and return what it put in the Problems panel. */
    async function configureWithWarning(): Promise<readonly vscode.Diagnostic[]> {
        const result = await cmakeProject.configureInternal(ConfigureTrigger.runTests, [`-DCMAKE_PROJECT_INCLUDE=${warningFile}`]);
        expect(result.exitCode).to.eq(0);
        return collections.cmake.get(vscode.Uri.file(warningFile)) ?? [];
    }

    test('Configure reports diagnostics from the SARIF log, once', async () => {
        testEnv.config.updatePartial({ loadSarifFile: true });
        const diags = await configureWithWarning();
        // Only the SARIF log gives the message without CMake's "CMake Warning at ..." heading.
        expect(diags.map(d => d.message)).to.deep.equal(['SARIF end-to-end warning']);
        expect(diags[0].range.start.line).to.eq(1);
    }).timeout(100000);

    test('Configure reports diagnostics from CMake\'s output when cmake.loadSarifFile is disabled', async () => {
        testEnv.config.updatePartial({ loadSarifFile: false });
        const diags = await configureWithWarning();
        expect(diags).to.have.lengthOf(1);
        expect(diags[0].message).to.match(/^CMake Warning at .*sarif-warning\.cmake:2 \(message\):\s*SARIF end-to-end warning$/);
        expect(diags[0].range.start.line).to.eq(1);
    }).timeout(100000);
});
