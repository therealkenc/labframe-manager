#Requires -Version 7.0
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string]$ServiceWrapperPath,
    [Parameter(Mandatory)][string]$ConfigurationPath,
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$StateRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tooling.ps1')
$sharedInstaller = Get-ManagerServiceToolingRoot
. (Join-Path $sharedInstaller 'installation-functions.ps1')
$policy = Get-ServiceInstallationPolicy -ProductPolicyPath (Join-Path $PSScriptRoot 'policy.psd1')
$configuration = Read-ServiceJsonFile -Path (Get-AbsoluteServicePath -Path $ConfigurationPath)
$references = @($policy.ConfigurationReferenceNames | ForEach-Object { $configuration[$_] })
$references += $configuration.authentication.secretsFile
& (Join-Path $sharedInstaller 'install-service.ps1') @PSBoundParameters `
    -Policy $policy -ConfigurationReferences $references -WritableDirectories @()
