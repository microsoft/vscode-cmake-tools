import {CMakeExecutable} from '@cmt/cmake/cmake-executable';
import {ConfigurationReader} from '@cmt/config';
import * as cms_driver from '@cmt/drivers/cms-driver';
import {CMakeDriver, CMakePreconditionProblemSolver} from '@cmt/drivers/driver';
import {CMakeGenerator, Kit} from '@cmt/kit';

import {makeCodeModelDriverTestsuite} from './driver-codemodel-tests';
import {makeDriverTestsuite} from './driver-test';

async function cmakeServerDriverFactory(cmake: CMakeExecutable,
                                        config: ConfigurationReader,
                                        kit: Kit|null,
                                        workspaceFolder: string|null,
                                        preconditionHandler: CMakePreconditionProblemSolver,
                                        preferredGenerators: CMakeGenerator[]) {
  const d: CMakeDriver = await cms_driver.CMakeServerClientDriver
                             .create(cmake, config, false, kit, null, workspaceFolder, preconditionHandler, preferredGenerators);
  return d;
}

makeDriverTestsuite(cmakeServerDriverFactory);
makeCodeModelDriverTestsuite(cmakeServerDriverFactory);