import * as cms_driver from '@cmt/drivers/cms-driver';
import { CMakeExecutable } from '@cmt/cmake/cmake-executable';
import { ConfigurationReader } from '@cmt/config';
import { Kit, CMakeGenerator } from '@cmt/kit';
import { CMakePreconditionProblemSolver, CMakeDriver } from '@cmt/drivers/driver';
import { makeDriverTestsuite } from './driver-test';
import { makeCodeModelDriverTestsuite } from './driver-codemodel-tests';

async function cmakeServerDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader,
  kit: Kit|null, workspaceFolder: string | null,
  preconditionHandler: CMakePreconditionProblemSolver,
  preferredGenerators: CMakeGenerator[]) {
    const d : CMakeDriver= await cms_driver.CMakeServerClientDriver.create(cmake, config, kit, workspaceFolder, preconditionHandler, preferredGenerators);
    return d;
}

makeDriverTestsuite(cmakeServerDriverFactory);
makeCodeModelDriverTestsuite(cmakeServerDriverFactory);