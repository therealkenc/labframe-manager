Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'configuration.ps1')

$script:ManagerUpgradePolicy = @{
    ServiceTimeoutSeconds = 45
    RequestTimeoutSeconds = 10
    StartupTimeoutSeconds = 60
    PollMilliseconds = 500
}

function Get-ManagerService {
    Get-CimInstance Win32_Service -Filter "Name='LabframeManager'"
}

function Get-ManagerPreservedServices {
    param([string[]]$Names)
    foreach ($name in $Names) {
        if ($name -notmatch '^[A-Za-z][A-Za-z0-9_$-]*$' -or $name -eq 'LabframeManager') {
            throw "Invalid independent service name: $name"
        }
        $service = Get-CimInstance Win32_Service -Filter "Name='$name'"
        if (-not $service) { throw "Independent service is missing: $name" }
        @{ Name = $service.Name; State = $service.State; ProcessId = $service.ProcessId
            PathName = $service.PathName; StartName = $service.StartName }
    }
}

function Assert-ManagerPreservedState {
    param([hashtable]$Context)
    foreach ($file in $Context.Files) {
        $expectedHash = if ($file.Path -ieq $Context.Configuration.Path) {
            $Context.Configuration[$Context.Configuration.Active].Hash
        } else { $file.Hash }
        if ((Get-FileHash -LiteralPath $file.Path).Hash -ne $expectedHash -or
            (Get-Acl -LiteralPath $file.Path).Sddl -cne $file.Acl) {
            throw "Configuration bytes or access changed during Manager upgrade: $($file.Path)"
        }
    }
    $actual = @(Get-ManagerPreservedServices -Names $Context.PreservedNames)
    foreach ($expected in $Context.Services) {
        $current = @($actual | Where-Object { $_.Name -eq $expected.Name })
        foreach ($key in @('State', 'ProcessId', 'PathName', 'StartName')) {
            if ($current.Count -ne 1 -or $current[0][$key] -ne $expected[$key]) {
                throw "Independent service changed during Manager upgrade: $($expected.Name) / $key"
            }
        }
    }
}

function Assert-ManagerInstalledFiles {
    param([string]$Root, [hashtable]$Manifest, [hashtable]$Policy)
    foreach ($entry in $Manifest.files) {
        $file = Get-ServiceInventoryPath -Root $Root -RelativePath $entry.path
        Assert-ServicePathWithoutLinks -Path $file
        if ((Get-Item -LiteralPath $file).Length -ne $entry.size -or
            (Get-FileHash -LiteralPath $file).Hash -ne $entry.sha256) {
            throw "Installed Manager inventory differs: $($entry.path)"
        }
    }
    $allowed = @($Manifest.files.path) + @($Policy.ReleaseManifestFileName,
        $Policy.WrapperFileName, $Policy.WrapperXmlFileName, $Policy.WrapperLicenseFileName)
    foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
        Assert-ServicePathWithoutLinks -Path $item.FullName
        if (-not $item.PSIsContainer -and
            [IO.Path]::GetRelativePath($Root, $item.FullName).Replace('\', '/') -notin $allowed) {
            throw "Unexpected file in installed Manager artifact: $($item.FullName)"
        }
    }
    $wrapper = Join-Path $Root $Policy.WrapperFileName
    if ((Get-FileHash -LiteralPath $wrapper).Hash -ne $Policy.WrapperSha256) {
        throw 'Installed Manager wrapper differs from the pinned WinSW release.'
    }
}

function Get-ManagerConfigurationFiles {
    param([string]$Path, [hashtable]$Configuration)
    foreach ($file in @($Path,
        $Configuration.queryConfigFile, $Configuration.authentication.secretsFile)) {
        $absolute = Get-AbsoluteServicePath -Path $file
        Assert-ServicePathWithoutLinks -Path $absolute
        @{ Path = $absolute; Hash = (Get-FileHash -LiteralPath $absolute).Hash
            Acl = (Get-Acl -LiteralPath $absolute).Sddl }
    }
}

