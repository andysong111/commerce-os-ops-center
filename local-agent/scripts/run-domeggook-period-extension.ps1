param(
  [int]$DebugPort = 9234,
  [string]$UserDataDir = "",
  [int]$Days = 90,
  [string]$AccountId = "",
  [switch]$ShowChrome,
  [switch]$LaunchOnly,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Resolve-Path (Join-Path $ScriptDir "..")
$RepoDir = Resolve-Path (Join-Path $AgentDir "..")
$ListUrl = "https://www.domeggook.com/main/mySell/register/my_sellList.php?mode=OVER"
$Endpoint = "http://127.0.0.1:$DebugPort"
if (-not $UserDataDir) {
  if (-not $AccountId) { throw "AccountId is required when UserDataDir is omitted." }
  $UserDataDir = Join-Path $env:LOCALAPPDATA "CommerceOS\DomeggookChromeProfiles\$AccountId"
}

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
    "--no-first-run",
    $ListUrl
  )
  if (-not $ShowChrome) { $ChromeArgs = @("--start-minimized") + $ChromeArgs }
  $WindowStyle = if ($ShowChrome) { "Normal" } else { "Hidden" }
  Start-Process -FilePath $Chrome -ArgumentList $ChromeArgs -WindowStyle $WindowStyle
} elseif ($ShowChrome) {
  Start-Process -FilePath $Chrome -ArgumentList @(
    "--remote-debugging-port=$DebugPort",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=$UserDataDir",
    $ListUrl
  ) -WindowStyle Normal
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
if ($LaunchOnly) { exit 0 }

$CredentialPath = Join-Path $env:LOCALAPPDATA "CommerceOS\DomeggookCredentials\$AccountId.xml"
if (Test-Path -LiteralPath $CredentialPath) {
  $StoredCredential = Import-Clixml -LiteralPath $CredentialPath
  if ($StoredCredential.UserName -ne $AccountId) {
    throw "Stored Domeggook credential account does not match AccountId."
  }
  $env:DOMEGGOOK_PASSWORD = $StoredCredential.GetNetworkCredential().Password
}

$env:COMMERCE_OS_CHROME_DEBUG_URL = $Endpoint
$NodeArgs = @("local-agent/scripts/run-domeggook-period-extension.mjs", "--days", "$Days")
if ($AccountId) { $NodeArgs += @("--account-id", $AccountId) }
if ($Execute) { $NodeArgs += "--execute" } else { $NodeArgs += "--dry-run" }

Push-Location $RepoDir
try {
  & node @NodeArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:DOMEGGOOK_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
