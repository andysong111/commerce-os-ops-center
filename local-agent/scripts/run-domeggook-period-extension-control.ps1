param([int]$Port = 43122)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Resolve-Path (Join-Path $ScriptDir "..\..")

Push-Location $RepoDir
try {
  & node .\local-agent\bin\domeggook-period-extension-control.mjs --port $Port
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
