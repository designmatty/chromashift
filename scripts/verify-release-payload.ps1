param(
  [Parameter(Mandatory = $true)]
  [string] $Directory,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string] $ExpectedPublisher,

  [switch] $SignUnsigned
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
  throw "Release payload directory is missing: $Directory"
}

$portableExecutables = 0
foreach ($file in Get-ChildItem -LiteralPath $Directory -Recurse -File) {
  # Inspect every file, including native binaries with a nonstandard extension.
  $stream = [System.IO.File]::OpenRead($file.FullName)
  try {
    $isPortableExecutable = $stream.ReadByte() -eq 0x4D -and $stream.ReadByte() -eq 0x5A
  } finally {
    $stream.Dispose()
  }
  if (-not $isPortableExecutable) { continue }
  $portableExecutables++
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -eq 'NotSigned' -and $SignUnsigned) {
    & "$PSScriptRoot/sign-release-executable.ps1" -Path $file.FullName
    & "$PSScriptRoot/verify-authenticode.ps1" -Paths @($file.FullName) -ExpectedPublisher $ExpectedPublisher
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  }
  # Preserve existing valid vendor signatures. Never replace a corrupt signature.
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
      $null -eq $signature.TimeStamperCertificate) {
    throw "Release payload signature or timestamp is invalid: $($file.FullName) ($($signature.Status))"
  }
}
if ($portableExecutables -eq 0) { throw 'No Portable Executable files found in the release payload.' }
Write-Output "Release payload verification passed for $portableExecutables Portable Executable file(s)."
