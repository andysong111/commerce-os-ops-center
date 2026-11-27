param(
  [Parameter(Mandatory)] [Security.SecureString]$AgentToken,
  [ValidatePattern('^https://[A-Za-z0-9.-]+/api/mobile-work-center$')]
  [string]$Endpoint = "https://commerce-os-ops-center.vercel.app/api/mobile-work-center",
  [switch]$AllowBusiness,
  [switch]$StartNow
)
$ErrorActionPreference = "Stop"
$workerTask = "Commerce OS Mobile Work Center"
$existing = Get-ScheduledTask -TaskName $workerTask -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq "Running") {
  throw "Stop the existing mobile worker after its current request is resolved before reinstalling."
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$launcher = Join-Path $PSScriptRoot "run-windows.ps1"
$directory = Join-Path $env:LOCALAPPDATA "CommerceOS\MobileWorkCenter"
$null = New-Item -ItemType Directory -Path $directory -Force
$configPath = Join-Path $directory "connection.json"
$temporaryPath = Join-Path $directory ("connection-" + [guid]::NewGuid().ToString("N") + ".json")
@{
  endpoint = $Endpoint
  encryptedToken = (ConvertFrom-SecureString -SecureString $AgentToken)
  allowBusiness = $AllowBusiness.IsPresent
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
Move-Item -LiteralPath $temporaryPath -Destination $configPath -Force

$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$args = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -ConfigPath `"$configPath`" -NodePath `"$nodePath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $args -WorkingDirectory $PSScriptRoot
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$null = Register-ScheduledTask -TaskName $workerTask -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Force
if ($StartNow) { Start-ScheduledTask -TaskName $workerTask }
Write-Output ("Mobile Work Center registered. Business actions enabled: " + $AllowBusiness.IsPresent)
