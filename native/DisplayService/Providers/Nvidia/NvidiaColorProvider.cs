using ChromaShift.DisplayService.Core;
using NvAPIWrapper;
using NvidiaDisplay = NvAPIWrapper.Display.Display;

namespace ChromaShift.DisplayService.Providers.Nvidia;

internal sealed class NvidiaColorProvider : IDisposable
{
    private readonly Lock _sync = new();
    private readonly string? _initializationError;
    private bool _initialized;

    internal NvidiaColorProvider()
    {
        try
        {
            NVIDIA.Initialize();
            _initialized = true;
        }
        catch (Exception exception)
        {
            _initializationError = exception.Message;
        }
    }

    internal NvidiaDisplayState GetState(DisplayDescriptor display)
    {
        if (display.Adapter.Vendor != "nvidia")
        {
            return UnsupportedState("Display is not connected to an NVIDIA adapter.");
        }
        if (!_initialized)
        {
            return UnsupportedState(_initializationError ?? "NVAPI initialization failed.");
        }

        lock (_sync)
        {
            NvidiaDisplay nativeDisplay;
            try
            {
                nativeDisplay = FindDisplay(display);
            }
            catch (Exception exception)
            {
                return UnsupportedState(exception.Message);
            }

            return new NvidiaDisplayState(
                ReadSaturation(nativeDisplay),
                ReadHue(nativeDisplay));
        }
    }

    internal int SetSaturation(DisplayDescriptor display, double normalizedValue)
    {
        ValidateNormalized(normalizedValue, nameof(normalizedValue));
        lock (_sync)
        {
            var nativeDisplay = FindDisplay(display);
            var control = nativeDisplay.DigitalVibranceControl;
            var target = MapNormalized(normalizedValue, control.MinimumLevel, control.MaximumLevel);
            control.CurrentLevel = target;
            var actual = nativeDisplay.DigitalVibranceControl.CurrentLevel;
            if (actual != target)
            {
                throw new DisplayOperationException(
                    "NVIDIA_VERIFY_FAILED",
                    $"NVIDIA saturation read-back was {actual}; expected {target}.");
            }
            return actual;
        }
    }

    internal int SetHue(DisplayDescriptor display, double normalizedValue)
    {
        ValidateNormalized(normalizedValue, nameof(normalizedValue));
        lock (_sync)
        {
            var nativeDisplay = FindDisplay(display);
            var target = MapNormalized(normalizedValue, 0, 359);
            nativeDisplay.HUEControl.CurrentAngle = target;
            var actual = nativeDisplay.HUEControl.CurrentAngle;
            if (actual != target)
            {
                throw new DisplayOperationException(
                    "NVIDIA_VERIFY_FAILED",
                    $"NVIDIA hue read-back was {actual}; expected {target}.");
            }
            return actual;
        }
    }

    internal void Restore(DisplayDescriptor display, NvidiaDisplayState baseline)
    {
        lock (_sync)
        {
            var nativeDisplay = FindDisplay(display);
            if (baseline.Saturation is { Supported: true, Current: { } saturation })
            {
                nativeDisplay.DigitalVibranceControl.CurrentLevel = saturation;
                if (nativeDisplay.DigitalVibranceControl.CurrentLevel != saturation)
                {
                    throw new DisplayOperationException("NVIDIA_RESTORE_FAILED", "NVIDIA saturation baseline verification failed.");
                }
            }
            if (baseline.Hue is { Supported: true, Current: { } hue })
            {
                nativeDisplay.HUEControl.CurrentAngle = hue;
                if (nativeDisplay.HUEControl.CurrentAngle != hue)
                {
                    throw new DisplayOperationException("NVIDIA_RESTORE_FAILED", "NVIDIA hue baseline verification failed.");
                }
            }
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (!_initialized) return;
            NVIDIA.Unload();
            _initialized = false;
        }
    }

    private static ProviderControlState ReadSaturation(NvidiaDisplay display)
    {
        try
        {
            var control = display.DigitalVibranceControl;
            return new ProviderControlState(
                true,
                control.CurrentLevel,
                control.MinimumLevel,
                control.MaximumLevel,
                control.DefaultLevel,
                null);
        }
        catch (Exception exception)
        {
            return UnsupportedControl(exception.Message);
        }
    }

    private static ProviderControlState ReadHue(NvidiaDisplay display)
    {
        try
        {
            var control = display.HUEControl;
            return new ProviderControlState(true, control.CurrentAngle, 0, 359, control.DefaultAngle, null);
        }
        catch (Exception exception)
        {
            return UnsupportedControl(exception.Message);
        }
    }

    private static NvidiaDisplay FindDisplay(DisplayDescriptor display) =>
        NvidiaDisplay.GetDisplays().SingleOrDefault(candidate =>
            string.Equals(candidate.Name, display.WindowsDisplayName, StringComparison.OrdinalIgnoreCase))
        ?? throw new DisplayOperationException(
            "NVIDIA_DISPLAY_NOT_FOUND",
            $"NVAPI could not map {display.WindowsDisplayName} to an NVIDIA display handle.");

    private static NvidiaDisplayState UnsupportedState(string reason) =>
        new(UnsupportedControl(reason), UnsupportedControl(reason));

    private static ProviderControlState UnsupportedControl(string reason) =>
        new(false, null, null, null, null, reason);

    private static int MapNormalized(double value, int minimum, int maximum) =>
        checked((int)Math.Round(minimum + ((value / 100) * (maximum - minimum))));

    private static void ValidateNormalized(double value, string name)
    {
        if (double.IsNaN(value) || value is < 0 or > 100)
        {
            throw new DisplayOperationException("VALUE_OUT_OF_RANGE", $"{name} must be between 0 and 100.");
        }
    }
}
