#!/bin/bash

pushd .

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

cd $ROOT

export HasVs=false
export CMT_TESTING=1

# Run all tests with a workspace folder where no CMakeLists.txt exists
# This prevents automatic loading of the extension.
export CODE_TESTS_PATH=$ROOT/out/test/extension_tests/without_cmakelist_file
export CODE_TESTS_WORKSPACE=$ROOT/test/extension_tests/without_cmakelist_file/project_folder
node ./node_modules/vscode/bin/test
test_error_code=$?

export CODE_TESTS_PATH=$ROOT/out/test/extension_tests/successful_build
export CODE_TESTS_WORKSPACE=$ROOT/test/extension_tests/successful_build/project_folder
node ./node_modules/vscode/bin/test
test_error_code_2=$?

popd

# Forward error level
if [ $test_error_code -ne 0 ]; then
	exit $test_error_code
fi

if [ $test_error_code_2 -ne 0 ]; then
	exit $test_error_code
fi
