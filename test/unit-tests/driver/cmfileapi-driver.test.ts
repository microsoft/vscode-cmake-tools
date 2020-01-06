import { CMakeFileApiDriver } from '@cmt/drivers/cmfileapi-driver';
import { CMakeExecutable } from '@cmt/cmake/cmake-executable';
import { ConfigurationReader } from '@cmt/config';
import { Kit, CMakeGenerator } from '@cmt/kit';
import { CMakePreconditionProblemSolver, CMakeDriver } from '@cmt/drivers/driver';
import { makeDriverTestsuite } from './driver-test';
import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';

async function cmakeFileApiDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader,
  kit: Kit|null, workspaceFolder: string | null,
  preconditionHandler: CMakePreconditionProblemSolver,
  preferredGenerators: CMakeGenerator[]) {
    const d : CMakeDriver= await CMakeFileApiDriver.create(cmake, config, kit, workspaceFolder, preconditionHandler, preferredGenerators);
    return d;
}

makeDriverTestsuite(cmakeFileApiDriverFactory);
makeCodeModelDriverTestsuite(cmakeFileApiDriverFactory);