function Get-ManagerUpgradeContext {
    param([string]$StateRoot, [string]$ReleasePath, [string[]]$PreservedServices)
    $state = Get-AbsoluteServicePath -Path ([IO.Path]::GetFullPath($StateRoot))
    $release = Get-AbsoluteServicePath -Path ([IO.Path]::GetFullPath($ReleasePath))
    Assert-ServiceChildPath -Path $state -Root ([Environment]::GetFolderPath('CommonApplicationData'))
    foreach ($path in @($state, $release)) { Assert-ServicePathWithoutLinks -Path $path }
    $policy = Get-ServiceInstallationPolicy -ProductPolicyPath (Join-Path $PSScriptRoot 'policy.psd1')
    $installed = Read-ServiceJsonFile -Path (Join-Path $state $policy.ReceiptFileName)
    if ($installed.service -ne $policy.ServiceName -or $installed.stateRoot -ine $state -or
        $installed.account -ine ('NT SERVICE\' + $policy.ServiceName)) {
        throw 'Installed Manager receipt does not match the selected state directory.'
    }
    Assert-ServiceChildPath -Path $installed.installRoot -Root ([Environment]::GetFolderPath('ProgramFiles'))
    Assert-ServiceChildPath -Path $installed.configurationPath -Root $state
    Assert-ServicePathWithoutLinks -Path $installed.installRoot
    $previousPath = Join-Path $installed.installRoot $policy.ReleaseManifestFileName
    $previous = Read-ServiceJsonFile -Path $previousPath
    if ((Get-FileHash -LiteralPath $previousPath).Hash -ne $installed.releaseManifestSha256 -or
        $previous.build.buildId -cne $installed.build.buildId -or
        $previous.build.product -cne $policy.ReleaseProduct) {
        throw 'Installed Manager artifact differs from its receipt.'
    }
    Assert-ManagerInstalledFiles -Root $installed.installRoot -Manifest $previous -Policy $policy
    $candidate = Read-ServiceRelease -Root $release -Policy $policy
    if ($candidate.build.dirty -isnot [bool] -or $candidate.build.dirty) {
        throw 'Manager upgrade requires a clean release artifact.'
    }
    if ($candidate.build.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$') {
        throw 'Manager release version is not a valid directory component.'
    }
    $configuration = Read-ServiceJsonFile -Path $installed.configurationPath
    $listen = [uri]$configuration.listen
    if ($listen.Scheme -ne 'http' -or -not $listen.IsLoopback -or $listen.Port -le 0 -or
        $configuration.basePath -notmatch '^(?:/[a-zA-Z0-9_-]+)*$' -or
        -not $configuration.authentication.passwordSecret) {
        throw 'Manager upgrade requires an authenticated loopback Manager configuration.'
    }
    $context = @{ StateRoot = $state; ReleasePath = $release; Policy = $policy
        Installed = $installed; Previous = $previous; Candidate = $candidate
        Port = $listen.Port; BaseUrl = $configuration.listen + $configuration.basePath
        Files = @(Get-ManagerConfigurationFiles -Path $installed.configurationPath -Configuration $configuration)
        PreservedNames = $PreservedServices
        Services = @(Get-ManagerPreservedServices -Names $PreservedServices) }
    $context.Configuration = New-ManagerConfigurationTransition -Path $installed.configurationPath `
        -StateRoot $state -Executable (Join-Path $release $policy.ReleaseExecutable)
    $null = Test-ManagerInstalledHealth -Context $context -InstallRoot $installed.installRoot
    $context
}

function Test-ManagerInstalledHealth {
    param([hashtable]$Context, [string]$InstallRoot)
    $service = Get-ManagerService
    $wrapper = '"' + (Join-Path $InstallRoot $Context.Policy.WrapperFileName) + '"'
    if (-not $service -or $service.PathName -ine $wrapper -or $service.State -ne 'Running' -or
        $service.StartName -ine $Context.Installed.account) {
        throw 'Running Manager service does not match the selected artifact/account.'
    }
    $health = Invoke-RestMethod -Uri ($Context.BaseUrl + '/health') `
        -TimeoutSec $script:ManagerUpgradePolicy.RequestTimeoutSeconds -MaximumRedirection 0
    if ($health.status -ne 'ok' -or $health.service -ne $Context.Policy.ReleaseProduct) {
        throw 'Manager health did not report ready.'
    }
    $listeners = @(Get-NetTCPConnection -LocalPort $Context.Port -State Listen)
    $owners = @($listeners.OwningProcess | Select-Object -Unique)
    if ($owners.Count -ne 1) { throw 'Manager listener has an unexpected process owner.' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
    if ($process.ExecutablePath -ine (Join-Path $InstallRoot $Context.Policy.ReleaseExecutable) -or
        $process.ParentProcessId -ne $service.ProcessId) {
        throw 'Manager health listener does not belong to the selected service executable.'
    }
    $gate = Invoke-WebRequest -Uri ($Context.BaseUrl + '/api/v1/telemetry/targets') `
        -TimeoutSec $script:ManagerUpgradePolicy.RequestTimeoutSeconds `
        -MaximumRedirection 0 -SkipHttpErrorCheck
    if ($gate.StatusCode -ne 401) { throw 'Manager telemetry is not protected by sign-in.' }
    Assert-ManagerPreservedState -Context $Context
    @{ CheckedAt = [DateTime]::UtcNow.ToString('o'); ProcessId = $process.ProcessId
        WrapperProcessId = $service.ProcessId; HealthUrl = $Context.BaseUrl + '/health' }
}

function Wait-ManagerInstalledHealth {
    param([hashtable]$Context, [string]$InstallRoot)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($script:ManagerUpgradePolicy.StartupTimeoutSeconds)
    do {
        try { return Test-ManagerInstalledHealth -Context $Context -InstallRoot $InstallRoot }
        catch { $cause = $_.Exception.Message }
        Start-Sleep -Milliseconds $script:ManagerUpgradePolicy.PollMilliseconds
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Manager acceptance failed: $cause"
}

function New-ManagerInstallPath {
    param([hashtable]$Context)
    $root = Join-Path ([IO.Path]::GetDirectoryName($Context.Installed.installRoot)) (
        $Context.Candidate.build.version + '-' + [Guid]::NewGuid().ToString('N'))
    Assert-ServiceChildPath -Path $root -Root ([IO.Path]::GetDirectoryName($Context.Installed.installRoot))
    Assert-ServicePathWithoutLinks -Path $root
    if (Test-Path -LiteralPath $root) { throw 'Candidate installation directory already exists.' }
    $root
}

function New-ManagerInstalledRelease {
    param([hashtable]$Context, [string]$Root)
    $root = Get-AbsoluteServicePath -Path $Root
    Assert-ServiceChildPath -Path $root -Root ([IO.Path]::GetDirectoryName($Context.Installed.installRoot))
    Assert-ServicePathWithoutLinks -Path $root
    if (Test-Path -LiteralPath $root) { throw 'Candidate installation directory already exists.' }
    [void][IO.Directory]::CreateDirectory($root)
    Set-ServiceDirectoryAccess -Path $root -ServiceSid (Get-WindowsServiceSid -Policy $Context.Policy) `
        -ServiceRights ReadAndExecute -Policy $Context.Policy
    foreach ($item in Get-ChildItem -LiteralPath $Context.ReleasePath -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $root -Recurse
    }
    Assert-ServiceReleaseInventory -Root $root -Manifest $Context.Candidate -Policy $Context.Policy
    foreach ($name in @($Context.Policy.WrapperFileName, $Context.Policy.WrapperLicenseFileName)) {
        Copy-Item -LiteralPath (Join-Path $Context.Installed.installRoot $name) -Destination $root
    }
    Write-WindowsServiceXml -InstallRoot $root -StateRoot $Context.StateRoot `
        -ConfigurationPath $Context.Installed.configurationPath `
        -TemplatePath (Join-Path (Get-ManagerServiceToolingRoot) 'service.xml.template') -Policy $Context.Policy
    Assert-ManagerInstalledFiles -Root $root -Manifest $Context.Candidate -Policy $Context.Policy
}

function Remove-ManagerIncompleteStage {
    param([hashtable]$Context, [string]$Path)
    $root = Get-AbsoluteServicePath -Path $Path
    $parent = [IO.Path]::GetDirectoryName($Context.Installed.installRoot)
    Assert-ServiceChildPath -Path $root -Root $parent
    Assert-ServicePathWithoutLinks -Path $root
    $prefix = [regex]::Escape($Context.Candidate.build.version)
    if ([IO.Path]::GetFileName($root) -notmatch ('^' + $prefix + '-[a-f0-9]{32}$') -or
        $root -ieq $Context.Installed.installRoot -or $root -ieq $Context.ReleasePath) {
        throw 'Refusing to remove a directory not owned by this Manager staging attempt.'
    }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}

function Set-ManagerInstalledRelease {
    param([hashtable]$Context, [string]$InstallRoot, [string[]]$AllowedRoots)
    $service = Get-ManagerService
    $allowedPaths = @($AllowedRoots | ForEach-Object {
        '"' + (Join-Path $_ $Context.Policy.WrapperFileName) + '"' })
    if (-not $service -or $service.PathName -notin $allowedPaths -or
        $service.StartName -ine $Context.Installed.account) {
        throw 'Refusing to stop a Manager service outside this upgrade attempt.'
    }
    Stop-Service -Name $Context.Policy.ServiceName -NoWait
    (Get-Service -Name $Context.Policy.ServiceName).WaitForStatus(
        'Stopped', [TimeSpan]::FromSeconds($script:ManagerUpgradePolicy.ServiceTimeoutSeconds))
    if (Get-NetTCPConnection -LocalPort $Context.Port -State Listen -ErrorAction SilentlyContinue) {
        throw 'Manager listener did not release after stop; no process was killed.'
    }
    $selection = if ($InstallRoot -ieq $Context.Installed.installRoot) { 'Original' } else { 'Candidate' }
    Set-ManagerConfiguration -Transition $Context.Configuration -Selection $selection
    Invoke-WindowsServiceControl -Arguments @('config', $Context.Policy.ServiceName, 'binPath=',
        ('"' + (Join-Path $InstallRoot $Context.Policy.WrapperFileName) + '"')) | Out-Null
    Start-Service -Name $Context.Policy.ServiceName
    (Get-Service -Name $Context.Policy.ServiceName).WaitForStatus(
        'Running', [TimeSpan]::FromSeconds($script:ManagerUpgradePolicy.ServiceTimeoutSeconds))
}

function Save-ManagerUpgradeRecord {
    param([hashtable]$Record)
    $Record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Record.Path -Encoding utf8NoBOM
}

function Invoke-ManagerUpgrade {
    param([hashtable]$Context)
    if ($Context.Candidate.build.buildId -ceq $Context.Installed.build.buildId) {
        Write-Host 'Requested Manager release is already installed and healthy. No changes needed.'
        return
    }
    $history = Join-Path $Context.StateRoot 'upgrade-history'
    Assert-ServicePathWithoutLinks -Path $history
    [void][IO.Directory]::CreateDirectory($history)
    $record = @{ Path = (Join-Path $history ([Guid]::NewGuid().ToString('N') + '.json'))
        StartedAt = [DateTime]::UtcNow.ToString('o'); Status = 'preparing'
        Previous = $Context.Installed; CandidateBuild = $Context.Candidate.build
        CandidateRoot = (New-ManagerInstallPath -Context $Context)
        Files = $Context.Files; Services = $Context.Services; Configuration = $Context.Configuration }
    Save-ManagerUpgradeRecord -Record $record
    Write-Host "Manager upgrade receipt: $($record.Path)"
    $switched = $false
    try {
        New-ManagerInstalledRelease -Context $Context -Root $record.CandidateRoot
        Assert-ManagerPreservedState -Context $Context
        $record.Status = 'switching'; Save-ManagerUpgradeRecord -Record $record
        $switched = $true
        $roots = @($Context.Installed.installRoot, $record.CandidateRoot)
        Set-ManagerInstalledRelease -Context $Context -InstallRoot $record.CandidateRoot -AllowedRoots $roots
        $record.Acceptance = Wait-ManagerInstalledHealth -Context $Context -InstallRoot $record.CandidateRoot
        $receipt = $Context.Installed.Clone()
        $receipt.installRoot = $record.CandidateRoot; $receipt.build = $Context.Candidate.build
        $receipt.installedAt = [DateTime]::UtcNow.ToString('o'); $receipt.started = $true
        $receipt.releaseManifestSha256 = (Get-FileHash -LiteralPath (
            Join-Path $record.CandidateRoot $Context.Policy.ReleaseManifestFileName)).Hash
        Save-ServiceInstallationReceipt -StateRoot $Context.StateRoot -Receipt $receipt -Policy $Context.Policy
        $record.Status = 'accepted'; Save-ManagerUpgradeRecord -Record $record
        Write-Host "Installed Manager $($Context.Candidate.build.version)."
    } catch {
        $record.Error = $_.Exception.Message; $record.Status = 'failed'
        Save-ManagerUpgradeRecord -Record $record
        if ($switched) { Repair-ManagerUpgrade -Context $Context -Record $record }
        throw "Manager upgrade failed: $($record.Error). Receipt: $($record.Path)"
    } finally {
        if (-not $switched) {
            Remove-ManagerIncompleteStage -Context $Context -Path $record.CandidateRoot
        }
    }
}

function Repair-ManagerUpgrade {
    param([hashtable]$Context, [hashtable]$Record)
    try {
        Set-ManagerInstalledRelease -Context $Context -InstallRoot $Context.Installed.installRoot `
            -AllowedRoots @($Context.Installed.installRoot, $Record.CandidateRoot)
        $Record.Recovery = Wait-ManagerInstalledHealth -Context $Context `
            -InstallRoot $Context.Installed.installRoot
        Save-ServiceInstallationReceipt -StateRoot $Context.StateRoot `
            -Receipt $Context.Installed -Policy $Context.Policy
        $Record.Status = 'recovered'; Save-ManagerUpgradeRecord -Record $Record
        Write-Warning 'Manager upgrade failed; the previous authenticated Manager is healthy.'
    } catch {
        $Record.Status = 'recovery-failed'; $Record.RecoveryError = $_.Exception.Message
        Save-ManagerUpgradeRecord -Record $Record
        Write-Warning "Manager recovery failed: $($Record.RecoveryError). Receipt: $($Record.Path)"
    }
}
