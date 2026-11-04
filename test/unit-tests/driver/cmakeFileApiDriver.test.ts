import { CMakeExecutable } from '@cmt/cmakeExecutable';
import { ConfigurationReader } from '@cmt/config';
import { CMakeFileApiDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/drivers';
import { CMakeGenerator, Kit } from '@cmt/kits/kit';
import { ConfigurePreset } from '@cmt/presets/preset';

import { makeCodeModelDriverTestsuite } from '@test/unit-tests/driver/driver-codemodel-tests';
import { makeSarifDriverTestsuite } from '@test/unit-tests/driver/driver-sarif-tests';
import { makeDriverTestsuite } from '@test/unit-tests/driver/driver-test';

async function cmakeFileApiDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[], configurePreset?: ConfigurePreset) {
    const d: CMakeFileApiDriver = await CMakeFileApiDriver.create(cmake, config, workspaceFolder || "", false, !!configurePreset, configurePreset ? null : kit, configurePreset ?? null, null, null, null, null, workspaceFolder, preconditionHandler, preferredGenerators);
    return d;
}

function driverSupportsCMake(cmake: CMakeExecutable) {
    return cmake.isFileApiModeSupported ?? false;
}

makeDriverTestsuite('FileAPI', cmakeFileApiDriverFactory, driverSupportsCMake);
makeCodeModelDriverTestsuite('FileAPI', cmakeFileApiDriverFactory, driverSupportsCMake);
makeSarifDriverTestsuite('FileAPI', cmakeFileApiDriverFactory, driverSupportsCMake);
