import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import { ConfigurationReader } from '@cmt/config';
import { CMakeFileApiDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/drivers';
import { CMakeGenerator, Kit } from '@cmt/kit';

import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';
import { makeDriverTestsuite } from './driver-test';

async function cmakeFileApiDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[]) {
    const d: CMakeFileApiDriver = await CMakeFileApiDriver.create(cmake, config, workspaceFolder || "", false, false, kit, null, null, null, null, null, workspaceFolder, preconditionHandler, preferredGenerators);
    return d;
}

makeDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
makeCodeModelDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
