param([Parameter(Mandatory = $true)][string]$CapturePath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms
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

# Windows shows toasts in ShellExperienceHost windows above the taskbar. A toast that
# appears while the tray is clicked takes the click (and its own context menu) or
# closes the tray menu. ChromaShift's own Original settings restored toast arrives
# right before this capture, so wait for visible toasts to leave first.
function Wait-NoToast([int]$Seconds = 15) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $toasts = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
      Where-Object {
        $owner = Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue
        $rect = $_.Current.BoundingRectangle
        $owner.ProcessName -eq 'ShellExperienceHost' -and -not $_.Current.IsOffscreen -and
          $rect.Width -gt 0 -and $rect.Height -gt 0 -and $_.Current.Name -match 'notification'
      }
    if ($null -eq $toasts) { return }
    Start-Sleep -Milliseconds 500
  }
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
  # Prefer UI Automation's own clickable point for the icon; the rectangle centre
  # missed the icon by about 10 px on the owner's taskbar.
  $clickable = [System.Windows.Point]::new(0, 0)
  if ($icon.TryGetClickablePoint([ref]$clickable)) {
    $iconPoint = [System.Windows.Point]::new([int]$clickable.X, [int]$clickable.Y)
  } else {
    $iconPoint = [System.Windows.Point]::new(
      [int]($iconBounds.X + $iconBounds.Width / 2), [int]($iconBounds.Y + $iconBounds.Height / 2))
  }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $rootElement = [System.Windows.Automation.AutomationElement]::RootElement
  # The click is only safe when the element under the point is the ChromaShift icon
  # itself (or inside it). A taskbar-owned point next to the icon, or a toast above
  # it, would open some other menu.
  function Get-IconHit {
    $hit = [System.Windows.Automation.AutomationElement]::FromPoint($iconPoint)
    $node = $hit
    $topLevel = $null
    while ($null -ne $node -and $node -ne $rootElement) {
      if ([System.Windows.Automation.Automation]::Compare($node, $icon)) { return $null }
      $topLevel = $node
      $node = $walker.GetParent($node)
    }
    # In the overflow flyout's XAML island, FromPoint returns the flyout window rather
    # than the icon. The point is inside the icon's bounds, so a shell-owned window
    # there is the icon; any other window (a toast, another app) is a blocker.
    if ($null -ne $topLevel -and $shellClasses -contains $topLevel.Current.ClassName -and
      $iconBounds.Contains($iconPoint)) { return $null }
    return $hit
  }
  function Describe([System.Windows.Automation.AutomationElement]$element) {
    if ($null -eq $element) { return 'nothing' }
    return "'$($element.Current.Name)' [$($element.Current.ClassName)]"
  }
  Write-Output ("Tray icon bounds ({0},{1},{2}x{3}); click point ({4},{5})." -f
    $iconBounds.X, $iconBounds.Y, $iconBounds.Width, $iconBounds.Height, $iconPoint.X, $iconPoint.Y)
  Wait-NoToast
  $unobstructedDeadline = (Get-Date).AddSeconds(10)
  while ($true) {
    $blocker = Get-IconHit
    if ($null -eq $blocker) { break }
    if ((Get-Date) -ge $unobstructedDeadline) {
      throw "The ChromaShift tray icon was not under the click point ($($iconPoint.X),$($iconPoint.Y)); found $(Describe $blocker)."
    }
    Start-Sleep -Milliseconds 500
  }
  $resume = $null
  for ($attempt = 1; $attempt -le 3 -and $null -eq $resume; $attempt++) {
    if ($attempt -gt 1) {
      # A toast or focus change closed the menu; dismiss whatever opened and retry.
      [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
      Start-Sleep -Milliseconds 500
      Wait-NoToast
    }
    # Re-check right before clicking: a toast can appear between the wait and the click.
    $blocker = Get-IconHit
    if ($null -ne $blocker) {
      Write-Output "Attempt ${attempt}: the click point is covered by $(Describe $blocker); waiting."
      Start-Sleep -Milliseconds 1000
      continue
    }
    [void][ChromaShiftTrayCapture]::SetCursorPos([int]$iconPoint.X, [int]$iconPoint.Y)
    [ChromaShiftTrayCapture]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero)
    [ChromaShiftTrayCapture]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 300
    $resumeCondition = [System.Windows.Automation.AndCondition]::new(
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Resume ChromaShift'),
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::MenuItem))
    # The native popup menu is a small top-level window: a Win32 menu (#32768) owned
    # by Electron. Search only those windows. Other apps' small windows can take
    # many seconds to walk; Steam's Friends List took about 16 s. Requiring a small
    # window also keeps the lookup away from the app's own Resume button.
    $resume = $null
    $popups = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
      Where-Object {
        $rect = $_.Current.BoundingRectangle
        $owner = Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue
        $rect.Width -gt 0 -and $rect.Width -lt 800 -and $rect.Height -gt 0 -and $rect.Height -lt 1000 -and
          ($_.Current.ClassName -eq '#32768' -or $owner.ProcessName -in @('electron', 'ChromaShift'))
      }
    foreach ($popup in $popups) {
      $resume = $popup.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $resumeCondition)
      if ($null -ne $resume) { break }
    }

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
