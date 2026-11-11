param(
  [Parameter(Mandatory = $true)]
  [string]$AccountId,
  [string]$CredentialRoot = "$env:LOCALAPPDATA\CommerceOS\DomeggookCredentials"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($AccountId -notmatch '^[A-Za-z0-9._-]{3,50}$') {
  throw "AccountId contains unsupported characters."
}
$PlainPassword = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($PlainPassword)) {
  throw "Password input is empty."
}
[void][Reflection.Assembly]::LoadWithPartialName("System.Security")
$plainBytes = $null
$entropy = $null
$encrypted = $null
try {
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($PlainPassword)
  $entropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-domeggook-v1:$AccountId")
  $encrypted = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )

  [IO.Directory]::CreateDirectory($CredentialRoot) | Out-Null
  $CredentialPath = [IO.Path]::Combine($CredentialRoot, "$AccountId.dpapi")
  $TemporaryPath = "$CredentialPath.$PID.tmp"
  $lines = [string[]]@(
    "COMMERCE_OS_DOMEGGOOK_DPAPI_V1",
    $AccountId,
    [Convert]::ToBase64String($encrypted)
  )
  [IO.File]::WriteAllLines($TemporaryPath, $lines, [Text.UTF8Encoding]::new($false))
  if ([IO.File]::Exists($CredentialPath)) {
    $BackupPath = "$CredentialPath.$PID.bak"
    [IO.File]::Replace($TemporaryPath, $CredentialPath, $BackupPath)
    if ([IO.File]::Exists($BackupPath)) { [IO.File]::Delete($BackupPath) }
  }
  else {
    [IO.File]::Move($TemporaryPath, $CredentialPath)
  }
  [Console]::Out.WriteLine("Saved encrypted credential for: $AccountId")
}
finally {
  $PlainPassword = $null
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  if ($encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
}
