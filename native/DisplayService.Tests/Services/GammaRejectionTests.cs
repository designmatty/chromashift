using System.ComponentModel;
using System.Text.Json.Nodes;
using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Providers.Amd;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class GammaRejectionTests
{
    [Fact]
    public void SetDeviceGammaRampFailureRestoresEveryProviderAndReportsValues()
    {
        var display = new DisplayDescriptor(
            "display:gamma-rejection", "physical:test", "VG278", "DISPLAY1", "monitor-path",
            "TST", "0001", "serial",
            new DisplayAdapterDescriptor("adapter:test", "Test GPU driver", "nvidia", "PCI\\VEN_10DE"),
            "DisplayPort", true, false, false, 8, 144);
        var calls = new List<string>();
        var gamma = new FakeGamma(calls);
        var nvidia = new FakeNvidia(calls);
        var manager = new BaselineManager(new FakeDisplays(display), gamma, nvidia, new FakeAmd());
        manager.Capture(display.Id);
        var originalError = Console.Error;
        using var diagnostics = new StringWriter();
        try
        {
            Console.SetError(diagnostics);
            var exception = Assert.Throws<DisplayOperationException>(() => manager.Apply(
                display.Id, new DisplaySettings(95, 50, 2.5, 80, 20, null)));
            Assert.Equal("GAMMA_WRITE_FAILED", exception.Code);
            Assert.Equal("This display rejected gamma 2.50 at brightness 95% (VG278).", exception.Message);
        }
        finally
        {
            Console.SetError(originalError);
        }

        Assert.Equal(new[] { "gamma:restore", "nvidia:restore", "gamma:reject", "gamma:restore", "nvidia:restore" }, calls);
        Assert.Equal(Identity().GetHash(), gamma.Current.GetHash());
        Assert.Equal(1, manager.Count);
        var record = diagnostics.ToString().Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries)
            .Select(line => JsonNode.Parse(line)!.AsObject())
            .Single(entry => entry["eventName"]?.GetValue<string>() == "GammaSettingsRejected");
        Assert.Equal(display.Id, record["displayId"]!.GetValue<string>());
        Assert.Equal("VG278", record["displayName"]!.GetValue<string>());
        Assert.Equal(display.Adapter.Name, record["adapterName"]!.GetValue<string>());
        Assert.Equal(display.Adapter.DeviceId, record["adapterDeviceId"]!.GetValue<string>());
        Assert.Equal(95, record["brightness"]!.GetValue<double>());
        Assert.Equal(50, record["contrast"]!.GetValue<double>());
        Assert.Equal(2.5, record["gamma"]!.GetValue<double>());
        Assert.Contains("SetDeviceGammaRamp", record["nativeMessage"]!.GetValue<string>());
    }

    private static GammaRamp Identity()
    {
        var channel = Enumerable.Range(0, GammaRamp.ChannelLength).Select(index => (ushort)(index * 257)).ToArray();
        return new GammaRamp([.. channel], [.. channel], [.. channel]);
    }

    private sealed class FakeDisplays(DisplayDescriptor display) : IDisplayRegistry
    {
        public IReadOnlyList<DisplayDescriptor> List() => [display];
    }

    private sealed class FakeGamma(List<string> calls) : IWindowsGammaProvider
    {
        internal GammaRamp Current { get; private set; } = Identity();
        public bool IsSupported(string windowsDisplayName) => true;
        public GammaRamp Read(string windowsDisplayName) => Current;
        public void Write(string windowsDisplayName, GammaRamp ramp)
        {
            if (ramp.GetHash() != Identity().GetHash())
            {
                calls.Add("gamma:reject");
                throw new Win32Exception(5, "SetDeviceGammaRamp failed for DISPLAY1.");
            }
            calls.Add("gamma:restore");
            Current = ramp;
        }
    }

    private static readonly ProviderControlState Supported = new(true, 50, 0, 100, 50, null);
    private static readonly ProviderControlState Unsupported = new(false, null, null, null, null, "unsupported");

    private sealed class FakeNvidia(List<string> calls) : INvidiaColorProvider
    {
        public NvidiaDisplayState GetState(DisplayDescriptor display) => new(Supported, Supported);
        public int SetSaturation(DisplayDescriptor display, double normalizedValue) => throw new InvalidOperationException("Unexpected write");
        public int SetHue(DisplayDescriptor display, double normalizedValue) => throw new InvalidOperationException("Unexpected write");
        public void Restore(DisplayDescriptor display, NvidiaDisplayState baseline) => calls.Add("nvidia:restore");
    }

    private sealed class FakeAmd : IAmdColorProvider
    {
        public AmdDisplayState GetState(DisplayDescriptor display) => new(Unsupported, Unsupported, Unsupported, Unsupported, Unsupported, null, "unsupported");
        public int SetBrightness(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected write");
        public int SetContrast(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected write");
        public int SetSaturation(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected write");
        public int SetHue(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected write");
        public int SetColorTemperature(DisplayDescriptor display, double value) => throw new InvalidOperationException("Unexpected write");
        public string SetGamma(DisplayDescriptor display, GammaRamp baseline, double value) => throw new InvalidOperationException("Unexpected write");
        public void Restore(DisplayDescriptor display, AmdDisplayState baseline) => throw new InvalidOperationException("Unexpected restore");
    }
}
