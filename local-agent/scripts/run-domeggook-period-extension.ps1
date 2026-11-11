param(
  [int]$DebugPort = 9234,
  [string]$UserDataDir = "$env:LOCALAPPDATA\CommerceOS\DomeggookChromeProfile",
  [int]$Days = 90,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Resolve-Path (Join-Path $ScriptDir "..")
$RepoDir = Resolve-Path (Join-Path $AgentDir "..")
$ListUrl = "https://www.domeggook.com/main/mySell/register/my_sellList.php?mode=OVER"
$Endpoint = "http://127.0.0.1:$DebugPort"

$ChromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$Chrome = $ChromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Chrome) {
  throw "Chrome executable was not found."
}

$Listening = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $DebugPort -ErrorAction SilentlyContinue
if (-not $Listening) {
  New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
  $ChromeArgs = @(
    "--disable-translate",
    "--disable-features=Translate,TranslateUI",
    "--remote-debugging-port=$DebugPort",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=$UserDataDir",
    "--start-minimized",
    "--no-first-run",
    $ListUrl
  )
  Start-Process -FilePath $Chrome -ArgumentList $ChromeArgs -WindowStyle Hidden
}

$Ready = $false
for ($Attempt = 0; $Attempt -lt 30; $Attempt += 1) {
  try {
    Invoke-RestMethod -Uri "$Endpoint/json/version" -TimeoutSec 2 | Out-Null
    $Ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $Ready) {
  throw "Domeggook Chrome did not expose its local DevTools endpoint at $Endpoint."
}

$env:COMMERCE_OS_CHROME_DEBUG_URL = $Endpoint
$NodeArgs = @("local-agent/scripts/run-domeggook-period-extension.mjs", "--days", "$Days")
if ($Execute) { $NodeArgs += "--execute" } else { $NodeArgs += "--dry-run" }

Push-Location $RepoDir
try {
  & node @NodeArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
