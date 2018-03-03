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
export CODE_TESTS_PATH=$ROOT/out/test/unit_tests
export CODE_TESTS_WORKSPACE=$ROOT/test/unit_tests/test_project_without_cmakelists
node ./node_modules/vscode/bin/test
test_error_code=$?

popd

# Forward error level
if [ $test_error_code -ne 0 ]; then
	exit $test_error_code
fi
