param([Parameter(Mandatory = $true)][string]$CapturePath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChromaShiftTrayCapture {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@

# A whole-desktop UI Automation walk can take close to a minute on a busy desktop,
# far beyond the smoke timeout. Search only the shell's taskbar and overflow
# windows, and top-level menus, which are direct children of the root.
$shellClasses = @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'TopLevelWindowForOverflowXamlIsland',
  'NotifyIconOverflowWindow')

function Get-ShellRoots {
  return [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object { $shellClasses -contains $_.Current.ClassName }
}

function Find-NamedElement([string]$ElementName) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty, $ElementName)
  foreach ($root in Get-ShellRoots) {
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $found) { return $found }
  }
  return $null
}

function Find-TrayIcon {
  $elements = foreach ($root in Get-ShellRoots) {
    $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
  }
  return $elements | Where-Object {
    $_.Current.ClassName -eq 'SystemTray.NormalButton' -and $_.Current.Name.Trim() -like 'ChromaShift:*' -and
    -not $_.Current.IsOffscreen -and $_.Current.BoundingRectangle.Width -gt 0
  } | Select-Object -First 1
}

$openedOverflow = $false
try {
  $icon = Find-TrayIcon
  if ($null -eq $icon) {
    $overflow = Find-NamedElement 'Show Hidden Icons'
    if ($null -eq $overflow) { throw 'The tray overflow button was unavailable.' }
    $overflow.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $openedOverflow = $true
    Start-Sleep -Milliseconds 300
    $icon = Find-TrayIcon
  }
  if ($null -eq $icon) {
    $elements = foreach ($root in Get-ShellRoots) {
      $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    }
    $elements | Where-Object { $_.Current.ClassName -match 'Tray|Notify|Overflow' } |
      ForEach-Object { Write-Output ($_.Current.Name + ' [' + $_.Current.ClassName + ']') }
    throw 'The emergency restore tray icon did not say ChromaShift: Paused.'
  }
  $iconBounds = $icon.Current.BoundingRectangle
  [void][ChromaShiftTrayCapture]::SetCursorPos(
    [int]($iconBounds.X + $iconBounds.Width / 2), [int]($iconBounds.Y + $iconBounds.Height / 2))
  [ChromaShiftTrayCapture]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero)
  [ChromaShiftTrayCapture]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300
  $resumeCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty, 'Resume ChromaShift'),
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::MenuItem))
  # The native popup menu is a small top-level window. Searching only small
  # top-level windows keeps the lookup away from the app's own Resume button and
  # from slow, large app windows.
  $resume = $null
  $popups = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object {
      $rect = $_.Current.BoundingRectangle
      $rect.Width -gt 0 -and $rect.Width -lt 800 -and $rect.Height -gt 0 -and $rect.Height -lt 1000
    }
  foreach ($popup in $popups) {
    $resume = $popup.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $resumeCondition)
    if ($null -ne $resume) { break }
  }
  if ($null -eq $resume) { throw 'The emergency restore tray menu did not offer Resume ChromaShift.' }
  $menu = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($resume)
  $status = $menu.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty, 'ChromaShift: Paused'))
  if ($null -eq $status) { throw 'The emergency restore tray menu did not show ChromaShift: Paused.' }
  $bounds = $menu.Current.BoundingRectangle
  $bitmap = [System.Drawing.Bitmap]::new([int]$bounds.Width + 20, [int]$bounds.Height + 20)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$bounds.X - 10, [int]$bounds.Y - 10, 0, 0, $bitmap.Size)
    $bitmap.Save($CapturePath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
} catch {
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = [System.Drawing.Bitmap]::new($screen.Width, $screen.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size)
    $bitmap.Save($CapturePath + '.failure.png', [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  throw
} finally {
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  if ($openedOverflow) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}') }
}
