[CmdletBinding(SupportsShouldProcess)]
param(
    # Run the named tests
    [string[]]
    $Test,
    # Target directory to copy documentation tree
    [string]
    $DocDestination,
    # Skip running tests
    [switch]
    $NoTest
)
$ErrorActionPreference = "Stop"

$CMakeToolsVersion = "0.11.0"

# Import the utility modules
Import-Module (Join-Path $PSScriptRoot "cmt.psm1")

# The root directory of our repository:
$REPO_DIR = Split-Path $PSScriptRoot -Parent

if ($Test) {
    foreach ($testname in $Test) {
        Invoke-SmokeTest $testname
    }
    return
}

# Sanity check for npm
$npm = Find-Program npm
if (! $npm) {
    throw "No 'npm' binary. Cannot build."
}

$out_dir = Join-Path $REPO_DIR out
if (Test-Path $out_dir) {
    Write-Verbose "Removing out/ directory: $out_dir"
    Remove-Item -Recurse $out_dir
}

# Install dependencies for the project
Invoke-ChronicCommand "npm install" $npm install

# Now do the real compile
Invoke-ChronicCommand "Compiling TypeScript" $npm run compile-once

# Run TSLint to check for silly mistakes
Invoke-ChronicCommand "Running TSLint" $npm run lint:nofix

# Get the CMake binary that we will use to run our tests
$cmake_binary = Install-TestCMake -Version "3.10.0"

if (! $NoTest) {
    # Prepare to run our tests
    Invoke-TestPreparation -CMakePath $cmake_binary

    Invoke-VSCodeTest "CMake Tools: Unit tests" `
        -TestsPath "$REPO_DIR/out/test/unit-tests" `
        -Workspace "$REPO_DIR/test/unit-tests/test-project-without-cmakelists"

    foreach ($name in @("successful-build"; )) {
        Invoke-VSCodeTest "CMake Tools: $name" `
            -TestsPath "$REPO_DIR/out/test/extension-tests/$name" `
            -Workspace "$REPO_DIR/test/extension-tests/$name/project-folder"
    }
}

$doc_build = Join-Path $REPO_DIR "build/docs"
$sphinx = Find-Program sphinx-build
if (! $sphinx) {
    Write-Warning "Install Sphinx to generate documentation"
}
else {
    $command = @(
        $sphinx;
        "-W"; # Warnings are errors
        "-q"; # Be quiet
        "-C";
        "-Dsource_suffix=.rst";
        "-Dmaster_doc=index";
        "-Dproject=CMake Tools";
        "-Dversion=$CMakeToolsVersion";
        "-Drelease=$CMakeToolsVersion";
        "-Dpygments_style=sphinx";
        "-Dhtml_theme=nature";
        "-Dhtml_logo=$REPO_DIR/res/icon_190.svg";
        "-bhtml";
        "-j10";
        "-a";
        "$REPO_DIR/docs";
        $doc_build
    )
    Invoke-ChronicCommand "Generating user documentation" @command
}

Invoke-ChronicCommand "Generating developer documentation" $npm run docs

if ($DocDestination) {
    Write-Host "Copying documentation tree to $DocDestination"
    Remove-Item $DocDestination -Recurse -Force
    Copy-Item $doc_build -Destination $DocDestination -Recurse
}

Invoke-ChronicCommand "Generating VSIX package" $npm run vsce package
