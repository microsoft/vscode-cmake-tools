@echo off
setlocal

pushd
set HasVs=true
set CMT_TESTING=1

REM Run all tests with a workspace folder where no CMakeLists.txt exists
REM This prevents automatic loading of the extension.
set CODE_TESTS_PATH=%~dp0\..\out\test\extension-tests\without-cmakelist-file
set CODE_TESTS_WORKSPACE=%~dp0\..\test\extension-tests\without-cmakelist-file\project-folder
node ./node_modules/vscode/bin/test
set TEST_ERRONO=%errorlevel%

popd

REM forward error level
if "%TEST_ERRONO%" NEQ "0" (
   exit /b %TEST_ERRONO%
)

pushd
set HasVs=true
set CMT_TESTING=1

REM Run all tests with a workspace folder where no CMakeLists.txt exists
REM This prevents automatic loading of the extension.
set CODE_TESTS_PATH=%~dp0\..\out\test\extension-tests\successful-build
set CODE_TESTS_WORKSPACE=%~dp0\..\test\extension-tests\successful-build\project-folder
node ./node_modules/vscode/bin/test
set TEST_ERRONO=%errorlevel%

popd

REM forward error level
if "%TEST_ERRONO%" NEQ "0" (
   exit /b %TEST_ERRONO%
)
endlocal
