Import-Module (Join-Path $PSScriptRoot "cmt.psm1")

Watch-Directory "docs" {
    try {
        Build-SphinxDocumentation `
            -InPath docs `
            -OutPath build/docs `
            -ProjectName "CMake Tools" `
            -Version "0.11.0-beta5" `
            -WarningsAsErrors `
            -Quiet `
            | Out-Host
    }
    catch {
        Write-Error "Error while building documentation: $_"
    }
}
