param(
  [string]$TokenPath = "$env:LOCALAPPDATA\CommerceOS\DomeggookReceiptSync.dpapi",
  [Parameter(ValueFromPipeline = $true)]
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$PlainToken = if ($Token) { $Token } else { [Console]::In.ReadToEnd() }
if ([string]::IsNullOrWhiteSpace($PlainToken)) {
  throw "Sync token input is empty."
}
[void][Reflection.Assembly]::LoadWithPartialName("System.Security")
$plainBytes = $null
$entropy = $null
$encrypted = $null
try {
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($PlainToken.Trim())
  $entropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-domeggook-receipt-sync-v1")
  $encrypted = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($TokenPath)) | Out-Null
  $TemporaryPath = "$TokenPath.$PID.tmp"
  $lines = [string[]]@(
    "COMMERCE_OS_DOMEGGOOK_RECEIPT_SYNC_DPAPI_V1",
    [Convert]::ToBase64String($encrypted)
  )
  [IO.File]::WriteAllLines($TemporaryPath, $lines, [Text.UTF8Encoding]::new($false))
  if ([IO.File]::Exists($TokenPath)) {
    $BackupPath = "$TokenPath.$PID.bak"
    [IO.File]::Replace($TemporaryPath, $TokenPath, $BackupPath)
    if ([IO.File]::Exists($BackupPath)) { [IO.File]::Delete($BackupPath) }
  }
  else {
    [IO.File]::Move($TemporaryPath, $TokenPath)
  }
  [Console]::Out.WriteLine("Saved encrypted Domeggook receipt sync token.")
}
finally {
  $PlainToken = $null
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  if ($encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
}
