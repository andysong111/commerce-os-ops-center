param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$payload = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.schemaVersion -ne 1) {
  throw "CJ credential file format is invalid."
}
if ($payload.protection -eq "WINDOWS_LOCAL_MACHINE_DPAPI_V1") {
  Write-Host "CJ credential already uses Windows LocalMachine DPAPI."
  exit 0
}
if ($payload.protection -ne "WINDOWS_CURRENT_USER_DPAPI") {
  throw "CJ credential protection mode is not supported for migration."
}

$securePassword = ConvertTo-SecureString -String $payload.encryptedPassword
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null
$plainBytes = $null
$entropy = $null
$encrypted = $null
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($plainPassword)
  $entropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-cj-lois-v1")
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $entropy,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $payload.encryptedPassword = [Convert]::ToBase64String($encrypted)
  $payload.protection = "WINDOWS_LOCAL_MACHINE_DPAPI_V1"
  $payload.updatedAt = [DateTime]::UtcNow.ToString("o")
  $json = $payload | ConvertTo-Json -Depth 3
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}
finally {
  $plainPassword = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  if ($encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
}

Write-Host "CJ credential migrated to Windows LocalMachine DPAPI."
