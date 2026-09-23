[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$InstallationRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$script:ProbeNotes = New-Object 'System.Collections.Generic.HashSet[string]'
$script:ServiceFilter =
    "Name='DsConverterSvc' OR " +
    "Name='DsDocServiceSvc' OR " +
    "Name='DsProxySvc' OR " +
    "Name='DsExampleSvc'"

function Add-ProbeNote {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Code
    )

    [void]$script:ProbeNotes.Add($Code)
}

function Test-ConfiguredInstallationRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
            Add-ProbeNote -Code 'installation-root-missing'
        }
    }
    catch {
        Add-ProbeNote -Code 'installation-root-missing'
    }
}

function Get-OnlyOfficeVersion {
    $uninstallKey =
        'Microsoft\Windows\CurrentVersion\Uninstall\ONLYOFFICE DocumentServer_is1'
    $registryKeys = @(
        "HKLM:\SOFTWARE\$uninstallKey",
        "HKLM:\SOFTWARE\WOW6432Node\$uninstallKey"
    )

    try {
        foreach ($registryKey in $registryKeys) {
            if (-not (Test-Path -LiteralPath $registryKey)) {
                continue
            }

            $value = Get-ItemPropertyValue `
                -LiteralPath $registryKey `
                -Name 'DisplayVersion'
            $version = ([string]$value).Trim()
            if ($version -match '^\d+(?:\.\d+){1,4}$') {
                return $version
            }
        }
    }
    catch {
        Add-ProbeNote -Code 'installed-version-unavailable'
        return 'unknown'
    }

    Add-ProbeNote -Code 'installed-version-unavailable'
    return 'unknown'
}

function Get-ManagedServices {
    try {
        $properties = @('DisplayName', 'Name', 'ProcessId', 'StartMode', 'State')
        $services = @(
            Get-CimInstance `
                -ClassName 'Win32_Service' `
                -Filter $script:ServiceFilter `
                -Property $properties
        )

        return @(
            $services |
                Sort-Object -Property Name |
                ForEach-Object {
                    [PSCustomObject][ordered]@{
                        displayName = [string]$_.DisplayName
                        name = [string]$_.Name
                        processId = [uint32]$_.ProcessId
                        startMode = [string]$_.StartMode
                        state = [string]$_.State
                    }
                }
        )
    }
    catch {
        Add-ProbeNote -Code 'service-query-failed'
        return @()
    }
}

function Test-CurrentParentChildPair {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Parent,

        [Parameter(Mandatory = $true)]
        [object]$Child
    )

    if ($null -eq $Parent.CreationDate -or $null -eq $Child.CreationDate) {
        return $true
    }

    return [datetime]$Child.CreationDate -ge [datetime]$Parent.CreationDate
}

function Find-ManagedProcessIds {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Services,

        [Parameter(Mandatory = $true)]
        [object[]]$AllProcesses
    )

    $processById = @{}
    foreach ($process in $AllProcesses) {
        $processById[[uint32]$process.ProcessId] = $process
    }

    $selectedIds = New-Object 'System.Collections.Generic.HashSet[uint32]'
    foreach ($service in $Services) {
        $processId = [uint32]$service.processId
        if ($processId -gt 0 -and $processById.ContainsKey($processId)) {
            [void]$selectedIds.Add($processId)
        }
    }

    do {
        $addedProcess = $false
        foreach ($process in $AllProcesses) {
            $processId = [uint32]$process.ProcessId
            $parentId = [uint32]$process.ParentProcessId
            if ($selectedIds.Contains($processId) -or -not $selectedIds.Contains($parentId)) {
                continue
            }

            $parent = $processById[$parentId]
            if (Test-CurrentParentChildPair -Parent $parent -Child $process) {
                [void]$selectedIds.Add($processId)
                $addedProcess = $true
            }
        }
    } while ($addedProcess)

    return @($selectedIds | Sort-Object)
}

function Get-ManagedProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Services
    )

    try {
        $properties = @(
            'CreationDate',
            'Name',
            'ParentProcessId',
            'ProcessId',
            'WorkingSetSize'
        )
        $allProcesses = @(Get-CimInstance -ClassName 'Win32_Process' -Property $properties)
        $processIds = @(Find-ManagedProcessIds -Services $Services -AllProcesses $allProcesses)
        $selected = New-Object 'System.Collections.Generic.HashSet[uint32]'
        foreach ($processId in $processIds) {
            [void]$selected.Add([uint32]$processId)
        }

        $observations = @(
            $allProcesses |
                Where-Object { $selected.Contains([uint32]$_.ProcessId) } |
                Sort-Object -Property ProcessId |
                ForEach-Object {
                    [PSCustomObject][ordered]@{
                        name = [string]$_.Name
                        parentProcessId = [uint32]$_.ParentProcessId
                        processId = [uint32]$_.ProcessId
                        workingSetBytes = [long]$_.WorkingSetSize
                    }
                }
        )

        return [PSCustomObject]@{
            observations = $observations
            processIds = $processIds
        }
    }
    catch {
        Add-ProbeNote -Code 'process-query-failed'
        return [PSCustomObject]@{
            observations = @()
            processIds = @()
        }
    }
}

function Get-ManagedListeners {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$ProcessIds
    )

    if ($ProcessIds.Count -eq 0) {
        return @()
    }

    try {
        $selected = New-Object 'System.Collections.Generic.HashSet[uint32]'
        foreach ($processId in $ProcessIds) {
            [void]$selected.Add([uint32]$processId)
        }

        return @(
            Get-NetTCPConnection -State Listen |
                Where-Object { $selected.Contains([uint32]$_.OwningProcess) } |
                Sort-Object -Property LocalPort, LocalAddress, OwningProcess |
                ForEach-Object {
                    [PSCustomObject][ordered]@{
                        address = [string]$_.LocalAddress
                        port = [uint16]$_.LocalPort
                        processId = [uint32]$_.OwningProcess
                    }
                }
        )
    }
    catch {
        Add-ProbeNote -Code 'listener-query-failed'
        return @()
    }
}

Test-ConfiguredInstallationRoot -Path $InstallationRoot
$installedVersion = Get-OnlyOfficeVersion
$services = @(Get-ManagedServices)
$processSnapshot = Get-ManagedProcesses -Services $services
$processes = @($processSnapshot.observations)
$listeners = @(Get-ManagedListeners -ProcessIds @($processSnapshot.processIds))

$result = [ordered]@{
    installedVersion = $installedVersion
    listeners = $listeners
    notes = @($script:ProbeNotes | Sort-Object)
    processes = $processes
    services = $services
}

$result | ConvertTo-Json -Compress -Depth 5
