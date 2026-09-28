param(
  [int]$DebugPort = 9222,
  [string]$UserDataDir = "$env:LOCALAPPDATA\CommerceOS\ChromeDebugProfile",
  [string]$Url = "https://a.shopling.co.kr/main.phtml"
)

$ErrorActionPreference = "Stop"
$ChromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$Chrome = $ChromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Chrome) {
  throw "Chrome executable was not found."
}

New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
$Args = @(
  "--remote-debugging-port=$DebugPort",
  "--remote-debugging-address=127.0.0.1",
  "--user-data-dir=$UserDataDir",
  "--no-first-run",
  $Url
)

Start-Process -FilePath $Chrome -ArgumentList $Args
Write-Host "Started Chrome with DevTools on http://127.0.0.1:$DebugPort"
