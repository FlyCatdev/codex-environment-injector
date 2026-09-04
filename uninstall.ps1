[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$marketplaceName = 'codex-environment-tools'
$pluginId = 'codex-environment-injector@codex-environment-tools'
$manager = Join-Path $PSScriptRoot 'plugins\codex-environment-injector\skills\environment-injector\scripts\environment-switch.ps1'

$codexCommand = Get-Command codex.cmd -ErrorAction SilentlyContinue
if (-not $codexCommand) {
    $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
}
if (-not $codexCommand) {
    $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
}
if (-not $codexCommand) {
    throw 'codex is not available on PATH.'
}
$script:CodexCommand = $codexCommand.Source

function Invoke-Codex {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $stderrPath = Join-Path $env:TEMP ("codex-environment-injector-{0}.err" -f [guid]::NewGuid())
    try {
        $previousErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & $script:CodexCommand @Arguments 2>$stderrPath
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorAction
        }
        if ($exitCode -ne 0) {
            $detail = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
            throw "codex exited with code ${exitCode}: $detail"
        }
        return $output
    } finally {
        Remove-Item $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path $manager) {
    $status = & powershell -NoProfile -ExecutionPolicy Bypass -File $manager status 2>&1 | Out-String
    if ($status -match '^ACTIVE:' -or $status -match "`nACTIVE:") {
        throw 'A Desktop environment overlay is active. Run environment-switch.ps1 deactivate before uninstalling.'
    }
}

$plugins = (Invoke-Codex -Arguments @('plugin', 'list', '--json') | Out-String | ConvertFrom-Json).installed
if ($plugins | Where-Object pluginId -eq $pluginId) {
    Invoke-Codex -Arguments @('plugin', 'remove', $pluginId, '--json') | Out-Host
}

$marketplaces = (Invoke-Codex -Arguments @('plugin', 'marketplace', 'list', '--json') | Out-String | ConvertFrom-Json).marketplaces
if ($marketplaces | Where-Object name -eq $marketplaceName) {
    Invoke-Codex -Arguments @('plugin', 'marketplace', 'remove', $marketplaceName, '--json') | Out-Host
}

Write-Host "Removed: $pluginId"
