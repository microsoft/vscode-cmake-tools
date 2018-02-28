@echo off
setlocal

pushd
set HasVs=true
set CMT_TESTING="1"

REM Run all tests with a workspace folder where no CMakeLists.txt exists
REM This prevents automatic loading of the extension.
set CODE_TESTS_PATH=%~dp0\..\out\test
set CODE_TESTS_WORKSPACE=%~dp0\..\test\test_project_without_cmakelists
node ./node_modules/vscode/bin/test

popd

endlocal