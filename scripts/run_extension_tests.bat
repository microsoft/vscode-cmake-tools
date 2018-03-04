@echo off
setlocal

pushd
set HasVs=true
set CMT_TESTING=1

REM Run all tests with a workspace folder where no CMakeLists.txt exists
REM This prevents automatic loading of the extension.
set CODE_TESTS_PATH=%~dp0\..\out\test\extension_tests\without_cmakelist_file
set CODE_TESTS_WORKSPACE=%~dp0\..\test\extension_tests\without_cmakelist_file\project_folder
node ./node_modules/vscode/bin/test
set TEST_ERRONO=%errorlevel%

set CODE_TESTS_PATH=%~dp0\..\out\test\extension_tests\successful_build
set CODE_TESTS_WORKSPACE=%~dp0\..\test\extension_tests\successful_build\project_folder
node ./node_modules/vscode/bin/test
set TEST_ERRONO_2=%errorlevel%

popd

REM forward error level
if "%TEST_ERRONO%" NEQ "0" (
   exit /b %TEST_ERRONO%
)
if "%TEST_ERRONO_2%" NEQ "0" (
   exit /b %TEST_ERRONO%
)
endlocal
