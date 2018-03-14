#!/bin/bash

set -eu

pushd .

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

cd $ROOT

# Run tslint
node ./node_modules/tslint/bin/tslint -p $ROOT

export HasVs=false
export CMT_TESTING=1

# Run all tests with a workspace folder where no CMakeLists.txt exists
# This prevents automatic loading of the extension.
export CODE_TESTS_PATH=$ROOT/out/test/unit-tests
export CODE_TESTS_WORKSPACE=$ROOT/test/unit-tests/test-project-without-cmakelists
node ./node_modules/vscode/bin/test

popd
