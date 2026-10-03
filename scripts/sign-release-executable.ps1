param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string] $Path
)

$ErrorActionPreference = 'Stop'

foreach ($name in @(
  'AZURE_ARTIFACT_SIGNING_ENDPOINT',
  'AZURE_ARTIFACT_SIGNING_ACCOUNT',
  'AZURE_ARTIFACT_SIGNING_PROFILE',
  'AZURE_ARTIFACT_SIGNING_PUBLISHER'
)) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Release signing requires $name."
  }
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "Expected executable is missing: $Path"
}

Import-Module ArtifactSigning -ErrorAction Stop
$parameters = @{
  Endpoint = $env:AZURE_ARTIFACT_SIGNING_ENDPOINT
  CodeSigningAccountName = $env:AZURE_ARTIFACT_SIGNING_ACCOUNT
  CertificateProfileName = $env:AZURE_ARTIFACT_SIGNING_PROFILE
  Files = $Path
  Description = 'ChromaShift'
  FileDigest = 'SHA256'
  TimestampRfc3161 = 'http://timestamp.acs.microsoft.com'
  TimestampDigest = 'SHA256'
  # azure/login has already exchanged the GitHub OIDC token. Use only that
  # Azure CLI session; never fall back to a local account or interactive login.
  ExcludeEnvironmentCredential = $true
  ExcludeWorkloadIdentityCredential = $true
  ExcludeManagedIdentityCredential = $true
  ExcludeSharedTokenCacheCredential = $true
  ExcludeVisualStudioCredential = $true
  ExcludeVisualStudioCodeCredential = $true
  ExcludeAzureCliCredential = $false
  ExcludeAzurePowerShellCredential = $true
  ExcludeAzureDeveloperCliCredential = $true
  ExcludeInteractiveBrowserCredential = $true
}
Invoke-ArtifactSigning @parameters

# Fail before embedding if signing, timestamping, or publisher validation fails.
& "$PSScriptRoot/verify-authenticode.ps1" -Paths @($Path) `
  -ExpectedPublisher $env:AZURE_ARTIFACT_SIGNING_PUBLISHER
