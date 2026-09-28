param(
  [string]$NodePath = "node"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentRoot = Resolve-Path (Join-Path $ScriptDir "..")
$RepoRoot = Resolve-Path (Join-Path $AgentRoot "..")
$LogDir = Join-Path $AgentRoot "logs"
$LogPath = Join-Path $LogDir "agent.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $RepoRoot

& $NodePath ".\local-agent\bin\commerce-os-local-agent.mjs" daemon *>> $LogPath
exit $LASTEXITCODE
