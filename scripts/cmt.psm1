function Find-Program {
    [CmdletBinding()]
    param(
        # Name of the program to find
        [Parameter()]
        [string]
        $Name
    )

    $msg = "Searching for program $Name"
    Write-Verbose $msg
    $results = @(Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue)
    if ($results.Length -eq 0) {
        Write-Verbose "$msg - Not found"
        return $null
    }
    $first = $results[0]
    $item = Get-Item $First.Path
    Write-Verbose "$msg - Found: ${item.FullName}"
    return $item
}

function Invoke-ExternalCommand {
    [CmdletBinding(PositionalBinding = $false)]
    param(
        # Ignore the exit code and return it unchanged
        [Parameter()]
        [switch]
        $PassThruExitCode,
        # Directory in which to run the command
        [Parameter()]
        [string]
        $WorkDir,
        # Command to execute
        [Parameter(ValueFromRemainingArguments = $True, Mandatory = $True)]
        [string[]]
        $_Command,
        # Don't pipe output to the host console
        [Parameter()]
        [switch]
        $HideOutput
    )

    $ErrorActionPreference = "Stop"

    $program = $_Command[0]
    $arglist = $_Command.Clone()
    $arglist = $arglist[1..$arglist.Length]

    if (! $WorkDir) {
        $WorkDir = $PWD
    }

    Push-Location $WorkDir
    try {
        $ErrorActionPreference = "Continue"
        if ($HideOutput) {
            $output = & $program @arglist 2>&1
        }
        else {
            & $program @arglist | Tee-Object -Variable output | Out-Host
        }
        $retc = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = "Stop"
        Pop-Location
    }

    $stderr = $output | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }
    $stdout = $output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }
    $stderr = $stderr -join "`n"
    $stdout = $stdout -join "`n"

    if (! $PassThruExitCode) {
        if ($retc -ne 0) {
            throw "Executing program $program failed with exit code $retc"
        }
    }
    else {
        return @{
            ExitCode = $retc;
            Output   = $stdout;
            Error    = $stderr;
        }
    }
}

function Invoke-ChronicCommand {
    [CmdletBinding()]
    param(
        # Description for the command
        [Parameter(Mandatory)]
        [string]
        $Description,
        # The command to run
        [Parameter(ValueFromRemainingArguments, Mandatory)]
        [string[]]
        $_Command_
    )

    $msg = "==> $Description"
    Write-Host $msg
    Write-Debug "About to execute $_Command_"
    $closure = @{}
    $measurement = Measure-Command {
        $result = Invoke-ExternalCommand -HideOutput -PassThruExitCode @_Command_
        $closure.Result = $result
    }
    $result = $closure.Result
    if ($result.ExitCode -ne 0) {
        Write-Host "$msg - Failed with status $($result.ExitCode)"
        Write-Host $result.Output
        Write-Error $result.Error
        throw "Subcommand failed!"
        return
    }

    Write-Host "$msg - Success [$([math]::round($measurement.TotalSeconds, 1)) seconds]"
}

