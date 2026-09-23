#Requires -Version 7.0
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$StateRoot = (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'LabframeManager'),
    [string]$ReleasePath,
    [string[]]$PreservedServices = @('Labframe', 'Welcome', 'Caddy'),
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'tooling.ps1')
. (Join-Path (Get-ManagerServiceToolingRoot) 'installation-functions.ps1')
. (Join-Path $PSScriptRoot 'upgrade-functions.ps1')

if (-not $ReleasePath) {
    $ReleasePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
}
$mutex = [Threading.Mutex]::new($false, 'Global\LabframeManagerUpgrade')
$acquired = $false
try {
    $acquired = $mutex.WaitOne(0)
    if (-not $acquired) { throw 'Another Manager upgrade is running.' }
    $context = Get-ManagerUpgradeContext -StateRoot $StateRoot -ReleasePath $ReleasePath `
        -PreservedServices $PreservedServices
    if ($CheckOnly) { Write-Host 'Manager preflight passed. No changes made.' }
    else { Invoke-ManagerUpgrade -Context $context }
} catch {
    Write-Error "Manager upgrade failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
