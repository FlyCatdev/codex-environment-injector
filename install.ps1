[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$marketplaceName = 'codex-environment-tools'
$pluginId = 'codex-environment-injector@codex-environment-tools'

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

$marketplaces = (Invoke-Codex -Arguments @('plugin', 'marketplace', 'list', '--json') | Out-String | ConvertFrom-Json).marketplaces
if (-not ($marketplaces | Where-Object name -eq $marketplaceName)) {
    Invoke-Codex -Arguments @('plugin', 'marketplace', 'add', $PSScriptRoot, '--json') | Out-Host
}

$plugins = Invoke-Codex -Arguments @('plugin', 'list', '--available', '--json') | Out-String | ConvertFrom-Json
$installed = @($plugins.installed) | Where-Object pluginId -eq $pluginId
if (-not $installed) {
    Invoke-Codex -Arguments @('plugin', 'add', $pluginId, '--json') | Out-Host
}

Write-Host "Installed: $pluginId"
Write-Host 'Restart Codex Desktop (or open a new thread) before invoking $environment-injector.'
