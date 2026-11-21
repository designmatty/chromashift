using System.Runtime.InteropServices;
using ChromaShift.DisplayService.Core;

namespace ChromaShift.DisplayService.Providers.Amd;

internal interface IAmdColorProvider
{
    AmdDisplayState GetState(DisplayDescriptor display);
    int SetBrightness(DisplayDescriptor display, double value);
    int SetContrast(DisplayDescriptor display, double value);
    int SetSaturation(DisplayDescriptor display, double value);
    int SetHue(DisplayDescriptor display, double value);
    int SetColorTemperature(DisplayDescriptor display, double value);
    void Restore(DisplayDescriptor display, AmdDisplayState baseline);
}

internal sealed class AmdAdlxProvider : IAmdColorProvider, IDisposable
{
    private const ulong AdlxSdkVersion = (1UL << 48) | (5UL << 32) | 124UL;
    private const string LibraryName = "amdadlx64.dll";
    private readonly Lock _sync = new();
    private IntPtr _library;
    private IntPtr _system;
    private IntPtr _displayServices;
    private AdlxTerminate? _terminate;
    private string? _version;
    private ulong? _fullVersion;
    private string? _initializationError;
    private bool _initialized;

    internal AmdAdlxProvider()
    {
        try
        {
            _library = NativeLibrary.Load(LibraryName);
            _version = QueryVersion();
            _fullVersion = QueryFullVersion();
            var initialize = GetExport<AdlxInitialize>("ADLXInitialize");
            _terminate = GetExport<AdlxTerminate>("ADLXTerminate");
            Check(initialize(AdlxSdkVersion, out _system), "ADLXInitialize");
            Check(GetMethod<GetInterface>(_system, 3)(_system, out _displayServices), "IADLXSystem.GetDisplaysServices");
            _initialized = true;
        }
        catch (Exception exception)
        {
            _initializationError = exception.Message;
            DisposeNative();
        }
    }

    internal AmdAdlxDiagnostics GetDiagnostics()
    {
        lock (_sync)
        {
            var count = _initialized ? GetDisplayCount() : 0;
            return new AmdAdlxDiagnostics(
                _library != IntPtr.Zero,
                _initialized,
                _version,
                _fullVersion,
                count,
                count > 0 ? "AMD display interfaces discovered; write behavior requires an AMD-attached test display." : "ADLX initialized, but no AMD-attached display is active; control writes are unverified.",
                _initializationError);
        }
    }

    public AmdDisplayState GetState(DisplayDescriptor display)
    {
        if (display.Adapter.Vendor != "amd")
        {
            return UnsupportedState("Display is not connected to an AMD adapter.");
        }
        if (!_initialized)
        {
            return UnsupportedState(_initializationError ?? "ADLX initialization failed.");
        }

        lock (_sync)
        {
            try
            {
                return WithDisplay(display, customColor => new AmdDisplayState(
                    ReadControl(customColor, 11, 12, 13, "brightness"),
                    ReadControl(customColor, 15, 16, 17, "contrast"),
                    ReadControl(customColor, 7, 8, 9, "saturation"),
                    ReadControl(customColor, 3, 4, 5, "hue"),
                    ReadControl(customColor, 19, 20, 21, "color temperature")));
            }
            catch (Exception exception)
            {
                return UnsupportedState(exception.Message);
            }
        }
    }

    public int SetBrightness(DisplayDescriptor display, double value) =>
        SetControl(display, value, 11, 12, 13, 14, "brightness", Centered(AmdControlMapping.NeutralBrightness));
    public int SetContrast(DisplayDescriptor display, double value) =>
        SetControl(display, value, 15, 16, 17, 18, "contrast", Centered(AmdControlMapping.NeutralContrast));
    public int SetSaturation(DisplayDescriptor display, double value) =>
        SetControl(display, value, 7, 8, 9, 10, "saturation", Centered(AmdControlMapping.NeutralSaturation));
    public int SetHue(DisplayDescriptor display, double value) =>
        SetControl(display, value, 3, 4, 5, 6, "hue",
            (normalized, range) => AmdControlMapping.MapHue(normalized, range.Minimum, range.Maximum, range.Step));
    public int SetColorTemperature(DisplayDescriptor display, double value) =>
        SetControl(display, value, 19, 20, 21, 22, "color temperature", Centered(AmdControlMapping.NeutralColorTemperature));

    private static Func<double, AdlxIntRange, int> Centered(int neutral) =>
        (normalized, range) => AmdControlMapping.MapCentered(normalized, range.Minimum, range.Maximum, range.Step, neutral);

