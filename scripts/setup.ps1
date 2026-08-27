$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  if (Get-Command mise -ErrorAction SilentlyContinue) {
    mise install
    if ($LASTEXITCODE -ne 0) { throw "mise install failed with exit code $LASTEXITCODE." }

    mise --% exec -- npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }

    mise --% exec -- npm run native:build
    if ($LASTEXITCODE -ne 0) { throw "npm run native:build failed with exit code $LASTEXITCODE." }
  }
  else {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }

    npm run native:build
    if ($LASTEXITCODE -ne 0) { throw "npm run native:build failed with exit code $LASTEXITCODE." }
  }
  Write-Host 'ChromaShift setup complete. Run npm run dev to start the desktop app.'
}
finally {
  Pop-Location
}
