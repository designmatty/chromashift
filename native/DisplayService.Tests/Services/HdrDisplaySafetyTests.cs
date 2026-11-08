using System.ComponentModel;
using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Providers.Amd;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class HdrDisplaySafetyTests
{
    [Fact]
    public void RejectsBaselineCaptureWhileHdrIsActive()
    {
        var exception = Assert.Throws<DisplayOperationException>(
            () => BaselineManager.EnsureDisplayWritesSafe(Display(hdr: true)));

        Assert.Equal("HDR_UNSAFE", exception.Code);
    }

    [Fact]
    public void AllowsBaselineCaptureWhenHdrIsInactive()
    {
        BaselineManager.EnsureDisplayWritesSafe(Display(hdr: false));
    }

    [Fact]
    public void RestoresCapturedGammaAndNvidiaValuesUnderHdrWithReadBack()
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Gamma.Current = Ramp(200);
        fixture.Nvidia.Current = new(Control(85), Control(40));
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        var result = fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.True(result["restored"]!.GetValue<bool>());
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
        Assert.Equal(new[] { "gamma:write", "gamma:read", "nvidia:restore", "nvidia:read" }, fixture.Calls);
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RestoreAllIncludesHdrForLifecycleExitAndStrictShutdown(bool explicitShutdown)
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Gamma.Current = Ramp(200);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        // The lifecycle finally uses RestoreAll(); service.shutdown uses strict flags.
        // No real helper or Windows provider is started by this test.
        var result = fixture.Manager.RestoreAll(
            failOnError: explicitShutdown, discardDisconnected: explicitShutdown);
        Assert.True(result["displays"]![0]!["restored"]!.GetValue<bool>());
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void CaptureAndApplyRemainBlockedUnderHdrEvenWithAnExistingBaseline(bool captured)
    {
        var fixture = new Fixture();
        if (captured) fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(
            () => fixture.Manager.Capture(fixture.Displays.Current.Id)).Code);
        foreach (var settings in new[] {
            new DisplaySettings(30, 50, 1, 85, 0, null),
            new DisplaySettings(null, null, null, null, null, null)
        })
        {
            Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(
                () => fixture.Manager.Apply(fixture.Displays.Current.Id, settings)).Code);
        }
        Assert.Empty(fixture.Calls);
    }

    [Theory]
    [InlineData("gammaWrite")]
    [InlineData("gammaReadBack")]
    [InlineData("nvidiaReadBack")]
    public void UnconfirmedHdrRestoreRetainsBaselineAndIsRetryable(string failure)
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Gamma.Current = Ramp(200);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Gamma.FailWrite = failure == "gammaWrite";
        fixture.Gamma.IgnoreWrite = failure == "gammaReadBack";
        fixture.Nvidia.FailVerify = failure == "nvidiaReadBack";
        Assert.Equal("BASELINE_RESTORE_FAILED", Assert.Throws<DisplayOperationException>(
            () => fixture.Manager.RestoreAll(failOnError: true, discardDisconnected: true)).Code);
        Assert.Equal(1, fixture.Manager.Count);
        Assert.Contains("nvidia:restore", fixture.Calls);
        fixture.Gamma.FailWrite = fixture.Gamma.IgnoreWrite = fixture.Nvidia.FailVerify = false;
        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Fact]
    public void AmdRestoreUsesOnlyCapturedValuesAndNoProfileSettersUnderHdr()
    {
        var fixture = new Fixture(amd: true);
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Restored);
        Assert.Equal(new[] { "amd:restore" }, fixture.Calls);
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Fact]
    public void DisconnectedBaselineIsRetainedUntilReconnect()
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Displays.Connected = false;
        fixture.Manager.RestoreAll();
        Assert.Equal(1, fixture.Manager.Count);
        fixture.Displays.Connected = true;
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.RestoreAll(failOnError: true);
        Assert.Equal(0, fixture.Manager.Count);
    }

    private static GammaRamp Ramp(int step)
    {
        var channel = Enumerable.Range(0, GammaRamp.ChannelLength).Select(index => (ushort)(index * step)).ToArray();
        return new([.. channel], [.. channel], [.. channel]);
    }

    private static ProviderControlState Control(int value) => new(true, value, 0, 100, 50, null);
    private static readonly ProviderControlState Unsupported = new(false, null, null, null, null, "unsupported");

    private sealed class Fixture
    {
        internal readonly List<string> Calls = [];
        internal readonly FakeDisplays Displays;
        internal readonly FakeGamma Gamma;
        internal readonly FakeNvidia Nvidia;
        internal readonly FakeAmd Amd;
        internal readonly BaselineManager Manager;
        internal Fixture(bool amd = false)
        {
            var display = Display(hdr: false);
            Displays = new(display with { Adapter = display.Adapter with { Vendor = amd ? "amd" : "nvidia" } });
            Gamma = new(Calls);
            Nvidia = new(Calls);
            Amd = new(Calls);
            Manager = new(Displays, Gamma, Nvidia, Amd);
        }
    }

    private sealed class FakeDisplays(DisplayDescriptor display) : IDisplayRegistry
    {
        internal DisplayDescriptor Current = display;
        internal bool Connected = true;
        public IReadOnlyList<DisplayDescriptor> List() => Connected ? [Current] : [];
    }

    private sealed class FakeGamma(List<string> calls) : IWindowsGammaProvider
    {
        internal GammaRamp Current = Ramp(250);
        internal bool FailWrite;
        internal bool IgnoreWrite;
        public bool IsSupported(string name) => true;
        public GammaRamp Read(string name)
        {
            if (calls.Contains("gamma:write")) calls.Add("gamma:read");
            return Current;
        }
        public void Write(string name, GammaRamp ramp)
        {
            calls.Add("gamma:write");
            if (FailWrite) throw new Win32Exception("write failed");
            if (!IgnoreWrite) Current = ramp;
        }
    }

    private sealed class FakeNvidia(List<string> calls) : INvidiaColorProvider
    {
        internal NvidiaDisplayState Current = new(Control(43), Control(12));
        internal bool FailVerify;
        public NvidiaDisplayState GetState(DisplayDescriptor display) => display.Adapter.Vendor == "nvidia" ? Current : new(Unsupported, Unsupported);
        public int SetSaturation(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public int SetHue(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public void Restore(DisplayDescriptor display, NvidiaDisplayState baseline)
        {
            calls.Add("nvidia:restore");
            Current = baseline;
            calls.Add("nvidia:read");
            if (FailVerify) throw new DisplayOperationException("NVIDIA_RESTORE_FAILED", "read-back mismatch");
        }
    }

    private sealed class FakeAmd(List<string> calls) : IAmdColorProvider
    {
        internal readonly AmdDisplayState Baseline = new(Control(47), Control(48), Control(43), Control(12), Control(51), Ramp(250), null);
        internal AmdDisplayState? Restored;
        public AmdDisplayState GetState(DisplayDescriptor display) => display.Adapter.Vendor == "amd" ? Baseline : new(Unsupported, Unsupported, Unsupported, Unsupported, Unsupported, null, "unsupported");
        public int SetBrightness(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public int SetContrast(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public int SetSaturation(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public int SetHue(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public int SetColorTemperature(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected apply");
        public string SetGamma(DisplayDescriptor display, GammaRamp baseline, double value) => throw new InvalidOperationException("Unexpected apply");
        public void Restore(DisplayDescriptor display, AmdDisplayState baseline)
        {
            calls.Add("amd:restore");
            Restored = baseline;
        }
    }

    private static DisplayDescriptor Display(bool hdr) =>
        new(
            "display:test",
            "display:test",
            "Test display",
            "\\\\.\\DISPLAY1",
            "monitor-path",
            "TST",
            "0001",
            "serial",
            new DisplayAdapterDescriptor("adapter", "Test adapter", "nvidia", "PCI\\VEN_10DE"),
            "DisplayPort",
            true,
            hdr,
            true,
            10,
            240);
}
