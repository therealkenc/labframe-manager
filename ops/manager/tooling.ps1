function Get-ManagerServiceToolingRoot {
    $artifact = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../windows-service'))
    if (Test-Path -LiteralPath (Join-Path $artifact 'installation-functions.ps1')) {
        return $artifact
    }
    $checkout = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../node_modules/@therealkenc/release-tools/windows-service'))
    if (Test-Path -LiteralPath (Join-Path $checkout 'installation-functions.ps1')) {
        return $checkout
    }
    throw 'Release tooling is missing. Use a complete release artifact or run pnpm install in the Manager repository.'
}
