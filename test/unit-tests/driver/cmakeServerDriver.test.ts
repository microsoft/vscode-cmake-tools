import { CMakeExecutable } from '@cmt/cmakeExecutable';
import { ConfigurationReader } from '@cmt/config';
import { CMakeServerDriver, CMakePreconditionProblemSolver } from '@cmt/drivers/drivers';
import { CMakeGenerator, Kit } from '@cmt/kits/kit';
import { makeCodeModelDriverTestsuite } from '@test/unit-tests/driver/driver-codemodel-tests';
import { makeDriverTestsuite } from '@test/unit-tests/driver/driver-test';

async function cmakeServerDriverFactory(cmake: CMakeExecutable, config: ConfigurationReader, kit: Kit | null, workspaceFolder: string, preconditionHandler: CMakePreconditionProblemSolver, preferredGenerators: CMakeGenerator[]) {
    const d: CMakeServerDriver = await CMakeServerDriver.create(cmake, config, workspaceFolder || "", false, false, kit, null, null, null, null, null, workspaceFolder, preconditionHandler, preferredGenerators);
    return d;
}

function driverSupportsCMake(cmake: CMakeExecutable) {
    return cmake.isServerModeSupported ?? false;
}

// CMake 3.18.3 has problems on macOS, but we don't have an action to install 3.18.2 right now.
// CMake Server is deprecated and unavailable after 3.20 so we will just skip the tests on macOS.
// We still have coverage on other platforms.
// Also removing support for CMake Server on Windows as we switch to windows-2022 and beyond. CMake version 3.20 and below
// don't have VS 2022 support, and CMake 3.20 and beyond don't have server support, so we will disable the tests on Windows as well.
if (process.platform !== 'darwin' && process.platform !== 'win32') {
    makeDriverTestsuite('Server', cmakeServerDriverFactory, driverSupportsCMake);
    makeCodeModelDriverTestsuite('Server', cmakeServerDriverFactory, driverSupportsCMake);
}
