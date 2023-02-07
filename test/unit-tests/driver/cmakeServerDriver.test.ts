import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import CMakeProject from '@cmt/cmakeProject';
import { ConfigurationReader } from '@cmt/config';
import { CMakeServerDriver } from '@cmt/drivers/drivers';
import { Kit } from '@cmt/kit';
import { DefaultExtensionContext } from '@test/helpers/vscodefake/extensioncontext';
import { WorkspaceFolder } from 'vscode';
import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';
import { makeDriverTestsuite } from './driver-test';

async function cmakeServerDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit, workspaceFolder: WorkspaceFolder) {
    const project: CMakeProject = await CMakeProject.createForTest(config, kit, workspaceFolder, new DefaultExtensionContext());
    const driver: CMakeServerDriver = await CMakeServerDriver.create(cmake, project);
    return driver;
}

// CMake 3.18.3 has problems on macOS, but we don't have an action to install 3.18.2 right now.
// CMake Server is deprecated and unavailable after 3.20 so we will just skip the tests on macOS.
// We still have coverage on other platforms.
if (process.platform !== 'darwin') {
    makeDriverTestsuite('Server', cmakeServerDriverFactory);
    makeCodeModelDriverTestsuite('Server', cmakeServerDriverFactory);
}
