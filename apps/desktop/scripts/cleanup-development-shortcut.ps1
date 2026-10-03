param([Parameter(Mandatory = $true)][string]$ElectronExecutablePath)

$ErrorActionPreference = 'Stop'
$shortcutDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPath = Join-Path $shortcutDirectory 'Electron.lnk'
if (-not (Test-Path -LiteralPath $shortcutPath)) { exit 0 }

$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
if ([string]::IsNullOrWhiteSpace($shortcut.TargetPath) -or $shortcut.Arguments -ne '') { exit 0 }
if ([System.IO.Path]::GetFullPath($shortcut.TargetPath) -ne [System.IO.Path]::GetFullPath($ElectronExecutablePath)) { exit 0 }

$explorerShell = New-Object -ComObject Shell.Application
$shortcutItem = $explorerShell.NameSpace($shortcutDirectory).ParseName('Electron.lnk')
$applicationId = $shortcutItem.ExtendedProperty('System.AppUserModel.ID')
if ($applicationId -notin @('com.chromashift.desktop', 'com.chromashift.desktop.development')) { exit 0 }

$runningRuntime = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object {
  $_.ExecutablePath -eq $ElectronExecutablePath -and $_.CommandLine -notmatch ' --type='
}
if ($runningRuntime) { exit 0 }

Remove-Item -LiteralPath $shortcutPath
Write-Output 'Removed the ChromaShift development Electron shortcut.'
