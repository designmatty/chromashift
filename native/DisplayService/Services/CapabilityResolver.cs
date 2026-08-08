using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Providers.Amd;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Windows;

namespace ChromaShift.DisplayService.Services;

internal sealed class CapabilityResolver(
    WindowsGammaProvider gamma,
    NvidiaColorProvider nvidia,
    AmdAdlxProvider amd)
{
    internal DisplayCapabilities Get(DisplayDescriptor display)
    {
        if (display.Adapter.Vendor == "amd")
        {
            var amdState = amd.GetState(display);
            if (display.Hdr)
            {
                const string reason = "AMD display controls are disabled until ADLX behavior is verified under HDR.";
                var unsupported = new CapabilityDescriptor(false, "unknown", null, null, null, reason);
                return new DisplayCapabilities(unsupported, unsupported, unsupported, unsupported, unsupported, unsupported);
            }
            return new DisplayCapabilities(
                ProviderCapability("amd", amdState.Brightness),
                ProviderCapability("amd", amdState.Contrast),
                new CapabilityDescriptor(amdState.GammaRamp is not null, amdState.GammaRamp is not null ? "amd" : "unknown", amdState.GammaRamp is not null ? 0.5 : null, amdState.GammaRamp is not null ? 2 : null, amdState.GammaRamp is not null ? 1 : null, amdState.GammaReason),
                ProviderCapability("amd", amdState.Saturation),
                ProviderCapability("amd", amdState.Hue),
                ProviderCapability("amd", amdState.ColorTemperature));
        }

        var windowsGammaSupported = !display.Hdr && gamma.IsSupported(display.WindowsDisplayName);
        var windowsReason = display.Hdr
            ? "Windows gamma ramps are unsafe while HDR is active."
            : windowsGammaSupported ? null : "The display driver did not expose a readable gamma ramp.";
        var nvidiaState = nvidia.GetState(display);
        var nvidiaSaturation = display.Hdr
            ? new CapabilityDescriptor(false, "unknown", null, null, null, "NVIDIA color controls are disabled until private-NVAPI behavior is verified under HDR.")
            : ProviderCapability("nvidia", nvidiaState.Saturation);
        var nvidiaHue = display.Hdr
            ? new CapabilityDescriptor(false, "unknown", null, null, null, "NVIDIA color controls are disabled until private-NVAPI behavior is verified under HDR.")
            : ProviderCapability("nvidia", nvidiaState.Hue);

        return new DisplayCapabilities(
            WindowsCapability(windowsGammaSupported, 0, 100, 50, windowsReason),
            WindowsCapability(windowsGammaSupported, 0, 100, 50, windowsReason),
            WindowsCapability(windowsGammaSupported, 0.5, 2, 1, windowsReason),
            nvidiaSaturation,
            nvidiaHue,
            new CapabilityDescriptor(false, "unknown", null, null, null, "No verified provider is available."));
    }

    internal NvidiaDisplayState GetNvidiaState(DisplayDescriptor display) => nvidia.GetState(display);
    internal AmdDisplayState GetAmdState(DisplayDescriptor display) => amd.GetState(display);
    internal AmdAdlxDiagnostics GetAmdDiagnostics() => amd.GetDiagnostics();

    private static CapabilityDescriptor WindowsCapability(
        bool supported,
        double minimum,
        double maximum,
        double defaultValue,
        string? reason) =>
        new(supported, supported ? "windows" : "unknown", supported ? minimum : null, supported ? maximum : null, supported ? defaultValue : null, reason);

    private static CapabilityDescriptor ProviderCapability(string provider, ProviderControlState state) =>
        new(state.Supported, state.Supported ? provider : "unknown", state.Min, state.Max, state.Default, state.Reason);
}
