[CmdletBinding(SupportsShouldProcess)]
param(
    # CMake Version to test with
    [Parameter()]
    [string]
    $CMakeVersion = "3.10.0",
    # Regex to match to run tests (Default is to run all tests)
    [Parameter()]
    [string]
    $TestRegex = "."
)
$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "cmt.psm1")

# The root directory of our repository:
$REPO_DIR = Split-Path $PSScriptRoot -Parent
$SCRIPTS_DIR = Join-Path $REPO_DIR "scripts"

Write-Verbose "Repository directory is $REPO_DIR"

$cmake_binary = Install-TestCMake -Version $CMakeVersion
Write-Host "cmake $cmake_binary"

Write-Verbose "Preparing test utilities..."
Invoke-TestPreparation -CMakePath $cmake_binary

$bindir = Join-Path $REPO_DIR ".ci-build"

Invoke-ExternalCommand $cmake_binary "-H$REPO_DIR" "-B$bindir"
Invoke-ExternalCommand $cmake_binary --build $bindir
Invoke-ExternalCommand -WorkDir $bindir ctest --output-on-failure -j4 -R $TestRegex
