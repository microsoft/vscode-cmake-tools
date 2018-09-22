[CmdletBinding(SupportsShouldProcess)]
param(
    # Run the named tests
    [string[]]
    $Test,
    # Build the docs only
    [switch]
    $Docs,
    # Target directory to copy documentation tree
    [string]
    $DocDestination,
    # Skip running tests
    [switch]
    $NoTest,
    # Only run the smoke tests
    [switch]
    $OnlySmoke,
    # Only run the unit tests
    [switch]
    $OnlyUnit
)
$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -lt 6) {
    throw "This script requires at least powershell 6"
}

# The root directory of our repository:
$REPO_DIR = Split-Path $PSScriptRoot -Parent

$Package = Get-Content (Join-Path $REPO_DIR "package.json") | ConvertFrom-Json

$CMakeToolsVersion = $Package.version

# Import the utility modules
Import-Module (Join-Path $PSScriptRoot "cmt.psm1")

$DOC_BUILD_DIR = Join-Path $REPO_DIR "build/docs"

if ($Test) {
    foreach ($testname in $Test) {
        Invoke-SmokeTest $testname
    }
    return
}

if ($OnlySmoke) {
    return Invoke-SmokeTests
}

if ($OnlyUnit) {
    return Invoke-VSCodeTest "CMake Tools: Unit tests" `
        -TestsPath "$REPO_DIR/out/test/unit-tests" `
        -Workspace "$REPO_DIR/test/unit-tests/test-project-without-cmakelists"
}

# Sanity check for yarn
$yarn = Find-Program yarn
if (! $yarn) {
    $npm = Find-Program npm
    if (! $npm ) {
        throw "No 'yarn' binary, and not 'npm' to install it. Cannot build."
    }
    else {
        try {
            Invoke-ChronicCommand "Install yarn" $npm install --global yarn
        }
        catch {
            Write-Error "Failed to install 'yarn' globally. Please install yarn to continue."
        }
        $yarn = Find-Program yarn
    }
}

function Invoke-DocsBuild {
    Build-DevDocs
    Build-UserDocs `
        -RepoDir $REPO_DIR `
        -Version $CMakeToolsVersion`
        -Out $DOC_BUILD_DIR

    if ($DocDestination) {
        Write-Host "Copying documentation tree to $DocDestination"
        if (Test-Path $DocDestination) {
            Remove-Item $DocDestination -Recurse -Force
        }
        Copy-Item $DOC_BUILD_DIR -Destination $DocDestination -Recurse
    }
}

if ($Docs) {
    return Invoke-DocsBuild
}

$out_dir = Join-Path $REPO_DIR out
if (Test-Path $out_dir) {
    Write-Verbose "Removing out/ directory: $out_dir"
    Remove-Item -Recurse $out_dir
}

# Install dependencies for the project
Invoke-ChronicCommand "yarn install" $yarn install

# Now do the real compile
Invoke-ChronicCommand "Compiling TypeScript" $yarn run compile-once

# Run TSLint to check for silly mistakes
Invoke-ChronicCommand "Running TSLint" $yarn run lint:nofix

# Get the CMake binary that we will use to run our tests
$cmake_binary = Install-TestCMake -Version "3.10.0"

# Get the Ninja binary that we will use to run our tests
$ninja_binary = Install-TestNinjaMakeSystem -Version "1.8.2"

# Add ninja to search path environment variable
$Env:PATH = $Env:PATH + [System.IO.Path]::PathSeparator + (get-item $ninja_binary).Directory.FullName

if (! $NoTest) {
    # Prepare to run our tests
    Invoke-TestPreparation -CMakePath $cmake_binary

    if (! $PSVersionTable.OS.StartsWith("Darwin")) {
        # For some reason, the backend tests fail on macOS
        Invoke-MochaTest "CMake Tools: Backend tests"
    }

    Invoke-VSCodeTest "CMake Tools: Unit tests" `
        -TestsPath "$REPO_DIR/out/test/unit-tests" `
        -Workspace "$REPO_DIR/test/unit-tests/test-project-without-cmakelists"

    Invoke-SmokeTests

    foreach ($name in @("successful-build"; )) {
        Invoke-VSCodeTest "CMake Tools: $name" `
            -TestsPath "$REPO_DIR/out/test/extension-tests/$name" `
            -Workspace "$REPO_DIR/test/extension-tests/$name/project-folder"
    }
}

Invoke-DocsBuild

$vsce = Find-Program vsce
if (! $vsce) {
    Write-Warning "You don't have 'vsce' installed. We won't generate a .vsix package"
}
else {
    Invoke-ChronicCommand "Generating VSIX package" $vsce package
}
