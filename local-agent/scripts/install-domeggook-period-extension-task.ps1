param(
  [string]$TaskName = "",
  [string]$At = "00:10",
  [int]$Days = 90,
  [string]$AccountId = "",
  [int]$DebugPort = 9234,
  [switch]$Execute,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Resolve-Path (Join-Path $ScriptDir "run-domeggook-period-extension.ps1")
if (-not $AccountId -or $AccountId -notmatch '^[A-Za-z0-9._-]{3,50}$') {
  throw "AccountId must use 3-50 letters, numbers, dots, underscores, or hyphens."
}
if (-not $TaskName) { $TaskName = "Commerce OS Domeggook Period Extension - $AccountId" }
try {
  $ScheduleTime = [DateTime]::ParseExact($At, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
} catch {
  throw "At must use 24-hour HH:mm format, for example 04:10."
}

$ArgumentParts = @(
  "-NoProfile",
  "-WindowStyle Hidden",
  "-ExecutionPolicy Bypass",
  "-File `"$RunScript`"",
  "-Days $Days",
  "-DebugPort $DebugPort"
)
if ($AccountId) {
  $ArgumentParts += "-AccountId `"$AccountId`""
}
if ($Execute) { $ArgumentParts += "-Execute" }
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($ArgumentParts -join " ")
$Trigger = New-ScheduledTaskTrigger -Daily -At $ScheduleTime
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew

$Mode = if ($Execute) { "live write with verified readback" } else { "dry run only" }
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Commerce OS Domeggook period extension ($Mode)." `
  -Force | Out-Null

if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Schedule: daily $At"
Write-Host "Mode: $Mode"
Write-Host "Extension days: $Days"
Write-Host "Account ID: $AccountId"
Write-Host "Debug port: $DebugPort"
