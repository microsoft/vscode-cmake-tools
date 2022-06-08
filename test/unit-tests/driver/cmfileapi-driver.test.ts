import { CMakeExecutable } from '@cmt/cmake/cmakeExecutable';
import { ConfigurationReader } from '@cmt/config';
import { CMakeFileApiDriver } from '@cmt/drivers/cmakeFileApiDriver';
import { CMakeDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/cmakeDriver';
import { CMakeGenerator, Kit } from '@cmt/kit';

import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';
import { makeDriverTestsuite } from './driver-test';

async function cmakeFileApiDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string | null, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[]) {
    const d: CMakeDriver = await CMakeFileApiDriver.create(cmake, config, false, kit, null, null, null, workspaceFolder, preconditionHandler, preferredGenerators);
    return d;
}

makeDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
makeCodeModelDriverTestsuite('FileAPI', cmakeFileApiDriverFactory);
