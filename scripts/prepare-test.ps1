param(
    # Path to CMake to use when configuring
    [Parameter()]
    [string]
    $CMakePath="cmake"
)

$ErrorActionPreference = "Stop"

$REPO_DIR = Split-Path (Split-Path $MyInvocation.MyCommand.Source -Parent) -Parent

$fakebin_src = Join-Path $REPO_DIR "test/fakeOutputGenerator"
$fakebin_build = Join-Path $fakebin_src "build"

$conf_out = & $CMakePath "-H$fakebin_src" "-B$fakebin_build"
if ($LASTEXITCODE) {
    throw "Failed to parepare tests (configure) [$LASTEXITCODE]: $conf_out"
}
$build_out = & $CMakePath --build $fakebin_build
if ($LASTEXITCODE) {
    throw "Failed to parepare tests (configure) [$LASTEXITCODE]: $build_out"
}
$fakebin_dest = Join-Path $REPO_DIR "test/fakebin"

$ext = if ($PSVersionTable.Platform -eq "Unix") { "" } else { ".exe" }

New-Item $fakebin_dest -ItemType Directory -Force | Out-Null

$in_binary = Join-Path $fakebin_build "FakeOutputGenerator$ext"

$targets = @("clang-0.25", "gcc-42.1", "gcc-666")

foreach ($target in $targets) {
    Copy-Item $in_binary "$fakebin_dest/$target$ext"
}

Copy-Item $fakebin_src/configfiles/* -Destination $fakebin_dest -Recurse
