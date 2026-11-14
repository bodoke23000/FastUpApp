$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  $bundledNodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  if (Test-Path -LiteralPath $bundledNodePath) { $nodePath = $bundledNodePath }
}
if (-not $nodePath) { throw 'Install Node.js 24 LTS, then run this launcher again.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  $npmPath = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npmPath) { throw 'Run npm ci in this folder with Node.js 24 installed.' }
  & $npmPath ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Fast Up will run at http://localhost:3030'
Write-Host 'Demo: supervisor@fastup.local / FastUp-Demo-2026!'
Write-Host 'Press Ctrl+C to stop. This launcher uses local evaluation data.'
& $nodePath 'scripts/launch.js'
