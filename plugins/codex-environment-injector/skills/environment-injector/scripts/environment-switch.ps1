[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('list', 'status', 'activate', 'deactivate', 'recover', 'doctor')]
    [string]$Command = 'status',

    [Parameter(Position = 1)]
    [string]$Name,

    [switch]$Force,

    [string]$CodexHome,

    [string]$CodexBin
)

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$pythonScript = Join-Path $PSScriptRoot 'environment_switch.py'

$python = Get-Command python -ErrorAction SilentlyContinue
$launcher = @()
if ($python) {
    $launcher = @($python.Source)
} else {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if (-not $py) {
        throw 'Python 3.11+ is required (tomllib is used).'
    }
    $launcher = @($py.Source, '-3')
}

$invokeArgs = @($pythonScript)
if ($CodexHome) {
    $invokeArgs += @('--codex-home', $CodexHome)
}
if ($CodexBin) {
    $invokeArgs += @('--codex-bin', $CodexBin)
}
$invokeArgs += $Command

if ($Command -eq 'activate') {
    if (-not $Name) {
        throw 'activate requires an environment name, for example: activate work'
    }
    $invokeArgs += $Name
}
if ($Command -eq 'deactivate' -and $Force) {
    $invokeArgs += '--force'
}

if ($launcher.Count -eq 1) {
    & $launcher[0] @invokeArgs
} else {
    & $launcher[0] $launcher[1] @invokeArgs
}
exit $LASTEXITCODE
