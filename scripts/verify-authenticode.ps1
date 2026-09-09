param(
  [string[]] $Paths,

  [string] $PathsJson,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string] $ExpectedPublisher
)

$resolvedPaths = $Paths
if (-not [string]::IsNullOrWhiteSpace($PathsJson)) {
  $resolvedPaths = [string[]](ConvertFrom-Json -InputObject $PathsJson)
}
if ($resolvedPaths.Count -eq 0) {
  throw 'At least one Authenticode path is required.'
}

foreach ($path in $resolvedPaths) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Expected signed file is missing: $path"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne 'Valid') {
    throw "Invalid Authenticode signature for ${path}: $($signature.Status)"
  }
  if ($null -eq $signature.SignerCertificate) {
    throw "Authenticode signer certificate is missing for $path"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Authenticode timestamp is missing for $path"
  }

  $actualPublisher = $signature.SignerCertificate.Subject
  if ($actualPublisher -cne $ExpectedPublisher) {
    throw "Wrong Authenticode publisher for ${path}: expected '$ExpectedPublisher', received '$actualPublisher'"
  }
}

Write-Output "Authenticode verification passed for $($resolvedPaths.Count) file(s): publisher=$ExpectedPublisher"
