Set-StrictMode -Version Latest

function Get-ManagerConfigurationCandidate {
    param([System.Collections.IDictionary]$Configuration)
    if (-not $Configuration.Contains('applicationConfigFile')) { return $Configuration }
    $candidate = $Configuration | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
    $sourcePath = Get-AbsoluteServicePath -Path $candidate.applicationConfigFile
    Assert-ServicePathWithoutLinks -Path $sourcePath
    $source = Read-ServiceJsonFile -Path $sourcePath
    foreach ($selection in @(
        @{ Section = 'onlyOffice'; Field = 'documentServerUrl' },
        @{ Section = 'telemetry'; Field = 'collectorOrigin' }
    )) {
        $section = $selection.Section
        $field = $selection.Field
        if (-not $candidate.Contains($section)) { $candidate[$section] = @{} }
        if (-not $candidate[$section].Contains($field)) {
            if (-not $source.Contains($section) -or -not $source[$section].Contains($field)) {
                throw "Referenced application configuration has no $section.$field."
            }
            $candidate[$section][$field] = $source[$section][$field]
        }
    }
    $candidate.Remove('applicationConfigFile')
    $candidate
}

function Get-ManagerConfigurationBytesRecord {
    param([byte[]]$Bytes)
    @{ Base64 = [Convert]::ToBase64String($Bytes)
        Hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)) }
}

function Invoke-ManagerConfigurationValidation {
    param([string]$Executable, [string]$Path)
    $output = & $Executable --validate-config $Path 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Candidate Manager configuration validation failed: $($output -join [Environment]::NewLine)"
    }
}

function Test-ManagerConfigurationCandidate {
    param([hashtable]$Transition, [string]$StateRoot, [string]$Executable)
    $parent = Join-Path $StateRoot 'deploy'
    Assert-ServicePathWithoutLinks -Path $parent
    [void][IO.Directory]::CreateDirectory($parent)
    $scratch = Join-Path $parent ('manager-config-' + [Guid]::NewGuid().ToString('N'))
    Assert-ServiceChildPath -Path $scratch -Root $parent
    [void][IO.Directory]::CreateDirectory($scratch)
    $path = Join-Path $scratch 'candidate.json'
    try {
        [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($Transition.Candidate.Base64))
        $acl = Get-Acl -LiteralPath $Transition.Path
        Set-Acl -LiteralPath $path -AclObject $acl
        Invoke-ManagerConfigurationValidation -Executable $Executable -Path $path
        if ((Get-FileHash -LiteralPath $path).Hash -ne $Transition.Candidate.Hash) {
            throw 'Candidate Manager configuration changed during validation.'
        }
    } finally {
        Assert-ServiceChildPath -Path $scratch -Root $parent
        Assert-ServicePathWithoutLinks -Path $scratch
        if ([IO.Path]::GetFileName($scratch) -notmatch '^manager-config-[a-f0-9]{32}$') {
            throw 'Refusing to remove unowned Manager configuration scratch.'
        }
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}

function New-ManagerConfigurationTransition {
    param([string]$Path, [string]$StateRoot, [string]$Executable)
    $path = Get-AbsoluteServicePath -Path $Path
    Assert-ServicePathWithoutLinks -Path $path
    $bytes = [IO.File]::ReadAllBytes($path)
    $original = Read-ServiceJsonFile -Path $path
    $candidate = Get-ManagerConfigurationCandidate -Configuration $original
    $candidateBytes = if ($original.Contains('applicationConfigFile')) {
        [Text.Encoding]::UTF8.GetBytes(($candidate | ConvertTo-Json -Depth 20) + "`n")
    } else { $bytes }
    $transition = @{ Path = $path; Acl = (Get-Acl -LiteralPath $path).Sddl; Active = 'Original'
        Original = (Get-ManagerConfigurationBytesRecord -Bytes $bytes)
        Candidate = (Get-ManagerConfigurationBytesRecord -Bytes $candidateBytes) }
    Test-ManagerConfigurationCandidate -Transition $transition -StateRoot $StateRoot -Executable $Executable
    if ((Get-FileHash -LiteralPath $path).Hash -ne $transition.Original.Hash -or
        (Get-Acl -LiteralPath $path).Sddl -cne $transition.Acl) {
        throw 'Installed Manager configuration changed during preflight.'
    }
    $transition
}

function Set-ManagerConfiguration {
    param([hashtable]$Transition, [ValidateSet('Original', 'Candidate')][string]$Selection)
    $path = $Transition.Path
    Assert-ServicePathWithoutLinks -Path $path
    $current = (Get-FileHash -LiteralPath $path).Hash
    if ($current -notin @($Transition.Original.Hash, $Transition.Candidate.Hash) -or
        (Get-Acl -LiteralPath $path).Sddl -cne $Transition.Acl) {
        throw 'Refusing to overwrite Manager configuration changed outside this upgrade.'
    }
    $selected = $Transition[$Selection]
    if ($current -ne $selected.Hash) {
        $staging = $path + '.' + [Guid]::NewGuid().ToString('N') + '.stage'
        try {
            [IO.File]::WriteAllBytes($staging, [Convert]::FromBase64String($selected.Base64))
            Set-Acl -LiteralPath $staging -AclObject (Get-Acl -LiteralPath $path)
            [IO.File]::Replace($staging, $path, [NullString]::Value)
        } finally {
            if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Force }
        }
    }
    if ((Get-FileHash -LiteralPath $path).Hash -ne $selected.Hash -or
        (Get-Acl -LiteralPath $path).Sddl -cne $Transition.Acl) {
        throw 'Manager configuration replacement did not preserve its expected bytes and access.'
    }
    $Transition.Active = $Selection
}
