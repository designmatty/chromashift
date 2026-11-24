using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class CapabilityResolverTests
{
    private static readonly NvidiaDisplayState Nvidia = new(
        new ProviderControlState(true, 50, 0, 100, 50, null),
        new ProviderControlState(true, 0, 0, 359, 0, null));

    private static readonly AmdDisplayState Amd = new(
        Control(), Control(), Control(), Control(), Control());

    [Fact]
    public void NvidiaUnderHdrKeepsSaturationAndHueAndMakesTheRampControlsSdrOnly()
    {
        var capabilities = CapabilityResolver.Resolve(Display(hdr: true, "nvidia"), true, Nvidia, null);

        foreach (var control in new[] { capabilities.Brightness, capabilities.Contrast, capabilities.Gamma })
        {
            Assert.False(control.Supported);
            Assert.Equal("unknown", control.Provider);
            Assert.Equal(CapabilityResolver.WindowsGammaHdrReason, control.Reason);
        }
        Assert.Equal(new CapabilityDescriptor(true, "nvidia", 0, 100, 50, null), capabilities.Saturation);
        Assert.Equal(new CapabilityDescriptor(true, "nvidia", 0, 359, 0, null), capabilities.Hue);
        Assert.False(capabilities.ColorTemperature.Supported);
    }

    [Fact]
    public void NvidiaUnderHdrReportsAnUnavailableVibranceInterfaceAsUnsupported()
    {
        var unavailable = new ProviderControlState(false, null, null, null, null, "DVC interface missing.");
        var capabilities = CapabilityResolver.Resolve(
            Display(hdr: true, "nvidia"), true, new NvidiaDisplayState(unavailable, unavailable), null);

        Assert.False(capabilities.Saturation.Supported);
        Assert.Equal("DVC interface missing.", capabilities.Saturation.Reason);
        Assert.False(capabilities.Hue.Supported);
    }

    [Fact]
    public void NvidiaInSdrIsUnchanged()
    {
        var capabilities = CapabilityResolver.Resolve(Display(hdr: false, "nvidia"), true, Nvidia, null);

        Assert.Equal(new CapabilityDescriptor(true, "windows", 0, 100, 50, null), capabilities.Brightness);
        Assert.Equal(new CapabilityDescriptor(true, "windows", 0.3, 2.8, 1, null), capabilities.Gamma);
        Assert.True(capabilities.Saturation.Supported);
        Assert.True(capabilities.Hue.Supported);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AmdUnderHdrUsesAdlxForEveryControlExceptTheSdrOnlyGamma(bool windowsGammaSupported)
    {
        // A stale "supported" ramp probe must not enable gamma under HDR.
        var capabilities = CapabilityResolver.Resolve(Display(hdr: true, "amd"), windowsGammaSupported, null, Amd);

        foreach (var control in new[]
        {
            capabilities.Brightness, capabilities.Contrast,
            capabilities.Saturation, capabilities.Hue, capabilities.ColorTemperature
        })
        {
            Assert.True(control.Supported);
            Assert.Equal("amd", control.Provider);
        }
        Assert.Equal(
            new CapabilityDescriptor(false, "unknown", null, null, null, CapabilityResolver.WindowsGammaHdrReason),
            capabilities.Gamma);
    }

    [Fact]
    public void AmdWithoutAdlxStateHasNoSupportedControl()
    {
        var capabilities = CapabilityResolver.Resolve(Display(hdr: true, "amd"), true, null, null);
        Assert.All(
            new[]
            {
                capabilities.Brightness, capabilities.Contrast, capabilities.Gamma,
                capabilities.Saturation, capabilities.Hue, capabilities.ColorTemperature
            },
            control =>
            {
                Assert.False(control.Supported);
                Assert.Equal(CapabilityResolver.AmdUnavailableReason, control.Reason);
            });
    }

    [Fact]
    public void AmdInSdrUsesAdlxForBrightnessAndContrastAndTheWindowsRampForGamma()
    {
        var capabilities = CapabilityResolver.Resolve(Display(hdr: false, "amd"), true, null, Amd);

        Assert.Equal("amd", capabilities.Brightness.Provider);
        Assert.Equal("amd", capabilities.Contrast.Provider);
        Assert.Equal(new CapabilityDescriptor(true, "windows", 0.3, 2.8, 1, null), capabilities.Gamma);
        Assert.Equal("amd", capabilities.Saturation.Provider);
        Assert.Equal("amd", capabilities.Hue.Provider);
        Assert.Equal("amd", capabilities.ColorTemperature.Provider);

        var unreadable = CapabilityResolver.Resolve(Display(hdr: false, "amd"), false, null, Amd).Gamma;
        Assert.False(unreadable.Supported);
        Assert.Equal("unknown", unreadable.Provider);
        Assert.Equal("The display driver did not expose a readable gamma ramp.", unreadable.Reason);
        Assert.Equal("amd", CapabilityResolver.Resolve(Display(hdr: false, "amd"), false, null, Amd).Brightness.Provider);
    }

    [Fact]
    public void IntelUnderHdrHasNoSupportedControl()
    {
        var unsupported = new ProviderControlState(false, null, null, null, null, "Display is not connected to an NVIDIA adapter.");
        var capabilities = CapabilityResolver.Resolve(
            Display(hdr: true, "intel"), true, new NvidiaDisplayState(unsupported, unsupported), null);

        Assert.All(
            new[]
            {
                capabilities.Brightness, capabilities.Contrast, capabilities.Gamma,
                capabilities.Saturation, capabilities.Hue, capabilities.ColorTemperature
            },
            control => Assert.False(control.Supported));
    }

    private static ProviderControlState Control() => new(true, 50, 0, 100, 50, null);

    private static DisplayDescriptor Display(bool hdr, string vendor) => new(
        "display:test", "display:test", "Test display", "\\\\.\\DISPLAY1", "monitor-path",
        "TST", "0001", "serial",
        new DisplayAdapterDescriptor("adapter", "Test adapter", vendor, "PCI\\VEN_TEST"),
        "DisplayPort", true, hdr, true, 10, 240);
}
