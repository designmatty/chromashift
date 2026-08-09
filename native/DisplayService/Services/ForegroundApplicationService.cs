using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using ChromaShift.DisplayService.Core;

namespace ChromaShift.DisplayService.Services;

internal sealed class ForegroundApplicationService
{
    private const uint GetWindowOwner = 4;
    private const int ExtendedWindowStyle = -20;
    private const long ToolWindowStyle = 0x00000080L;
    private const uint DwmWindowAttributeCloaked = 14;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint MonitorDefaultToNearest = 0x00000002;
    private const int MaxPathCharacters = 32_768;

    internal ForegroundApplication? GetCurrent()
    {
        var window = GetForegroundWindow();
        return window == IntPtr.Zero ? null : Resolve(window);
    }

    internal IReadOnlyList<ForegroundApplication> ListVisible()
    {
        var applications = new List<ForegroundApplication>();
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var shellWindow = GetShellWindow();
        _ = EnumWindows((window, _) =>
        {
            if (window == shellWindow || !IsWindowVisible(window) ||
                GetWindow(window, GetWindowOwner) != IntPtr.Zero || IsToolWindow(window) ||
                IsCloaked(window))
            {
                return true;
            }

            var application = Resolve(window);
            if (application?.Path is null || string.IsNullOrWhiteSpace(application.Title) ||
                application.Pid == Environment.ProcessId || !paths.Add(application.Path))
            {
                return true;
            }

            applications.Add(application);
            return true;
        }, IntPtr.Zero);
        return applications;
    }

    private static bool IsToolWindow(IntPtr window) =>
        (GetWindowLongPtr(window, ExtendedWindowStyle).ToInt64() & ToolWindowStyle) != 0;

    private static bool IsCloaked(IntPtr window)
    {
        var cloaked = 0;
        return DwmGetWindowAttribute(
            window,
            DwmWindowAttributeCloaked,
            out cloaked,
            Marshal.SizeOf<int>()) == 0 && cloaked != 0;
    }

    internal ForegroundApplication? Resolve(IntPtr window)
    {
        if (window == IntPtr.Zero)
        {
            return null;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == 0)
        {
            return null;
        }

        var path = GetProcessPath(processId);
        var executable = path is null ? GetProcessName(processId) : System.IO.Path.GetFileName(path);

        return new ForegroundApplication(
            processId,
            executable,
            path,
            GetWindowTitle(window),
            GetMonitorDeviceName(window));
    }

    private static string? GetProcessPath(uint processId)
    {
        var process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var capacity = MaxPathCharacters;
            var path = new StringBuilder(capacity);
            return QueryFullProcessImageName(process, 0, path, ref capacity)
                ? path.ToString()
                : null;
        }
        finally
        {
            _ = CloseHandle(process);
        }
    }

    private static string? GetProcessName(uint processId)
    {
        try
        {
            using var process = System.Diagnostics.Process.GetProcessById(checked((int)processId));
            return $"{process.ProcessName}.exe";
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException or Win32Exception or OverflowException)
        {
            return null;
        }
    }

    private static string GetWindowTitle(IntPtr window)
    {
        var length = GetWindowTextLength(window);
        if (length <= 0)
        {
            return string.Empty;
        }

        var title = new StringBuilder(length + 1);
        _ = GetWindowText(window, title, title.Capacity);
        return title.ToString();
    }

    private static string? GetMonitorDeviceName(IntPtr window)
    {
        var monitor = MonitorFromWindow(window, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero)
        {
            return null;
        }

        var info = new MonitorInfoEx
        {
            Size = Marshal.SizeOf<MonitorInfoEx>(),
            DeviceName = string.Empty
        };
        return GetMonitorInfo(monitor, ref info) ? info.DeviceName : null;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        uint attribute,
        out int value,
        int valueSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", EntryPoint = "GetWindowTextLengthW", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll", EntryPoint = "GetWindowTextW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfoEx info);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(
        IntPtr process,
        uint flags,
        StringBuilder executableName,
        ref int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rectangle
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        internal int Size;
        internal Rectangle Monitor;
        internal Rectangle WorkArea;
        internal uint Flags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        internal string DeviceName;
    }
}
