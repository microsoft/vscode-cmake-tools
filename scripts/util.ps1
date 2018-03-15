function Download-File ($Url, $Path) {
    # Ensure that the parent directory is present
    $parent = Split-Path $Path -Parent
    New-Item $parent -ItemType Directory -Force | Out-Null

    # Only download if the file does not exist
    if (! (Test-Path $installer_file -PathType Leaf)) {
        Write-Host "Downloading from $Url -> $Path ..."
        $tmp = "$Path-tmp"
        try {
            Invoke-WebRequest $Url -UseBasicParsing -OutFile "$tmp" | Out-Null
            Rename-Item $tmp $Path
        }
        finally {
            if (Test-Path $tmp) {
                Remove-Item $tmp -Force
            }
        }
    }
    else {
        Write-Host "Cached download file $Path"
    }
}

function Install-TestCMake ($Version) {
    if ($PSVersionTable.Platform -eq "Unix") {
        $test_cmake_dir = Join-Path $env:HOME ".local/share/CMakeTools/test-cmake-root/$Version"
    }
    else {
        $test_cmake_dir = Join-Path $env:AppData "CMakeTools/test-cmake-root/$Version"
    }

    if ($PSVersionTable.Platform -eq "Windows") {
        $cmake_bin = Join-Path $test_cmake_dir "bin/cmake.exe"
    }
    else {
        $cmake_bin = Join-Path $test_cmake_dir "bin/cmake"
    }

    if (Test-Path $cmake_bin -PathType Leaf) {
        Write-Host "Using existing CMake test root at $test_cmake_dir"
        return $cmake_bin
    }

    $cmake_minor = if ($Version -match "(\d+\.\d+)\.\d+") {
        $Matches[1]
    }
    else {
        throw "Invalid CMake version number: $Version"
    }

    $cmake_files_url = "https://cmake.org/files/v$cmake_minor"

    Write-Host "Installing CMake $Version for testing at $test_cmake_dir"

    $tmpdir = "$test_cmake_dir-tmp"

    New-Item $tmpdir -ItemType Directory -Force | Out-Null

    if ($PSVersionTable.OS.StartsWith("Microsoft Windows")) {
        throw "Unimplemented for Windows"
    }
    elseif ($PSVersionTable.OS.StartsWith("Linux")) {
        # Install using the Linux self-extracting shell script executable
        $installer_url = "$cmake_files_url/cmake-$Version-Linux-x86_64.sh"
        $installer_file = "/tmp/cmake-$Version.sh"

        Download-File -Url $installer_url -Path $installer_file

        Write-Host "Installing CMake $Version to $tmpdir ..."
        & bash $installer_file --prefix=$tmpdir --exclude-subdir | Out-Null
        if (Test-Path -LiteralPath $test_cmake_dir) {
            Remove-Item $test_cmake_dir -Force -Recurse
        }
        Rename-Item $tmpdir $test_cmake_dir | Out-Null
    }
    elseif ($PSVersionTable.OS.StartsWith("Darwin")) {
        $installer_url = "$cmake_files_url/cmake-$Version-Darwin-x86_64.tar.gz"
        $installer_file = Join-Path $tmpdir "/cmake-$Version.tgz"

        Download-File -Url $installer_url -Path $installer_file
        pushd /tmp
        & tar xf $installer_file
        Copy-Item `
            -Path "/tmp/cmake-$Version-Darwin-x86_64/CMake.app/Contents" `
            -Destination $test_cmake_dir `
            -Recurse
        # Get-ChildItem $test_cmake_dir -Recurse | Write-Host
    }

    Write-Host "Successfully created CMake installation for testing at $test_cmake_dir"
    & $cmake_bin --version | Write-Host
    return $cmake_bin
}