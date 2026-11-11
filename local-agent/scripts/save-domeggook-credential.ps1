param(
  [Parameter(Mandatory = $true)]
  [string]$AccountId,
  [string]$CredentialRoot = "$env:LOCALAPPDATA\CommerceOS\DomeggookCredentials"
)

$ErrorActionPreference = "Stop"
if ($AccountId -notmatch '^[A-Za-z0-9._-]{3,50}$') {
  throw "AccountId contains unsupported characters."
}
$PlainPassword = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($PlainPassword)) {
  throw "Password input is empty."
}
New-Item -ItemType Directory -Force -Path $CredentialRoot | Out-Null
$CredentialPath = Join-Path $CredentialRoot "$AccountId.xml"
$TemporaryPath = "$CredentialPath.$PID.tmp"
$SecurePassword = ConvertTo-SecureString $PlainPassword -AsPlainText -Force
$Credential = [PSCredential]::new($AccountId, $SecurePassword)
$Credential | Export-Clixml -LiteralPath $TemporaryPath
Move-Item -LiteralPath $TemporaryPath -Destination $CredentialPath -Force
Write-Host "Saved encrypted credential for: $AccountId"
