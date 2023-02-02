import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import CMakeProject from '@cmt/cmakeProject';
import { ConfigurationReader } from '@cmt/config';
import { CMakeFileApiDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/drivers';
import { Kit } from '@cmt/kit';
import { WorkspaceFolder } from 'vscode';

import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';
import { makeDriverTestsuite } from './driver-test';

async function cmakeFileApiDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit, workspaceFolder: WorkspaceFolder, preconditionHandler?: CMakePreconditionProblemSolver) {
    let project: CMakeProject = await CMakeProject.createForTest(config, kit, workspaceFolder, preconditionHandler);
    const d: CMakeFileApiDriver = await CMakeFileApiDriver.create(cmake, project);
    return d;
}

makeDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
makeCodeModelDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