    public void Restore(DisplayDescriptor display, AmdDisplayState baseline)
    {
        lock (_sync)
        {
            WithDisplay(display, customColor =>
            {
                RestoreControl(customColor, baseline.Brightness, 14, 13, "brightness");
                RestoreControl(customColor, baseline.Contrast, 18, 17, "contrast");
                RestoreControl(customColor, baseline.Saturation, 10, 9, "saturation");
                RestoreControl(customColor, baseline.Hue, 6, 5, "hue");
                RestoreControl(customColor, baseline.ColorTemperature, 22, 21, "color temperature");
                return 0;
            });
        }
    }

    public void Dispose()
    {
        lock (_sync) DisposeNative();
    }

    private int SetControl(
        DisplayDescriptor display,
        double normalizedValue,
        int supportSlot,
        int rangeSlot,
        int getSlot,
        int setSlot,
        string name,
        Func<double, AdlxIntRange, int> map)
    {
        ValidateNormalized(normalizedValue, name);
        lock (_sync)
        {
            return WithDisplay(display, customColor =>
            {
                var state = ReadControl(customColor, supportSlot, rangeSlot, getSlot, name);
                if (!state.Supported || state.Min is null || state.Max is null)
                {
                    throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", state.Reason ?? $"AMD {name} is unavailable.");
                }
                var range = GetRange(customColor, rangeSlot, name);
                var target = map(normalizedValue, range);
                Check(GetMethod<SetInteger>(customColor, setSlot)(customColor, target), $"ADLX Set{name}");
                var actual = GetIntegerValue(customColor, getSlot, name);
                if (actual != target)
                {
                    throw new DisplayOperationException("AMD_VERIFY_FAILED", $"ADLX {name} read-back was {actual}; expected {target}.");
                }
                return actual;
            });
        }
    }

    private T WithDisplay<T>(DisplayDescriptor display, Func<IntPtr, T> action)
    {
        if (!_initialized) throw new DisplayOperationException("AMD_NOT_AVAILABLE", _initializationError ?? "ADLX is not initialized.");
        Check(GetMethod<GetInterface>(_displayServices, 4)(_displayServices, out var list), "IADLXDisplayServices.GetDisplays");
        try
        {
            var size = GetMethod<GetSize>(list, 3)(list);
            for (uint index = 0; index < size; index++)
            {
                Check(GetMethod<ListAt>(list, 11)(list, index, out var nativeDisplay), "IADLXDisplayList.At");
                try
                {
                    if (!Matches(display, nativeDisplay)) continue;
                    var customResult = GetMethod<GetDisplayInterface>(_displayServices, 16)(_displayServices, nativeDisplay, out var customColor);
                    if (!Succeeded(customResult)) customColor = IntPtr.Zero;
                    try
                    {
                        return action(customColor);
                    }
                    finally
                    {
                        Release(customColor);
                    }
                }
                finally
                {
                    Release(nativeDisplay);
                }
            }
        }
        finally
        {
            Release(list);
        }

        throw new DisplayOperationException("AMD_DISPLAY_NOT_FOUND", $"ADLX could not map {display.Name} to an AMD display interface.");
    }

    private static bool Matches(DisplayDescriptor display, IntPtr nativeDisplay)
    {
        var name = TryGetString(nativeDisplay, 6);
        var edid = TryGetString(nativeDisplay, 7);
        return string.Equals(name, display.Name, StringComparison.OrdinalIgnoreCase)
            || (!string.IsNullOrWhiteSpace(name) && display.Name.Contains(name, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrWhiteSpace(display.SerialNumber) && edid.Contains(display.SerialNumber, StringComparison.OrdinalIgnoreCase));
    }

    private uint GetDisplayCount()
    {
        try
        {
            Check(GetMethod<GetUnsigned>(_displayServices, 3)(_displayServices, out var count), "IADLXDisplayServices.GetNumberOfDisplays");
            return count;
        }
        catch
        {
            return 0;
        }
    }

    private static ProviderControlState ReadControl(IntPtr customColor, int supportSlot, int rangeSlot, int getSlot, string name)
    {
        if (customColor == IntPtr.Zero) return UnsupportedControl("ADLX custom color is unavailable for this display.");
        try
        {
            Check(GetMethod<GetBoolean>(customColor, supportSlot)(customColor, out var supported), $"ADLX Is{name}Supported");
            if (supported == 0) return UnsupportedControl($"ADLX reports {name} as unsupported.");
            var range = GetRange(customColor, rangeSlot, name);
            var current = GetIntegerValue(customColor, getSlot, name);
            return new ProviderControlState(true, current, range.Minimum, range.Maximum, null, null);
        }
        catch (Exception exception)
        {
            return UnsupportedControl(exception.Message);
        }
    }

    private static AdlxIntRange GetRange(IntPtr customColor, int slot, string name)
    {
        Check(GetMethod<GetIntegerRange>(customColor, slot)(customColor, out var range), $"ADLX Get{name}Range");
        return range;
    }

    private static int GetIntegerValue(IntPtr customColor, int slot, string name)
    {
        Check(GetMethod<GetInteger>(customColor, slot)(customColor, out var value), $"ADLX Get{name}");
        return value;
    }

    private static void RestoreControl(IntPtr customColor, ProviderControlState state, int setSlot, int getSlot, string name)
    {
        if (!state.Supported || state.Current is null) return;
        if (customColor == IntPtr.Zero) throw new DisplayOperationException("AMD_RESTORE_FAILED", "ADLX custom color interface disappeared.");
        Check(GetMethod<SetInteger>(customColor, setSlot)(customColor, state.Current.Value), $"ADLX restore {name}");
        if (GetIntegerValue(customColor, getSlot, name) != state.Current.Value)
        {
            throw new DisplayOperationException("AMD_RESTORE_FAILED", $"ADLX {name} baseline verification failed.");
        }
    }

    private string? QueryVersion()
    {
        var query = GetExport<AdlxQueryVersion>("ADLXQueryVersion");
        Check(query(out var pointer), "ADLXQueryVersion");
        return Marshal.PtrToStringUTF8(pointer);
    }

    private ulong? QueryFullVersion()
    {
        var query = GetExport<AdlxQueryFullVersion>("ADLXQueryFullVersion");
        Check(query(out var version), "ADLXQueryFullVersion");
        return version;
    }

    private T GetExport<T>(string name) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(_library, name));

