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

    internal const string AmdHdrReason =
        "AMD display controls are disabled until ADLX behavior is verified under HDR.";

    internal DisplayCapabilities Get(DisplayDescriptor display)
    {
        if (display.Adapter.Vendor == "amd")
        {
            return Resolve(display, windowsGammaSupported: false, nvidiaState: null, amd.GetState(display));
        }

        return Resolve(
            display,
            // The ramp probe is a GDI read; skip it under HDR, where the ramp controls stay SDR-only.
            !display.Hdr && gamma.IsSupported(display.WindowsDisplayName),
            nvidia.GetState(display),
            amdState: null);
    }

    /// <summary>
    /// Pure capability resolution. Under HDR, NVIDIA saturation and hue keep their
    /// normal provider capability; the Windows ramp controls stay SDR-only, and
    /// every AMD control stays unsupported.
    /// </summary>
    internal static DisplayCapabilities Resolve(
        DisplayDescriptor display,
        bool windowsGammaSupported,
        NvidiaDisplayState? nvidiaState,
        AmdDisplayState? amdState)
    {
        if (display.Adapter.Vendor == "amd")
        {
            if (display.Hdr || amdState is null)
            {
                var unsupported = new CapabilityDescriptor(false, "unknown", null, null, null, AmdHdrReason);
                return new DisplayCapabilities(unsupported, unsupported, unsupported, unsupported, unsupported, unsupported);
            }
            return new DisplayCapabilities(
                ProviderCapability("amd", amdState.Brightness),
                ProviderCapability("amd", amdState.Contrast),
                new CapabilityDescriptor(amdState.GammaRamp is not null, amdState.GammaRamp is not null ? "amd" : "unknown", amdState.GammaRamp is not null ? 0.3 : null, amdState.GammaRamp is not null ? 2.8 : null, amdState.GammaRamp is not null ? 1 : null, amdState.GammaReason),
                ProviderCapability("amd", amdState.Saturation),
                ProviderCapability("amd", amdState.Hue),
                ProviderCapability("amd", amdState.ColorTemperature));
        }

        var windowsSupported = !display.Hdr && windowsGammaSupported;
        var windowsReason = display.Hdr
            ? WindowsGammaHdrReason
            : windowsSupported ? null : "The display driver did not expose a readable gamma ramp.";
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
