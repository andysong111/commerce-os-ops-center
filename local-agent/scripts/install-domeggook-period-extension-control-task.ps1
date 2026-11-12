param(
  [string]$TaskName = "Commerce OS Domeggook Period Extension Control",
  [int]$Port = 43122,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Resolve-Path (Join-Path $ScriptDir "..\..")
$EntryPoint = Resolve-Path (Join-Path $RepoDir "local-agent\bin\domeggook-period-extension-control.mjs")
$Node = (Get-Command "node.exe" -ErrorAction Stop).Source
$Argument = "`"$EntryPoint`" --port $Port"
$Action = New-ScheduledTaskAction -Execute $Node -Argument $Argument -WorkingDirectory $RepoDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs the localhost-only Domeggook all-account period-extension control." -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
Write-Host "Installed scheduled task: $TaskName"
Write-Host "Domeggook local control: http://127.0.0.1:$Port/"
