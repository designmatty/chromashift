$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  if (Get-Command mise -ErrorAction SilentlyContinue) {
    mise install
    mise exec -- npm ci
    mise exec -- npm run native:build
  }
  else {
    npm ci
    npm run native:build
  }
  Write-Host 'ChromaShift setup complete. Run npm run dev to start the desktop app.'
}
finally {
  Pop-Location
}
