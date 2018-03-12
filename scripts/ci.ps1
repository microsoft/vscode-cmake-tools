param(
    # CMake Version to test with
    [Parameter()]
    [string]
    $CMakeVersion = "3.10.0"
)
$ErrorActionPreference = "Stop"

# The root directory of our repository:
$REPO_DIR = Split-Path (Split-Path $MyInvocation.MyCommand.Source -Parent) -Parent
$SCRIPTS_DIR = Join-Path $REPO_DIR "scripts"

. $SCRIPTS_DIR/util.ps1

Write-Debug "Repository directory is $REPO_DIR"

$cmake_binary = Install-TestCMake -Version $CMakeVersion
ConvertTo-Json $cmake_binary
Write-Host "cmake $cmake_binary"

Write-Debug "Preparing test utilities..."
& $SCRIPTS_DIR/prepare-test.ps1 -CMakePath $cmake_binary

$bindir = Join-Path $REPO_DIR ".ci-build"

& $cmake_binary "-H$REPO_DIR" "-B$bindir"
$retc = $LASTEXITCODE
if ($retc) {
    throw "CMake configure failed [$retc]"
}
& $cmake_binary --build $bindir
$retc = $LASTEXITCODE
if ($retc) {
    throw "CMake build failed [$retc]"
}
& $cmake_binary -E chdir $bindir ctest --output-on-failure -j4
$retc = $LASTEXITCODE
if ($retc) {
    throw "CTest failed [$retc]"
}

# set -eu

# if [[ "$OSTYPE" == "darwin"* ]]; then
# 	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
# 	ROOT=$(dirname $(dirname $(realpath "$0")))
# else
# 	ROOT=$(dirname $(dirname $(readlink -f $0)))
# fi

# cd $ROOT

# echo "CMake on \$PATH: $(type -P cmake)"

# if [ "${CMAKE_VER:-}" != "" ]; then
#     echo "Checking CMAKE_VER"
#     local cmv=$(cmake --version)
#     if cmake --version | grep "${CMAKE_VER}"; then
#         echo "CMake version matches expectations"
#     else
#         echo "CMake version does not match that from the Travis configuration"
#         echo "Failing build"
#         exit 1
#     fi
# else
#     echo "CMAKE_VER is not defined. We'll use the following CMake for testing:"
#     echo "CMake version: $(cmake --version)"
# fi

