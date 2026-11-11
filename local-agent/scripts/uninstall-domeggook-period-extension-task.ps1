param(
  [string]$TaskName = "",
  [string]$AccountId = ""
)

$ErrorActionPreference = "Stop"
if (-not $TaskName) {
  $TaskName = if ($AccountId) { "Commerce OS Domeggook Period Extension - $AccountId" } else { "Commerce OS Domeggook Period Extension" }
}
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task: $TaskName"
} else {
  Write-Host "Scheduled task was not installed: $TaskName"
}
