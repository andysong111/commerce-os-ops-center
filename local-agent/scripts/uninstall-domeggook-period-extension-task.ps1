param(
  [string]$TaskName = "Commerce OS Domeggook Period Extension"
)

$ErrorActionPreference = "Stop"
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task: $TaskName"
} else {
  Write-Host "Scheduled task was not installed: $TaskName"
}
