param(
  [Parameter(Mandatory = $true)][ValidateSet('close', 'body')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][int]$AppProcessId
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Management,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NotificationSmokeWindows {
  public delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  private delegate void WinEventCallback(IntPtr hook, uint eventId, IntPtr window, int objectId, int childId, uint thread, uint time);
  [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEventCallback callback, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  private static WinEventCallback callback;
  private static IntPtr focusHook, showHook;
  private static bool activated;
  public static void Begin(int process) {
    activated = false;
    callback = (hook, eventId, window, objectId, childId, thread, time) => {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner == process && (eventId == 3 || (objectId == 0 && IsWindowVisible(window) && !IsIconic(window))))
        activated = true;
    };
    focusHook = SetWinEventHook(3, 3, IntPtr.Zero, callback, 0, 0, 0);
    showHook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, callback, (uint)process, 0, 0);
    if (focusHook == IntPtr.Zero || showHook == IntPtr.Zero) {
      End();
      throw new Exception("Could not observe ChromaShift focus/window events.");
    }
  }
  public static void End() {
    if (focusHook != IntPtr.Zero) UnhookWinEvent(focusHook);
    if (showHook != IntPtr.Zero) UnhookWinEvent(showHook);
    focusHook = showHook = IntPtr.Zero;
    callback = null;
  }
  public static void AssertNoAppWindow(int process) {
    System.Windows.Forms.Application.DoEvents();
    if (activated) throw new Exception("Close activated a ChromaShift window.");
    uint foreground;
    GetWindowThreadProcessId(GetForegroundWindow(), out foreground);
    if (foreground == process) throw new Exception("Close focused ChromaShift.");
    bool opened = false;
    EnumWindows((window, parameter) => {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner == process && IsWindowVisible(window) && !IsIconic(window))
        opened = true;
      return true;
    }, IntPtr.Zero);
    if (opened) throw new Exception("Close opened or restored a ChromaShift window.");
  }
}
'@

# Toast popup roots are not consistently exposed by UIA. Use the persistent
# Notification Center card and require the unique title before any click.
function Press-Key([byte]$key, [uint32]$flags) {
  [NotificationSmokeWindows]::keybd_event($key, 0, $flags, [UIntPtr]::Zero)
}
function Find-Card {
  $roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($root in $roots) {
    $owner = Get-Process -Id $root.Current.ProcessId -ErrorAction SilentlyContinue
    if ($owner.ProcessName -ne 'ShellExperienceHost' -or $root.Current.IsOffscreen) { continue }
    $text = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $Title))
    if ($null -eq $text) { continue }
    $node = $text
    while ($null -ne $node -and -not [System.Windows.Automation.Automation]::Compare($node, $root)) {
      $close = $node.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.AndCondition]::new(
          [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::NameProperty, 'Close'),
          [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)))
      if ($null -ne $close -and -not $close.Current.IsOffscreen) { return @{ Text = $text; Close = $close } }
      $node = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($node)
    }
  }
  return $null
}
try {
  Press-Key 0x5B 0
  Press-Key 0x4E 0
  Press-Key 0x4E 2
  Press-Key 0x5B 2
  $deadline = (Get-Date).AddSeconds(15)
  $card = $null
  while ((Get-Date) -lt $deadline) {
    $card = Find-Card
    if ($null -ne $card) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $card) { throw "Notification Center did not expose '$Title' with its Close action. Shown alone cannot prove UI visibility or interaction." }
  if ($Action -eq 'close') {
    # Start events retain short-lived COM activators that polling Get-Process
    # would miss. Close must not create any Electron process in this quiet gate.
    $source = 'ChromaShiftNotificationSmoke-' + [Guid]::NewGuid().ToString('N')
    $watcher = [System.Management.ManagementEventWatcher]::new(
      "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName = 'electron.exe' OR ProcessName = 'ChromaShift.exe'")
    Register-ObjectEvent -InputObject $watcher -EventName EventArrived -SourceIdentifier $source | Out-Null
    try {
      $watcher.Start()
      [NotificationSmokeWindows]::Begin($AppProcessId)
      [NotificationSmokeWindows]::AssertNoAppWindow($AppProcessId)
      $card.Close.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      $deadline = (Get-Date).AddSeconds(3)
      while ((Get-Date) -lt $deadline) {
        [NotificationSmokeWindows]::AssertNoAppWindow($AppProcessId)
        if ($null -ne (Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)) {
          throw 'Close launched another Electron or ChromaShift process.'
        }
        Start-Sleep -Milliseconds 100
      }
      [NotificationSmokeWindows]::AssertNoAppWindow($AppProcessId)
      if ($null -ne (Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)) {
        throw 'Close launched another Electron or ChromaShift process.'
      }
    } finally {
      [NotificationSmokeWindows]::End()
      $watcher.Stop()
      Unregister-Event -SourceIdentifier $source
      Remove-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
      $watcher.Dispose()
    }
    if ($null -ne (Find-Card)) { throw 'Close did not dismiss the notification card.' }
    [Console]::WriteLine('Close dismissed the visible card with no ChromaShift window, focus, or second process.')
  } else {
    $point = $card.Text.GetClickablePoint()
    [void][NotificationSmokeWindows]::SetCursorPos([int]$point.X, [int]$point.Y)
    [NotificationSmokeWindows]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [NotificationSmokeWindows]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [Console]::WriteLine('Clicked the notification body identified by its unique profile title.')
  }
} finally {
  Press-Key 0x1B 0
  Press-Key 0x1B 2
}
