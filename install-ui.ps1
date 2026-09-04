[CmdletBinding()]
param(
    [string[]]$Profile
)

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$generator = Join-Path $PSScriptRoot 'tools\sync_environment_injector.py'
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $node -or -not $npm) {
    throw 'Node.js and npm are required to build the React userscript UI.'
}
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\react\package.json'))) {
    & $npm.Source ci --ignore-scripts --prefix $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}
& $npm.Source run build:react --prefix $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw "React UI build failed with exit code $LASTEXITCODE" }

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    $command = @($python.Source)
} else {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if (-not $py) {
        throw 'Python 3.11+ is required.'
    }
    $command = @($py.Source, '-3')
}

$arguments = @($generator)
foreach ($name in @($Profile)) {
    if ($name) {
        $arguments += @('--profile', $name)
    }
}
$arguments += 'sync'

if ($command.Count -eq 1) {
    & $command[0] @arguments
} else {
    & $command[0] $command[1] @arguments
}
if ($LASTEXITCODE -ne 0) {
    throw "Environment Injector sync failed with exit code $LASTEXITCODE"
}

$scriptPaths = @(
    (Join-Path $env:APPDATA 'Codex++\user_scripts\codex-environment-injector.js')
)
if ($node) {
    foreach ($scriptPath in $scriptPaths) {
        if (-not (Test-Path $scriptPath)) {
            throw "Generated userscript is missing: $scriptPath"
        }
        & $node.Source --check $scriptPath
        if ($LASTEXITCODE -ne 0) {
            throw "Generated userscript failed node --check: $scriptPath"
        }
    }
}

Write-Host 'Reload Codex++ user scripts or restart Codex through Codex++ to load Environment Injector.'
