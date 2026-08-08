using System.Runtime.InteropServices;
using ChromaShift.DisplayService.Core;

namespace ChromaShift.DisplayService.Providers.Amd;

internal sealed class AmdAdlxProvider : IDisposable
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

    internal AmdDisplayState GetState(DisplayDescriptor display)
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
                return WithDisplay(display, (nativeDisplay, customColor, gamma) => new AmdDisplayState(
                    ReadControl(customColor, 11, 12, 13, "brightness"),
                    ReadControl(customColor, 15, 16, 17, "contrast"),
                    ReadControl(customColor, 7, 8, 9, "saturation"),
                    ReadControl(customColor, 3, 4, 5, "hue"),
                    ReadControl(customColor, 19, 20, 21, "color temperature"),
                    ReadGamma(gamma, out var gammaReason),
                    gammaReason));
            }
            catch (Exception exception)
            {
                return UnsupportedState(exception.Message);
            }
        }
    }

    internal int SetBrightness(DisplayDescriptor display, double value) => SetControl(display, value, 11, 12, 13, 14, "brightness");
    internal int SetContrast(DisplayDescriptor display, double value) => SetControl(display, value, 15, 16, 17, 18, "contrast");
    internal int SetSaturation(DisplayDescriptor display, double value) => SetControl(display, value, 7, 8, 9, 10, "saturation");
    internal int SetHue(DisplayDescriptor display, double value) => SetControl(display, value, 3, 4, 5, 6, "hue");
    internal int SetColorTemperature(DisplayDescriptor display, double value) => SetControl(display, value, 19, 20, 21, 22, "color temperature");

    internal string SetGamma(DisplayDescriptor display, GammaRamp baseline, double value)
    {
        var requested = GammaRampTransform.Apply(baseline, new GammaSettings(null, null, value));
        lock (_sync)
        {
            return WithDisplay(display, (_, _, gamma) =>
            {
                if (gamma == IntPtr.Zero)
                {
                    throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "ADLX gamma is unavailable for this display.");
                }
                WriteGamma(gamma, requested);
                var actual = ReadGamma(gamma, out var reason);
                if (actual is null || !actual.ToInterleavedBuffer().SequenceEqual(requested.ToInterleavedBuffer()))
                {
                    throw new DisplayOperationException("AMD_VERIFY_FAILED", reason ?? "ADLX gamma read-back did not match the requested ramp.");
                }
                return actual.GetHash();
            });
        }
    }

    internal void Restore(DisplayDescriptor display, AmdDisplayState baseline)
    {
        lock (_sync)
        {
            WithDisplay(display, (nativeDisplay, customColor, gamma) =>
            {
                RestoreControl(customColor, baseline.Brightness, 14, 13, "brightness");
                RestoreControl(customColor, baseline.Contrast, 18, 17, "contrast");
                RestoreControl(customColor, baseline.Saturation, 10, 9, "saturation");
                RestoreControl(customColor, baseline.Hue, 6, 5, "hue");
                RestoreControl(customColor, baseline.ColorTemperature, 22, 21, "color temperature");
                if (baseline.GammaRamp is not null)
                {
                    if (gamma == IntPtr.Zero) throw new DisplayOperationException("AMD_RESTORE_FAILED", "ADLX gamma interface disappeared.");
                    WriteGamma(gamma, baseline.GammaRamp);
                    var actual = ReadGamma(gamma, out var gammaReadReason);
                    if (actual is null || !actual.ToInterleavedBuffer().SequenceEqual(baseline.GammaRamp.ToInterleavedBuffer()))
                    {
                        throw new DisplayOperationException("AMD_RESTORE_FAILED", "ADLX gamma baseline verification failed.");
                    }
                }
                return 0;
            });
        }
    }

    public void Dispose()
    {
        lock (_sync) DisposeNative();
    }

    private int SetControl(DisplayDescriptor display, double normalizedValue, int supportSlot, int rangeSlot, int getSlot, int setSlot, string name)
    {
        ValidateNormalized(normalizedValue, name);
        lock (_sync)
        {
            return WithDisplay(display, (_, customColor, _) =>
            {
                var state = ReadControl(customColor, supportSlot, rangeSlot, getSlot, name);
                if (!state.Supported || state.Min is null || state.Max is null)
                {
                    throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", state.Reason ?? $"AMD {name} is unavailable.");
                }
                var range = GetRange(customColor, rangeSlot, name);
                var target = MapNormalized(normalizedValue, range);
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

    private T WithDisplay<T>(DisplayDescriptor display, Func<IntPtr, IntPtr, IntPtr, T> action)
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
                    var gammaResult = GetMethod<GetDisplayInterface>(_displayServices, 7)(_displayServices, nativeDisplay, out var gamma);
                    if (!Succeeded(gammaResult)) gamma = IntPtr.Zero;
                    try
                    {
                        return action(nativeDisplay, customColor, gamma);
                    }
                    finally
                    {
                        Release(gamma);
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

    private static GammaRamp? ReadGamma(IntPtr gamma, out string? reason)
    {
        if (gamma == IntPtr.Zero)
        {
            reason = "ADLX gamma is unavailable for this display.";
            return null;
        }
        try
        {
            Check(GetMethod<GetGammaRamp>(gamma, 6)(gamma, out var native), "IADLXDisplayGamma.GetGammaRamp");
            var red = new ushort[GammaRamp.ChannelLength];
            var green = new ushort[GammaRamp.ChannelLength];
            var blue = new ushort[GammaRamp.ChannelLength];
            for (var index = 0; index < GammaRamp.ChannelLength; index++)
            {
                red[index] = native.Values[index * 3];
                green[index] = native.Values[(index * 3) + 1];
                blue[index] = native.Values[(index * 3) + 2];
            }
            reason = null;
            return new GammaRamp(red, green, blue);
        }
        catch (Exception exception)
        {
            reason = exception.Message;
            return null;
        }
    }

    private static void WriteGamma(IntPtr gamma, GammaRamp ramp)
    {
        ramp.Validate();
        var values = new ushort[GammaRamp.ChannelLength * 3];
        for (var index = 0; index < GammaRamp.ChannelLength; index++)
        {
            values[index * 3] = ramp.Red[index];
            values[(index * 3) + 1] = ramp.Green[index];
            values[(index * 3) + 2] = ramp.Blue[index];
        }
        Check(GetMethod<SetGammaRamp>(gamma, 26)(gamma, new AdlxGammaRamp { Values = values }), "IADLXDisplayGamma.SetReGammaRamp");
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

    private static int MapNormalized(double value, AdlxIntRange range)
    {
        var raw = range.Minimum + ((value / 100) * (range.Maximum - range.Minimum));
        var step = Math.Max(range.Step, 1);
        return Math.Clamp(range.Minimum + checked((int)Math.Round((raw - range.Minimum) / step)) * step, range.Minimum, range.Maximum);
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
        UnsupportedControl(reason), UnsupportedControl(reason), null, reason);

    [StructLayout(LayoutKind.Sequential)]
    private struct AdlxIntRange
    {
        internal int Minimum;
        internal int Maximum;
        internal int Step;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AdlxGammaRamp
    {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = GammaRamp.ChannelLength * 3)]
        internal ushort[] Values;
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
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetGammaRamp(IntPtr self, out AdlxGammaRamp ramp);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int SetGammaRamp(IntPtr self, AdlxGammaRamp ramp);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate long ReleaseInterface(IntPtr self);
}
