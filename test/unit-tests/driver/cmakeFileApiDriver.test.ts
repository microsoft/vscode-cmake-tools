import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import CMakeProject from '@cmt/cmakeProject';
import { ConfigurationReader } from '@cmt/config';
import { CMakeFileApiDriver } from '@cmt/drivers/drivers';
import { Kit } from '@cmt/kit';
import { DefaultExtensionContext } from '@test/helpers/vscodefake/extensioncontext';
import { WorkspaceFolder } from 'vscode';

import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';
import { makeDriverTestsuite } from './driver-test';

async function cmakeFileApiDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit, workspaceFolder: WorkspaceFolder) {
    const project: CMakeProject = await CMakeProject.createForTest(config, kit, workspaceFolder, new DefaultExtensionContext());
    const driver: CMakeFileApiDriver = await CMakeFileApiDriver.create(cmake, project);
    return driver;
}

makeDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
makeCodeModelDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
