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
            & $program @arglist 2>&1 | Tee-Object -Variable output | Out-Host
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
    Write-Host "  > $_Command_"
    $closure = @{}
    $measurement = Measure-Command {
        $result = Invoke-ExternalCommand -PassThruExitCode @_Command_
        $closure.Result = $result
    }
    $result = $closure.Result
    if ($result.ExitCode -ne 0) {
        Write-Host "$msg - Failed with status $($result.ExitCode)"
        Write-Host $result.Output
        Write-Host -ForegroundColor Red $($result.Error)
        throw "Subcommand failed!"
        return
    }

    Write-Host "$msg - Success [$([math]::round($measurement.TotalSeconds, 1)) seconds]"
}

function Watch-Directory {
    [CmdletBinding()]
    param(
        # Directory containing files to watch
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]
        $Path,
        # Script block to run on file changes
        [Parameter(Mandatory)]
        [scriptblock]
        $ScriptBlock
    )
    $ErrorActionPreference = "Stop"
    $timer = New-Object Timers.Timer -Property @{
        Interval  = 1000
        AutoReset = $false
    }
    $watcher = New-Object IO.FileSystemWatcher $Path, "*" -Property @{
        IncludeSubdirectories = $true;
        EnableRaisingEvents   = $true;
        NotifyFilter          = [IO.NotifyFilters]::LastWrite;
    }
    $sub = Register-ObjectEvent $watcher -EventName "Changed" -MessageData $timer -Action {
        $ErrorActionPreference = "Stop"
        $timer = $Event.MessageData
        try {
            $timer.Stop()
            $timer.Start()
        }
        catch {
            Write-Host "There was error $_"
        }
    }
    $timer_sub = Register-ObjectEvent $timer -EventName "Elapsed" -MessageData $ScriptBlock -Action {
        Write-Host "File changes detected"
        & $Event.MessageData
    }
    $timer.Start()
    try {
        while ($true) {
            Start-Sleep -Milliseconds 500
        }
    }
    finally {
        Unregister-Event -SubscriptionId $sub.Id
        Unregister-Event -SubscriptionId $timer_sub.Id
        $watcher.Dispose()
        $timer.Dispose()
    }
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
    $fakebin_install = Join-Path $repo_dir "test/fakebin"
    $fakebin_install = $fakebin_install -replace '\\', '/'
    if (Test-Path $fakebin_build) {
        Write-Verbose "Removing fakeOutputGenerator build dir: $fakebin_build"
        Remove-Item $fakebin_build -Recurse
    }

    Invoke-ChronicCommand "Configuring test utilities" $CMakePath "-H$fakebin_src" "-B$fakebin_build" "-DCMAKE_INSTALL_PREFIX:STRING=$fakebin_install"
    Invoke-ChronicCommand "Building test utilities" $CMakePath --build $fakebin_build

    $fakebin_dest = Join-Path $repo_dir "test/fakebin"
    if (Test-Path $fakebin_dest) {
        Write-Verbose "Removing fakebin executable directory: $fakebin_dest"
        Remove-Item $fakebin_dest -Recurse
    }
    Invoke-ChronicCommand "Installing test utilities" $CMakePath --install $fakebin_build --config Debug
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

function Install-TestNinjaMakeSystem ($Version) {
    $ErrorActionPreference = "Stop"
    if ($PSVersionTable.Platform -eq "Unix") {
        $test_bin_dir = Join-Path $env:HOME ".local/share/CMakeTools/test-ninja-root/$Version"
    }
    else {
        $test_bin_dir = Join-Path $env:AppData "CMakeTools/test-ninja-root/$Version"
    }

    if ($PSVersionTable.Platform -eq "Unix") {
        $ninja_bin = Join-Path $test_bin_dir "ninja"
    }
    else {
        $ninja_bin = Join-Path $test_bin_dir "ninja.exe"
    }

    if (Test-Path $ninja_bin -PathType Leaf) {
        Write-Host "Using existing Ninja test root at $test_bin_dir"
        return $ninja_bin
    }

    $ninja_files_url = "https://github.com/ninja-build/ninja/releases/download/v$Version"

    Write-Host "Installing Ninja $Version for testing at $test_bin_dir"

    $tmp_test_bin_dir = "$test_bin_dir-tmp"
    if (Test-Path $tmp_test_bin_dir) {
        Remove-Item $tmp_test_bin_dir -Recurse
    }
    New-Item $tmp_test_bin_dir -ItemType Directory -Force | Out-Null

    if (Test-Path $test_bin_dir) {
        Remove-Item $test_bin_dir -Recurse
    }
    New-Item $test_bin_dir -ItemType Directory -Force | Out-Null


    $zip_url = ""
    if ($PSVersionTable.OS.StartsWith("Microsoft Windows")) {
        $zip_url = "$ninja_files_url/ninja-win.zip"
    }
    elseif ($PSVersionTable.OS.StartsWith("Linux")) {
        $zip_url = "$ninja_files_url/ninja-linux.zip"
    }
    elseif ($PSVersionTable.OS.StartsWith("Darwin")) {
        $zip_url = "$ninja_files_url/ninja-mac.zip"
    }
    Write-Host "URL dir: $zip_url"

    $zip_file = Join-Path "$tmp_test_bin_dir" "ninja.zip"
    Write-Host "Downloading $zip_url and saving it to $zip_file"
    Get-RemoteFile -Url $zip_url -Path $zip_file
    Expand-Archive $zip_file -DestinationPath $tmp_test_bin_dir
    Remove-Item "$tmp_test_bin_dir/ninja.zip"
    Copy-Item -Path "$tmp_test_bin_dir/*" -Destination "$test_bin_dir/" -Force

    if (!$PSVersionTable.OS.StartsWith("Microsoft Windows")) {
        chmod 755 $ninja_bin
    }

    Remove-Item $tmp_test_bin_dir -Recurse

    Write-Host "Successfully created Ninja installation for testing at $test_bin_dir"
    & $ninja_bin --version | Write-Host
    return $ninja_bin
}

