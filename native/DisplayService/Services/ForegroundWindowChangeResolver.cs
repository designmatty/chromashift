using ChromaShift.DisplayService.Core;

namespace ChromaShift.DisplayService.Services;

internal sealed class ForegroundWindowChangeResolver(
    Func<IntPtr> getForegroundWindow,
    Func<IntPtr, ForegroundApplication?> resolveApplication)
{
    internal ForegroundApplication? ResolveForEvent(IntPtr eventWindow)
    {
        _ = eventWindow;
        // Out-of-context WinEvents may be delivered after focus has moved. Resolve
        // the current foreground HWND and leave successful-target deduplication to
        // Electron, where failed transitions can be retried safely.
        var currentWindow = getForegroundWindow();
        if (currentWindow == IntPtr.Zero)
        {
            return null;
        }

        return resolveApplication(currentWindow);
    }
}
