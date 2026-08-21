using System.ComponentModel;
using System.Runtime.InteropServices;
using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Ipc;
using System.Text.Json.Nodes;

namespace ChromaShift.DisplayService.Services;

internal sealed class ForegroundWindowWatcher : IDisposable
{
    private const uint EventSystemForeground = 0x0003;
    private const uint WineventOutOfContext = 0x0000;
    private const uint WineventSkipOwnProcess = 0x0002;
    private const uint WindowMessageQuit = 0x0012;

    private readonly TaskCompletionSource _started = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly WinEventDelegate _callback = HandleWinEvent;
    private readonly ForegroundWindowChangeResolver _changes;
    private readonly Func<ForegroundApplication, Task> _onChanged;
    private Thread? _thread;
    private uint _threadId;
    private IntPtr _hook;
    private bool _disposed;

    internal ForegroundWindowWatcher(
        ForegroundApplicationService applications,
        Func<ForegroundApplication, Task> onChanged)
    {
        _changes = new ForegroundWindowChangeResolver(GetForegroundWindow, applications.Resolve);
        _onChanged = onChanged;
    }

    internal async Task StartAsync()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_thread is not null)
        {
            await _started.Task;
            return;
        }

        _thread = new Thread(RunMessageLoop)
        {
            IsBackground = true,
            Name = "ForegroundWindowWatcher"
        };
        _thread.Start();
        await _started.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_threadId != 0)
        {
            _ = PostThreadMessage(_threadId, WindowMessageQuit, UIntPtr.Zero, IntPtr.Zero);
        }
        _thread?.Join(TimeSpan.FromSeconds(5));
    }

    private void RunMessageLoop()
    {
        Current = this;
        _threadId = GetCurrentThreadId();
        var callbackHandle = GCHandle.Alloc(_callback);
        try
        {
            _hook = SetWinEventHook(
                EventSystemForeground,
                EventSystemForeground,
                IntPtr.Zero,
                _callback,
                0,
                0,
                WineventOutOfContext | WineventSkipOwnProcess);
            if (_hook == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWinEventHook failed.");
            }

            _started.TrySetResult();
            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                _ = TranslateMessage(ref message);
                _ = DispatchMessage(ref message);
            }
        }
        catch (Exception exception)
        {
            _started.TrySetException(exception);
            NativeLog.Write(new JsonObject
            {
                ["level"] = "error",
                ["eventName"] = "ProviderError",
                ["provider"] = "windows.foreground",
                ["message"] = exception.Message
            });
        }
        finally
        {
            if (_hook != IntPtr.Zero)
            {
                _ = UnhookWinEvent(_hook);
                _hook = IntPtr.Zero;
            }
            callbackHandle.Free();
            Current = null;
        }
    }

    private static void HandleWinEvent(
        IntPtr hook,
        uint eventType,
        IntPtr window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime)
    {
        _ = hook;
        _ = eventType;
        _ = objectId;
        _ = childId;
        _ = eventThread;
        _ = eventTime;

        var watcher = Current;
        if (watcher is null || window == IntPtr.Zero)
        {
            return;
        }

        var application = watcher._changes.ResolveForEvent(window);
        if (application is null)
        {
            return;
        }

        try
        {
            watcher._onChanged(application).GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            NativeLog.Write(new JsonObject
            {
                ["level"] = "error",
                ["eventName"] = "ProviderError",
                ["provider"] = "windows.foreground",
                ["message"] = exception.Message
            });
        }
    }

    [ThreadStatic]
    private static ForegroundWindowWatcher? Current;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void WinEventDelegate(
        IntPtr hook,
        uint eventType,
        IntPtr window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(
        uint eventMinimum,
        uint eventMaximum,
        IntPtr eventHookModule,
        WinEventDelegate eventHook,
        uint processId,
        uint threadId,
        uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr eventHook);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wordParameter, IntPtr longParameter);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, IntPtr window, uint minimumMessage, uint maximumMessage);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Message message);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        internal IntPtr Window;
        internal uint Value;
        internal UIntPtr WordParameter;
        internal IntPtr LongParameter;
        internal uint Time;
        internal Point Point;
        internal uint Private;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        internal int X;
        internal int Y;
    }
}
