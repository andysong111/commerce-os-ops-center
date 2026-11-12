param(
  [string]$TaskName = "Commerce OS Domeggook Period Extension Control",
  [int]$Port = 43122,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Resolve-Path (Join-Path $ScriptDir "run-domeggook-period-extension-control.ps1")
$Argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`" -Port $Port"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs the localhost-only Domeggook all-account period-extension control." -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
Write-Host "Installed scheduled task: $TaskName"
Write-Host "Domeggook local control: http://127.0.0.1:$Port/"
