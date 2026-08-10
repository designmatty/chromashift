param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('foreground', 'focus', 'style', 'rect', 'click', 'key')]
  [string]$Mode,
  [long]$Handle = 0,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$VirtualKey = 0
)

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class QuickPanelWin32
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    public static extern IntPtr GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    public static long GetExtendedStyle(IntPtr hWnd)
    {
        const int GWL_EXSTYLE = -20;
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE).ToInt64()
            : GetWindowLong32(hWnd, GWL_EXSTYLE).ToInt64();
    }
}
'@

[void][QuickPanelWin32]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$windowHandle = [IntPtr]::new($Handle)
switch ($Mode) {
  'foreground' {
    [QuickPanelWin32]::GetForegroundWindow().ToInt64()
  }
  'focus' {
    [void][QuickPanelWin32]::ShowWindow($windowHandle, 9)
    [QuickPanelWin32]::SetForegroundWindow($windowHandle)
  }
  'style' {
    [QuickPanelWin32]::GetExtendedStyle($windowHandle)
  }
  'rect' {
    $rect = New-Object QuickPanelWin32+Rect
    if (-not [QuickPanelWin32]::GetWindowRect($windowHandle, [ref]$rect)) {
      throw "GetWindowRect failed for $Handle."
    }
    @{
      left = $rect.Left
      top = $rect.Top
      right = $rect.Right
      bottom = $rect.Bottom
    } | ConvertTo-Json -Compress
  }
  'click' {
    if (-not [QuickPanelWin32]::SetCursorPos($X, $Y)) {
      throw "SetCursorPos failed for ($X, $Y)."
    }
    [QuickPanelWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 35
    [QuickPanelWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  }
  'key' {
    if ($VirtualKey -lt 1 -or $VirtualKey -gt 255) {
      throw 'VirtualKey must be between 1 and 255.'
    }
    [QuickPanelWin32]::keybd_event([byte]$VirtualKey, 0, 0, [UIntPtr]::Zero)
    [QuickPanelWin32]::keybd_event([byte]$VirtualKey, 0, 0x0002, [UIntPtr]::Zero)
  }
}
