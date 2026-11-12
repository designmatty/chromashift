$ErrorActionPreference = 'Stop'
# This is the unpackaged identity passed to app.setAppUserModelId, never the
# installed identity or the global notification switch.
$subkey = 'Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.chromashift.desktop.development'
$mutex = [System.Threading.Mutex]::new($false, 'Local\ChromaShiftDevelopmentNotificationSmoke')
$locked = $false
$key = $null
$captured = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Another development notification smoke owns the setting.' }
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey, $true)
  $keyExisted = $null -ne $key
  if (-not $keyExisted) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subkey) }
  $valueExisted = $key.GetValueNames() -contains 'Enabled'
  if ($valueExisted) {
    $value = $key.GetValue('Enabled', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = $key.GetValueKind('Enabled')
  }
  $captured = $true
  $key.SetValue('Enabled', 0, [Microsoft.Win32.RegistryValueKind]::DWord)
  [Console]::WriteLine('suppressed')
  while ($null -ne ($command = [Console]::ReadLine())) {
    switch ($command) {
      'enable' { $key.SetValue('Enabled', 1, [Microsoft.Win32.RegistryValueKind]::DWord); [Console]::WriteLine('enabled') }
      'suppress' { $key.SetValue('Enabled', 0, [Microsoft.Win32.RegistryValueKind]::DWord); [Console]::WriteLine('suppressed') }
      default { throw "Unknown notification guard command: $command" }
    }
  }
} finally {
  try {
    if ($captured) {
      if ($valueExisted) { $key.SetValue('Enabled', $value, $kind) }
      else { $key.DeleteValue('Enabled', $false) }
      # Remove only an empty key created by this run. Windows may have added
      # other app-specific values while Electron registered its toast identity.
      $removeEmptyKey = -not $keyExisted -and $key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0
      $key.Dispose()
      $key = $null
      if ($removeEmptyKey) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($subkey, $false) }
    }
  } finally {
    if ($null -ne $key) { $key.Dispose() }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}