function Invoke-TestPreparation {
    param(
        # Path to CMake to use
        [string]
        $CMakePath = "cmake"
    )
    $ErrorActionPreference = "Stop"

    $repo_dir = Split-Path $PSScriptRoot -Parent
    $fakebin_src = Join-Path $repo_dir "test/fakeOutputGenerator"
    $fakebin_build = Join-Path $fakebin_src "build"
    if (Test-Path $fakebin_build) {
        Write-Verbose "Removing fakeOutputGenerator build dir: $fakebin_build"
        Remove-Item $fakebin_build -Recurse
    }

    Invoke-ChronicCommand "Configuring test utilities" $CMakePath "-H$fakebin_src" "-B$fakebin_build"
    Invoke-ChronicCommand "Building test utilities" $CMakePath --build $fakebin_build

    $fakebin_dest = Join-Path $repo_dir "test/fakebin"
    if (Test-Path $fakebin_dest) {
        Write-Verbose "Removing fakebin executable directory: $fakebin_dest"
        Remove-Item $fakebin_dest -Recurse
    }
    New-Item $fakebin_dest -ItemType Directory -Force | Out-Null

    $ext = if ($PSVersionTable.Platform -eq "Unix") { "" } else { ".exe" }
    $in_binary = (Get-ChildItem $fakebin_build -Recurse -Filter "FakeOutputGenerator$ext").FullName

    $targets = @("clang-0.25", "gcc-42.1", "gcc-666", "clang-8.1.0")

    foreach ($target in $targets) {
        Copy-Item $in_binary "$fakebin_dest/$target$ext"
    }

    Copy-Item $fakebin_src/configfiles/* -Destination $fakebin_dest -Recurse

}

function Get-RemoteFile ($Url, $Path) {
    $ErrorActionPreference = "Stop"
    # Ensure that the parent directory is present
    Write-Debug "Downloading $Url to $Path"
    $parent = Split-Path $Path -Parent
    New-Item $parent -ItemType Directory -Force | Out-Null

    # Only download if the file does not exist
    if (! (Test-Path $Path -PathType Leaf)) {
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
    $ErrorActionPreference = "Stop"
    if ($PSVersionTable.Platform -eq "Unix") {
        $test_cmake_dir = Join-Path $env:HOME ".local/share/CMakeTools/test-cmake-root/$Version"
    }
    else {
        $test_cmake_dir = Join-Path $env:AppData "CMakeTools/test-cmake-root/$Version"
    }

    if ($PSVersionTable.Platform -eq "Unix") {
        $cmake_bin = Join-Path $test_cmake_dir "bin/cmake"
    }
    else {
        $cmake_bin = Join-Path $test_cmake_dir "bin/cmake.exe"
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
    if (Test-Path $tmpdir) {
        Remove-Item $tmpdir -Recurse
    }

    New-Item $tmpdir -ItemType Directory -Force | Out-Null

    if ($PSVersionTable.OS.StartsWith("Microsoft Windows")) {
        $zip_url = "$cmake_files_url/cmake-$Version-win64-x64.zip"
        $zip_file = Join-Path "$env:TEMP" "cmake-$Version.zip"
        Write-Debug "Downloading $zip_url and saving it to $zip_file"
        Get-RemoteFile -Url $zip_url -Path $zip_file
        Expand-Archive $zip_file -DestinationPath $tmpdir
        Copy-Item -Path "$tmpdir/cmake-$Version-win64-x64/" -Destination $test_cmake_dir -Recurse -Force
        Remove-Item $tmpdir -Recurse
    }
    elseif ($PSVersionTable.OS.StartsWith("Linux")) {
        # Install using the Linux self-extracting shell script executable
        $installer_url = "$cmake_files_url/cmake-$Version-Linux-x86_64.sh"
        $installer_file = "/tmp/cmake-$Version.sh"

        Get-RemoteFile -Url $installer_url -Path $installer_file

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

        Get-RemoteFile -Url $installer_url -Path $installer_file
        Push-Location /tmp
        try {
            & tar xf $installer_file
            Copy-Item `
                -Path "/tmp/cmake-$Version-Darwin-x86_64/CMake.app/Contents" `
                -Destination $test_cmake_dir `
                -Recurse
        }
        finally {
            Pop-Location
        }
    }

    Write-Host "Successfully created CMake installation for testing at $test_cmake_dir"
    & $cmake_bin --version | Write-Host
    return $cmake_bin
}

function Invoke-VSCodeTest {
    [CmdletBinding(PositionalBinding = $false)]
    param(
        # Description for the test
        [Parameter(Position = 0, Mandatory)]
        [string]
        $Description,
        # Directory holding the test runner
        [Parameter(Mandatory)]
        [string]
        $TestsPath,
        # Directory to use as the workspace
        [Parameter(Mandatory)]
        [string]
        $Workspace
    )
    $ErrorActionPreference = "Stop"
    $node = Find-Program node
    if (! $node) {
        throw "Cannot run tests: no 'node' command found"
    }
    $repo_dir = Split-Path $PSScriptRoot -Parent
    $test_bin = Join-Path $repo_dir "/node_modules/vscode/bin/test"
    $env:CMT_TESTING = 1
    $env:CODE_TESTS_PATH = $TestsPath
    $env:CODE_TESTS_WORKSPACE = $Workspace
    $env:HasVs = if ($PSVersionTable.OS.StartsWith("Microsoft Windows")) { "true" } else { "false" }
    Invoke-ChronicCommand "Executing VSCode test: $Description" $node $test_bin
}


function Invoke-SmokeTest($Name) {
    $repo_dir = Split-Path $PSScriptRoot -Parent
    if (! (Test-Path "$repo_dir/test/extension-tests/$Name")) {
        throw "No such test with name '$Name'"
    }
    Invoke-VSCodeTest "CMake Tools: $Name" `
        -TestsPath "$repo_dir/out/test/extension-tests/$Name" `
        -Workspace "$repo_dir/test/extension-tests/$Name/project-folder"
}