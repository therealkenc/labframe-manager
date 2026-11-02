#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'tooling.ps1')
. (Join-Path (Get-ManagerServiceToolingRoot) 'installation-functions.ps1')
. (Join-Path $PSScriptRoot 'upgrade-functions.ps1')

function Assert-OwnershipProof {
    param([bool]$Condition, [string]$Description)
    if (-not $Condition) { throw "Manager ownership proof failed: $Description" }
}

function Assert-OwnershipRejection {
    param([scriptblock]$Operation, [string]$Message)
    $rejected = $false
    try { & $Operation | Out-Null }
    catch {
        if (-not $_.Exception.Message.Contains($Message)) { throw }
        $rejected = $true
    }
    Assert-OwnershipProof $rejected "Expected rejection: $Message"
}

function Get-ManagerService { $script:scenario.Service }
function Get-NetTCPConnection {
    param([string]$ErrorAction)
    if ($script:scenario.QueryFailure) { throw 'Injected TCP query failure' }
    $script:scenario.Rows
}
function Get-CimInstance {
    param([string]$ClassName, [string]$Filter)
    Assert-OwnershipProof ($ClassName -eq 'Win32_Process' -and $Filter -eq 'ProcessId=10') `
        'Only the unique endpoint owner is inspected'
    $script:scenario.Process
}
function Invoke-RestMethod { $script:scenario.Health }
function Invoke-WebRequest { @{ StatusCode = $script:scenario.GateStatus } }
function Assert-ManagerPreservedState { $script:scenario.PreservedChecks++ }

$installRoot = 'C:\fixture\manager'
$context = @{
    Port = 3004; BaseUrl = 'http://localhost:3004/console'
    Policy = @{ WrapperFileName = 'LabframeManager.exe'
        ReleaseExecutable = 'labframe-manager.exe'; ReleaseProduct = 'labframe-manager' }
    Installed = @{ account = 'NT SERVICE\LabframeManager' }
}
function Reset-OwnershipScenario {
    $script:scenario = @{
        Service = @{ PathName = '"' + (Join-Path $installRoot 'LabframeManager.exe') + '"'
            State = 'Running'; StartName = $context.Installed.account; ProcessId = 20 }
        Process = @{ ExecutablePath = (Join-Path $installRoot 'labframe-manager.exe')
            ParentProcessId = 20; ProcessId = 10 }
        Rows = @(
            @{ LocalPort = 3004; RemotePort = 0; RemoteAddress = '::'; OwningProcess = 10 },
            @{ LocalPort = 3004; RemotePort = 50000; RemoteAddress = '::1'; OwningProcess = 0 }
        )
        Health = @{ status = 'ok'; service = 'labframe-manager' }
        GateStatus = 401; QueryFailure = $false; PreservedChecks = 0
    }
}
function Invoke-OwnershipProof {
    Test-ManagerInstalledHealth -Context $context -InstallRoot $installRoot
}

Reset-OwnershipScenario
$evidence = Invoke-OwnershipProof
Assert-OwnershipProof ($evidence.ProcessId -eq 10 -and $scenario.PreservedChecks -eq 1) `
    'Healthy service, expected executable/SCM parent and unique bound endpoint are accepted'
$scenario.Rows[0].State = 1
Invoke-OwnershipProof | Out-Null
$scenario.Process.ParentProcessId = 99
Assert-OwnershipRejection { Invoke-OwnershipProof } 'selected service executable'
Reset-OwnershipScenario
$scenario.Process.ExecutablePath = 'C:\foreign\labframe-manager.exe'
Assert-OwnershipRejection { Invoke-OwnershipProof } 'selected service executable'
Reset-OwnershipScenario
$scenario.Rows += @{ LocalPort = 3004; RemotePort = 0; RemoteAddress = '0.0.0.0'
    OwningProcess = 99; State = 2 }
Assert-OwnershipRejection { Invoke-OwnershipProof } 'unexpected process owner'
Reset-OwnershipScenario
$scenario.Rows = @($scenario.Rows[1])
Assert-OwnershipRejection { Invoke-OwnershipProof } 'unexpected process owner'
Reset-OwnershipScenario
$scenario.QueryFailure = $true
Assert-OwnershipRejection { Invoke-OwnershipProof } 'Injected TCP query failure'
Reset-OwnershipScenario
$scenario.Health.status = 'unavailable'
Assert-OwnershipRejection { Invoke-OwnershipProof } 'did not report ready'
Reset-OwnershipScenario
$scenario.GateStatus = 200
Assert-OwnershipRejection { Invoke-OwnershipProof } 'not protected by sign-in'
Reset-OwnershipScenario
$scenario.Service.StartName = 'LocalSystem'
Assert-OwnershipRejection { Invoke-OwnershipProof } 'selected artifact/account'
Write-Host 'PASS Manager ownership: health, gate, exact executable/account/SCM parent and endpoint owner'
