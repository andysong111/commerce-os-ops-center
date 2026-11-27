param(
  [Parameter(Mandatory)] [string]$ConfigPath,
  [Parameter(Mandatory)] [string]$NodePath
)
$ErrorActionPreference = "Stop"
$settings = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$secureToken = ConvertTo-SecureString -String $settings.encryptedToken
$tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $connection = @{
    endpoint = $settings.endpoint
    agentToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
    allowBusiness = $settings.allowBusiness -eq $true
  } | ConvertTo-Json -Compress
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
  $secureToken.Dispose()
}
try {
  $connection | & $NodePath (Join-Path $PSScriptRoot 'start.mjs') --stdin
  exit $LASTEXITCODE
} finally {
  $connection = $null
}
