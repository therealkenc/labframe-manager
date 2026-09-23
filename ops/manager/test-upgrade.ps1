#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'tooling.ps1')
. (Join-Path (Get-ManagerServiceToolingRoot) 'installation-functions.ps1')
. (Join-Path $PSScriptRoot 'upgrade-functions.ps1')
$setReleaseImplementation = (Get-Command Set-ManagerInstalledRelease).ScriptBlock
$preservedImplementation = (Get-Command Assert-ManagerPreservedState).ScriptBlock
$fixtureParent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../build/deploy/manager-proof'))
$fixtureRoot = Join-Path $fixtureParent ([Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixtureRoot)

function Assert-Proof {
    param([bool]$Condition, [string]$Description)
    if (-not $Condition) { throw "Manager proof failed: $Description" }
}

function Assert-Rejection {
    param([scriptblock]$Operation, [string]$Message)
    $failed = $false
    try { & $Operation | Out-Null }
    catch {
        if (-not $_.Exception.Message.Contains($Message)) { throw }
        $failed = $true
    }
    Assert-Proof $failed "Expected rejection: $Message"
}

function New-ManagerInstalledRelease {
    param([hashtable]$Context, [string]$Root)
    $script:scenario.CandidateRoot = $Root
    $script:scenario.Events += 'stage'
    [void][IO.Directory]::CreateDirectory($Root)
    Set-Content -LiteralPath (Join-Path $Root 'release.json') -Value '{}'
    if ('stage' -in $script:scenario.Failures) { throw 'Injected stage failure' }
}

function Assert-ManagerPreservedState {
    param([hashtable]$Context)
    $script:scenario.Events += 'preserved'
}

function Set-ManagerInstalledRelease {
    param([hashtable]$Context, [string]$InstallRoot, [string[]]$AllowedRoots)
    Assert-Proof ($script:scenario.Root -in $AllowedRoots) 'Service root is owned by attempt'
    $script:scenario.Events += 'switch'
    $script:scenario.Root = $InstallRoot
    if ($InstallRoot -ne $Context.Installed.installRoot -and
        'switch' -in $script:scenario.Failures) { throw 'Injected switch failure' }
}

function Wait-ManagerInstalledHealth {
    param([hashtable]$Context, [string]$InstallRoot)
    $restoring = $InstallRoot -eq $Context.Installed.installRoot
    $point = if ($restoring) { 'recovery' } else { 'acceptance' }
    $script:scenario.Events += $point
    if ($point -in $script:scenario.Failures) { throw "Injected $point failure" }
    @{ Healthy = $true }
}

function Save-ServiceInstallationReceipt {
    param([string]$StateRoot, [System.Collections.IDictionary]$Receipt, [hashtable]$Policy)
    $script:scenario.Receipt = $Receipt
    $script:scenario.Events += 'receipt'
}

function New-ProofContext {
    param([string[]]$Failures)
    $root = Join-Path $fixtureRoot ([Guid]::NewGuid().ToString('N'))
    $state = Join-Path $root 'state'
    [void][IO.Directory]::CreateDirectory($state)
    $installedRoot = Join-Path $root 'releases/old'
    [void][IO.Directory]::CreateDirectory($installedRoot)
    $script:scenario = @{ Root = $installedRoot; Failures = $Failures; Events = @()
        CandidateRoot = ''; Receipt = @{} }
    @{ StateRoot = $state; ReleasePath = (Join-Path $root 'portable')
        Installed = @{ installRoot = $installedRoot; build = @{ buildId = 'old'; version = '0.1.0-alpha.3' }
            installedAt = ''; started = $true; releaseManifestSha256 = '' }
        Candidate = @{ build = @{ buildId = 'new'; version = '0.1.0-alpha.4' } }
        Files = @(); Services = @(); Policy = @{ ReleaseManifestFileName = 'release.json' } }
}

function Test-UpgradeScenario {
    param([string[]]$Failures, [string]$Expected)
    $context = New-ProofContext -Failures $Failures
    if ($Failures.Count -gt 0) {
        Assert-Rejection { Invoke-ManagerUpgrade -Context $context } 'Injected'
    } else { Invoke-ManagerUpgrade -Context $context }
    $path = @(Get-ChildItem -LiteralPath (Join-Path $context.StateRoot 'upgrade-history'))[0].FullName
    $record = Read-ServiceJsonFile -Path $path
    Assert-Proof ($record.Status -eq $Expected) 'Durable final status'
    if ($Expected -eq 'accepted') {
        Assert-Proof ($script:scenario.Receipt.build.buildId -eq 'new') 'Candidate receipt installed'
        Assert-Proof ($script:scenario.Events.IndexOf('stage') -lt
            $script:scenario.Events.IndexOf('switch')) 'All staging precedes service switch'
    }
    if ($Expected -eq 'recovered') {
        Assert-Proof ($script:scenario.Root -eq $context.Installed.installRoot) 'Previous root restored'
        Assert-Proof ($script:scenario.Receipt.build.buildId -eq 'old') 'Previous receipt restored'
    }
    if ('stage' -in $Failures) {
        Assert-Proof ('switch' -notin $script:scenario.Events) 'Staging failure never stops service'
        Assert-Proof (-not (Test-Path -LiteralPath $record.CandidateRoot)) 'Incomplete owned stage cleaned'
    }
    Write-Host "PASS Manager upgrade [$($Failures -join ',')]: $Expected"
}

function Get-ManagerService {
    @{ PathName = '"C:\foreign\Manager.exe"'; StartName = 'NT SERVICE\LabframeManager' }
}

function Get-ManagerPreservedServices {
    param([string[]]$Names)
    @{ Name = 'Labframe'; State = 'Running'; ProcessId = 10; PathName = 'unchanged'; StartName = 'account' }
}

try {
    Test-UpgradeScenario @() 'accepted'
    Test-UpgradeScenario @('stage') 'failed'
    Test-UpgradeScenario @('switch') 'recovered'
    Test-UpgradeScenario @('acceptance') 'recovered'
    Test-UpgradeScenario @('acceptance', 'recovery') 'recovery-failed'
    $context = New-ProofContext -Failures @()
    $context.Candidate.build.buildId = 'old'
    Invoke-ManagerUpgrade -Context $context
    Assert-Proof ($script:scenario.Events.Count -eq 0) 'Same build is a no-op'
    $context.Policy.WrapperFileName = 'LabframeManager.exe'
    $context.Installed.account = 'NT SERVICE\LabframeManager'
    Assert-Rejection {
        & $setReleaseImplementation -Context $context -InstallRoot $context.Installed.installRoot `
            -AllowedRoots @($context.Installed.installRoot)
    } 'outside this upgrade attempt'
    Assert-Rejection {
        Remove-ManagerIncompleteStage -Context $context -Path $context.Installed.installRoot
    } 'not owned'
    Assert-Rejection {
        Remove-ManagerIncompleteStage -Context $context -Path $fixtureRoot
    } 'must stay below'
    $file = Join-Path $fixtureRoot 'shared-config.json'
    Set-Content -LiteralPath $file -Value 'untouched'
    $context.Files = @(@{ Path = $file; Hash = (Get-FileHash -LiteralPath $file).Hash
        Acl = (Get-Acl -LiteralPath $file).Sddl })
    $context.PreservedNames = @('Labframe')
    $context.Services = @(Get-ManagerPreservedServices -Names $context.PreservedNames)
    & $preservedImplementation -Context $context
    Set-Content -LiteralPath $file -Value 'changed'
    Assert-Rejection { & $preservedImplementation -Context $context } 'Configuration bytes or access changed'
    Set-Content -LiteralPath $file -Value 'untouched'
    $context.Services[0].ProcessId = 11
    Assert-Rejection { & $preservedImplementation -Context $context } 'Independent service changed'
    Write-Host 'PASS Manager idempotence, foreign-service guard, owned cleanup and state preservation'
} finally {
    $owned = Get-AbsoluteServicePath -Path $fixtureRoot
    Assert-ServiceChildPath -Path $owned -Root $fixtureParent
    Assert-ServicePathWithoutLinks -Path $owned
    if ([IO.Path]::GetFileName($owned) -notmatch '^[a-f0-9]{32}$') {
        throw 'Refusing to remove an unexpected Manager test directory.'
    }
    Remove-Item -LiteralPath $owned -Recurse -Force
}
