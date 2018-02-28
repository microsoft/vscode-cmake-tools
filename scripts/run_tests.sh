pushd .

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

cd $ROOT

HasVs=false
CMT_TESTING=1

# Run all tests with a workspace folder where no CMakeLists.txt exists
# This prevents automatic loading of the extension.
CODE_TESTS_PATH=$ROOT/../out/test
CODE_TESTS_WORKSPACE=$ROOT/../test/test_project_without_cmakelists
node ./node_modules/vscode/bin/test

popd