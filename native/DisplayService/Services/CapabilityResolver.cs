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
    internal const string WindowsGammaHdrReason =
        "Windows gamma ramps are SDR-only. This control applies when HDR is off.";

    private const string NoReadableRampReason = "The display driver did not expose a readable gamma ramp.";

    internal const string AmdUnavailableReason = "AMD ADLX display state is unavailable.";

    internal DisplayCapabilities Get(DisplayDescriptor display)
    {
        // The ramp probe is a GDI read; skip it under HDR, where the ramp controls stay SDR-only.
        var windowsGammaSupported = !display.Hdr && gamma.IsSupported(display.WindowsDisplayName);
        if (display.Adapter.Vendor == "amd")
        {
            return Resolve(display, windowsGammaSupported, nvidiaState: null, amd.GetState(display));
        }

        return Resolve(display, windowsGammaSupported, nvidia.GetState(display), amdState: null);
    }

    /// <summary>
    /// Pure capability resolution. AMD brightness, contrast, saturation, hue and
    /// color temperature use ADLX custom color in SDR and under HDR (#122). Gamma
    /// uses the Windows ramp on every adapter and, with the other Windows ramp
    /// controls, stays SDR-only. Under HDR, NVIDIA saturation and hue keep their
    /// normal provider capability.
    /// </summary>
    internal static DisplayCapabilities Resolve(
        DisplayDescriptor display,
        bool windowsGammaSupported,
        NvidiaDisplayState? nvidiaState,
        AmdDisplayState? amdState)
    {
        if (display.Adapter.Vendor == "amd")
        {
            if (amdState is null)
            {
                var unsupported = new CapabilityDescriptor(false, "unknown", null, null, null, AmdUnavailableReason);
                return new DisplayCapabilities(unsupported, unsupported, unsupported, unsupported, unsupported, unsupported);
            }
            var amdGammaSupported = !display.Hdr && windowsGammaSupported;
            var amdGammaReason = display.Hdr
                ? WindowsGammaHdrReason
                : amdGammaSupported ? null : NoReadableRampReason;
            return new DisplayCapabilities(
                ProviderCapability("amd", amdState.Brightness),
                ProviderCapability("amd", amdState.Contrast),
                WindowsCapability(amdGammaSupported, 0.3, 2.8, 1, amdGammaReason),
                ProviderCapability("amd", amdState.Saturation),
                ProviderCapability("amd", amdState.Hue),
                ProviderCapability("amd", amdState.ColorTemperature));
        }

        var windowsSupported = !display.Hdr && windowsGammaSupported;
        var windowsReason = display.Hdr
            ? WindowsGammaHdrReason
            : windowsSupported ? null : NoReadableRampReason;
        const string nvidiaUnavailable = "Display is not connected to an NVIDIA adapter.";
        return new DisplayCapabilities(
            WindowsCapability(windowsSupported, 0, 100, 50, windowsReason),
            WindowsCapability(windowsSupported, 0, 100, 50, windowsReason),
            WindowsCapability(windowsSupported, 0.3, 2.8, 1, windowsReason),
            nvidiaState is null
                ? new CapabilityDescriptor(false, "unknown", null, null, null, nvidiaUnavailable)
                : ProviderCapability("nvidia", nvidiaState.Saturation),
            nvidiaState is null
                ? new CapabilityDescriptor(false, "unknown", null, null, null, nvidiaUnavailable)
                : ProviderCapability("nvidia", nvidiaState.Hue),
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
