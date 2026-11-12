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
    $Targets = @(Invoke-RestMethod -Uri "$Endpoint/json/list" -TimeoutSec 2)
    if (-not ($Targets | Where-Object { $_.type -eq "page" })) { throw "Chrome page target is not ready." }
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

$CredentialPath = Join-Path $env:LOCALAPPDATA "CommerceOS\DomeggookCredentials\$AccountId.dpapi"
if (Test-Path -LiteralPath $CredentialPath) {
  [void][Reflection.Assembly]::LoadWithPartialName("System.Security")
  $CredentialLines = [IO.File]::ReadAllLines($CredentialPath, [Text.Encoding]::UTF8)
  if ($CredentialLines.Length -ne 3 -or $CredentialLines[0] -ne "COMMERCE_OS_DOMEGGOOK_DPAPI_V1") {
    throw "Stored Domeggook credential format is invalid."
  }
  if ($CredentialLines[1] -ne $AccountId) {
    throw "Stored Domeggook credential account does not match AccountId."
  }
  $EncryptedPassword = [Convert]::FromBase64String($CredentialLines[2])
  $Entropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-domeggook-v1:$AccountId")
  $PlainPasswordBytes = $null
  try {
    $PlainPasswordBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $EncryptedPassword,
      $Entropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $env:DOMEGGOOK_PASSWORD = [Text.Encoding]::UTF8.GetString($PlainPasswordBytes)
  }
  finally {
    [Array]::Clear($EncryptedPassword, 0, $EncryptedPassword.Length)
    [Array]::Clear($Entropy, 0, $Entropy.Length)
    if ($PlainPasswordBytes) { [Array]::Clear($PlainPasswordBytes, 0, $PlainPasswordBytes.Length) }
  }
}

$SyncTokenPath = Join-Path $env:LOCALAPPDATA "CommerceOS\DomeggookReceiptSync.dpapi"
if (Test-Path -LiteralPath $SyncTokenPath) {
  [void][Reflection.Assembly]::LoadWithPartialName("System.Security")
  $SyncTokenLines = [IO.File]::ReadAllLines($SyncTokenPath, [Text.Encoding]::UTF8)
  if ($SyncTokenLines.Length -ne 2 -or $SyncTokenLines[0] -ne "COMMERCE_OS_DOMEGGOOK_RECEIPT_SYNC_DPAPI_V1") {
    throw "Stored Domeggook receipt sync token format is invalid."
  }
  $EncryptedSyncToken = [Convert]::FromBase64String($SyncTokenLines[1])
  $SyncEntropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-domeggook-receipt-sync-v1")
  $PlainSyncTokenBytes = $null
  try {
    $PlainSyncTokenBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $EncryptedSyncToken,
      $SyncEntropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $env:DOMEGGOOK_RECEIPT_SYNC_TOKEN = [Text.Encoding]::UTF8.GetString($PlainSyncTokenBytes)
  }
  finally {
    [Array]::Clear($EncryptedSyncToken, 0, $EncryptedSyncToken.Length)
    [Array]::Clear($SyncEntropy, 0, $SyncEntropy.Length)
    if ($PlainSyncTokenBytes) { [Array]::Clear($PlainSyncTokenBytes, 0, $PlainSyncTokenBytes.Length) }
  }
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
  Remove-Item Env:DOMEGGOOK_RECEIPT_SYNC_TOKEN -ErrorAction SilentlyContinue
  Pop-Location
}
