param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [string]$Username = $env:COMMERCE_OS_CJ_LOIS_USERNAME
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

function Convert-SecureStringToPlainText {
  param([Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Protect-LocalMachinePassword {
  param([Security.SecureString]$SecureValue)
  $plain = Convert-SecureStringToPlainText $SecureValue
  $plainBytes = $null
  $entropy = $null
  $encrypted = $null
  try {
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
    $entropy = [Text.Encoding]::UTF8.GetBytes("commerce-os-cj-lois-v1")
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $entropy,
      [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Convert]::ToBase64String($encrypted)
  }
  finally {
    $plain = $null
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
    if ($encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
  }
}

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "CJ credential setup requires Windows DPAPI."
}

if ([string]::IsNullOrWhiteSpace($Username)) {
  $Username = Read-Host "CJ LOIS username"
}
$password = Read-Host "CJ LOIS password" -AsSecureString
$confirmation = Read-Host "CJ LOIS password again" -AsSecureString
$plainPassword = Convert-SecureStringToPlainText $password
$plainConfirmation = Convert-SecureStringToPlainText $confirmation
try {
  if ([string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrEmpty($plainPassword)) {
    throw "CJ username and password are required."
  }
  if ($plainPassword -cne $plainConfirmation) {
    throw "The two password entries do not match."
  }
}
finally {
  $plainPassword = $null
  $plainConfirmation = $null
}

$directory = Split-Path -Parent $Path
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$payload = [ordered]@{
  schemaVersion = 1
  username = $Username.Trim()
  encryptedPassword = Protect-LocalMachinePassword $password
  protection = "WINDOWS_LOCAL_MACHINE_DPAPI_V1"
  updatedAt = [DateTime]::UtcNow.ToString("o")
}
$json = $payload | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
Write-Host "CJ credential saved with Windows LocalMachine DPAPI."
