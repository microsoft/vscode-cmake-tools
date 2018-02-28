@echo off
setlocal

pushd
set HasVs=false
set CMT_TESTING="1"

REM Run all tests with a workspace folder where no CMakeLists.txt exists
REM This prevents automatic loading of the extension.
set CODE_TESTS_PATH=%~dp0\..\out\test
set CODE_TESTS_WORKSPACE=%~dp0\..\test\test_project_without_cmakelists
node ./node_modules/vscode/bin/test
set TEST_ERRONO=%errorlevel%

popd

REM forward error level
if "%TEST_ERRONO%" NEQ "0" (
   exit /b %TEST_ERRONO%
)
endlocal