    private static T GetMethod<T>(IntPtr instance, int slot) where T : Delegate
    {
        if (instance == IntPtr.Zero) throw new InvalidOperationException("An ADLX interface pointer was null.");
        var vtable = Marshal.ReadIntPtr(instance);
        var function = Marshal.ReadIntPtr(vtable, slot * IntPtr.Size);
        return Marshal.GetDelegateForFunctionPointer<T>(function);
    }

    private static string GetString(IntPtr instance, int slot)
    {
        Check(GetMethod<GetStringValue>(instance, slot)(instance, out var pointer), "ADLX string query");
        return Marshal.PtrToStringUTF8(pointer) ?? string.Empty;
    }

    private static string TryGetString(IntPtr instance, int slot)
    {
        try
        {
            return GetString(instance, slot);
        }
        catch
        {
            return string.Empty;
        }
    }

    private void DisposeNative()
    {
        Release(_displayServices);
        _displayServices = IntPtr.Zero;
        if (_system != IntPtr.Zero && _terminate is not null)
        {
            _ = _terminate();
        }
        _system = IntPtr.Zero;
        _initialized = false;
        if (_library != IntPtr.Zero)
        {
            NativeLibrary.Free(_library);
            _library = IntPtr.Zero;
        }
    }

    private static void Release(IntPtr instance)
    {
        if (instance != IntPtr.Zero) _ = GetMethod<ReleaseInterface>(instance, 1)(instance);
    }

    private static void ValidateNormalized(double value, string name)
    {
        if (double.IsNaN(value) || value is < 0 or > 100)
        {
            throw new DisplayOperationException("VALUE_OUT_OF_RANGE", $"{name} must be between 0 and 100.");
        }
    }

    private static bool Succeeded(int result) => result is 0 or 1 or 2;

    private static void Check(int result, string operation)
    {
        if (!Succeeded(result)) throw new DisplayOperationException("AMD_ADLX_FAILED", $"{operation} failed with ADLX result {result}.");
    }

    private static ProviderControlState UnsupportedControl(string reason) => new(false, null, null, null, null, reason);

    private static AmdDisplayState UnsupportedState(string reason) => new(
        UnsupportedControl(reason), UnsupportedControl(reason), UnsupportedControl(reason),
        UnsupportedControl(reason), UnsupportedControl(reason));

    [StructLayout(LayoutKind.Sequential)]
    private struct AdlxIntRange
    {
        internal int Minimum;
        internal int Maximum;
        internal int Step;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int AdlxInitialize(ulong version, out IntPtr system);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int AdlxTerminate();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int AdlxQueryVersion(out IntPtr version);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int AdlxQueryFullVersion(out ulong version);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetInterface(IntPtr self, out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetDisplayInterface(IntPtr self, IntPtr display, out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetUnsigned(IntPtr self, out uint value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint GetSize(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ListAt(IntPtr self, uint index, out IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetStringValue(IntPtr self, out IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetBoolean(IntPtr self, out byte value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetIntegerRange(IntPtr self, out AdlxIntRange range);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetInteger(IntPtr self, out int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int SetInteger(IntPtr self, int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate long ReleaseInterface(IntPtr self);
}
