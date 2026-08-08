using System.ComponentModel;
using System.Runtime.InteropServices;
using ChromaShift.DisplayService.Core;

namespace ChromaShift.DisplayService.Providers.Windows;

internal sealed class WindowsGammaProvider
{
    private const int ColorManagementCapabilities = 121;
    private const int ColorManagementGammaRamp = 0x00000002;

    internal bool IsSupported(string windowsDisplayName)
    {
        try
        {
            using var context = CreateContext(windowsDisplayName);
            if ((GetDeviceCaps(context.Handle, ColorManagementCapabilities) & ColorManagementGammaRamp) != 0)
            {
                return true;
            }

            var values = new ushort[GammaRamp.ChannelLength * 3];
            var pinned = GCHandle.Alloc(values, GCHandleType.Pinned);
            try
            {
                return GetDeviceGammaRamp(context.Handle, pinned.AddrOfPinnedObject());
            }
            finally
            {
                pinned.Free();
            }
        }
        catch (Win32Exception)
        {
            return false;
        }
    }

    internal GammaRamp Read(string windowsDisplayName)
    {
        using var context = CreateContext(windowsDisplayName);
        var values = new ushort[GammaRamp.ChannelLength * 3];
        var pinned = GCHandle.Alloc(values, GCHandleType.Pinned);
        try
        {
            if (!GetDeviceGammaRamp(context.Handle, pinned.AddrOfPinnedObject()))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), $"GetDeviceGammaRamp failed for {windowsDisplayName}.");
            }
        }
        finally
        {
            pinned.Free();
        }
        return GammaRamp.FromInterleavedBuffer(values);
    }

    internal void Write(string windowsDisplayName, GammaRamp ramp)
    {
        using var context = CreateContext(windowsDisplayName);
        var values = ramp.ToInterleavedBuffer();
        var pinned = GCHandle.Alloc(values, GCHandleType.Pinned);
        try
        {
            if (!SetDeviceGammaRamp(context.Handle, pinned.AddrOfPinnedObject()))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), $"SetDeviceGammaRamp failed for {windowsDisplayName}.");
            }
        }
        finally
        {
            pinned.Free();
        }
    }

    private static DeviceContext CreateContext(string windowsDisplayName)
    {
        var handle = CreateDC("DISPLAY", windowsDisplayName, null, IntPtr.Zero);
        return handle == IntPtr.Zero
            ? throw new Win32Exception(Marshal.GetLastWin32Error(), $"CreateDC failed for {windowsDisplayName}.")
            : new DeviceContext(handle);
    }

    private sealed class DeviceContext(IntPtr handle) : IDisposable
    {
        internal IntPtr Handle { get; } = handle;
        public void Dispose() => _ = DeleteDC(Handle);
    }

    [DllImport("gdi32.dll", EntryPoint = "CreateDCW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDC(string driver, string device, string? port, IntPtr deviceMode);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteDC(IntPtr deviceContext);

    [DllImport("gdi32.dll")]
    private static extern int GetDeviceCaps(IntPtr deviceContext, int index);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetDeviceGammaRamp(IntPtr deviceContext, IntPtr ramp);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetDeviceGammaRamp(IntPtr deviceContext, IntPtr ramp);
}
