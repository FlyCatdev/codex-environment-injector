[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$generator = Join-Path $PSScriptRoot 'tools\sync_environment_injector.py'

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    & $python.Source $generator uninstall
} else {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if (-not $py) {
        throw 'Python 3.11+ is required.'
    }
    & $py.Source -3 $generator uninstall
}
if ($LASTEXITCODE -ne 0) {
    throw "Environment Injector uninstall failed with exit code $LASTEXITCODE"
}

Write-Host 'Reload Codex++ user scripts or restart Codex++ to remove Environment Injector from the active page.'
