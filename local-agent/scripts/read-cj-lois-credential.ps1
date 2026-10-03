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

$plainPassword = $null
if ($payload.protection -eq "WINDOWS_CURRENT_USER_DPAPI") {
  $securePassword = ConvertTo-SecureString -String $payload.encryptedPassword
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}
elseif ($payload.protection -eq "WINDOWS_LOCAL_MACHINE_DPAPI_V1") {
  $encrypted = [Convert]::FromBase64String([string]$payload.encryptedPassword)
  $entropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-cj-lois-v1")
  $plainBytes = $null
  try {
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $encrypted,
      $entropy,
      [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    $plainPassword = [Text.Encoding]::UTF8.GetString($plainBytes)
  }
  finally {
    [Array]::Clear($encrypted, 0, $encrypted.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  }
}
else {
  throw "CJ credential protection mode is invalid."
}

try {
  [ordered]@{
    username = [string]$payload.username
    password = $plainPassword
  } | ConvertTo-Json -Compress
}
finally {
  $plainPassword = $null
}
