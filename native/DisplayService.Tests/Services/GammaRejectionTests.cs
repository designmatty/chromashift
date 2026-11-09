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
    [Theory]
    [InlineData(2.0, 1.85, "max", 4)]
    [InlineData(0.5, 0.65, "min", 4)]
    [InlineData(1.023, 1.0, "max", 2)]
    public void WalksTowardNeutralAndReadsBackOnlyTheFirstAcceptedRamp(
        double requested, double accepted, string end, int attempts)
    {
        var display = TestDisplay();
        var calls = new List<string>();
        var gamma = new WalkGamma(calls, 50, requested, accepted);
        var manager = new BaselineManager(new FakeDisplays(display), gamma, new FakeNvidia(calls), new FakeAmd());
        manager.Capture(display.Id);
        calls.Clear();
        var result = manager.Apply(display.Id, new DisplaySettings(50, 50, requested, null, null, null));

        Assert.Equal(accepted, result["applied"]!["gamma"]!.GetValue<double>());
        Assert.Equal(accepted, result["settings"]!["gamma"]!.GetValue<double>());
        Assert.Equal(end, result["learnedGammaLimit"]!["end"]!.GetValue<string>());
        Assert.Equal(accepted, result["learnedGammaLimit"]!["value"]!.GetValue<double>());
        Assert.Equal(Identity().GetHash(), result["learnedGammaLimit"]!["baselineHash"]!.GetValue<string>());
        Assert.Equal("sdr", result["learnedGammaLimit"]!["colorMode"]!.GetValue<string>());
        Assert.Equal(attempts, gamma.Attempts.Count);
        Assert.Equal(requested, gamma.Attempts[0]);
        Assert.Equal(accepted, gamma.Attempts[^1]);
        Assert.Equal(new[] { "gamma:restore", "gamma:read", "nvidia:restore" }, calls.Take(3));
        Assert.Equal(new[] { "gamma:accept", "gamma:read" }, calls.TakeLast(2));
        Assert.Equal(attempts - 1, calls.Count(call => call == "gamma:reject"));
        Assert.Single(calls, call => call == "gamma:restore");
        Assert.Equal(1, manager.Count);
    }

    [Fact]
    public void ExhaustionIncludesNeutralThenRestoresEveryProviderAndReportsOriginalRequest()
    {
        var display = TestDisplay();
        var calls = new List<string>();
        var gamma = new WalkGamma(calls, 95, 2.5, null);
        var manager = new BaselineManager(new FakeDisplays(display), gamma, new FakeNvidia(calls), new FakeAmd());
        manager.Capture(display.Id);
        calls.Clear();
        var exception = Assert.Throws<DisplayOperationException>(() => manager.Apply(
            display.Id, new DisplaySettings(95, 50, 2.5, null, null, null)));
        Assert.Equal("GAMMA_WRITE_FAILED", exception.Code);
        Assert.Equal("This display rejected gamma 2.50 at brightness 95% (VG278).", exception.Message);
        Assert.Equal(31, gamma.Attempts.Count);
        Assert.Equal(1, gamma.Attempts[^1]);
        Assert.Equal(new[] { "gamma:restore", "gamma:read", "nvidia:restore" }, calls.TakeLast(3));
        Assert.Equal(2, calls.Count(call => call == "gamma:restore"));
        Assert.Equal(Identity().GetHash(), gamma.Current.GetHash());
    }

    [Fact]
    public void ReadBackMismatchIsNeverRetriedAndHdrStillRefusesAllProfileWrites()
    {
        var display = TestDisplay();
        var calls = new List<string>();
        var gamma = new WalkGamma(calls, 50, 2, 2) { DiscardAcceptedWrite = true };
        var manager = new BaselineManager(new FakeDisplays(display), gamma, new FakeNvidia(calls), new FakeAmd());
        manager.Capture(display.Id);
        var failure = Assert.Throws<DisplayOperationException>(() => manager.Apply(
            display.Id, new DisplaySettings(50, 50, 2, null, null, null)));
        Assert.Equal("GAMMA_VERIFY_FAILED", failure.Code);
        Assert.Single(gamma.Attempts);
        calls.Clear();
        var hdrManager = new BaselineManager(new FakeDisplays(display with { Hdr = true }), gamma, new FakeNvidia(calls), new FakeAmd());
        var hdrFailure = Assert.Throws<DisplayOperationException>(() => hdrManager.Apply(
            display.Id, new DisplaySettings(50, 50, 2, null, null, null)));
        Assert.Equal("HDR_UNSAFE", hdrFailure.Code);
        Assert.Empty(calls);
    }

    private static DisplayDescriptor TestDisplay() => new(
        "display:gamma-rejection", "physical:test", "VG278", "DISPLAY1", "monitor-path",
        "TST", "0001", "serial",
        new DisplayAdapterDescriptor("adapter:test", "Test GPU driver", "nvidia", "PCI\\VEN_10DE"),
        "DisplayPort", true, false, false, 8, 144);

    private sealed class WalkGamma : IWindowsGammaProvider
    {
        private readonly List<string> _calls;
        private readonly Dictionary<string, double> _values = new();
        private readonly double? _accepted;
        internal readonly List<double> Attempts = [];
        internal GammaRamp Current { get; private set; } = Identity();
        internal bool DiscardAcceptedWrite { get; init; }

        internal WalkGamma(List<string> calls, double brightness, double requested, double? accepted)
        {
            _calls = calls;
            _accepted = accepted;
            var value = requested;
            while (true)
            {
                _values[GammaRampTransform.Apply(Identity(), new GammaSettings(brightness, 50, value)).GetHash()] = value;
                if (value == 1) break;
                value = value > 1 ? Math.Max(1, Math.Round(value - 0.05, 10)) : Math.Min(1, Math.Round(value + 0.05, 10));
            }
        }

        public bool IsSupported(string windowsDisplayName) => true;
        public GammaRamp Read(string windowsDisplayName) { _calls.Add("gamma:read"); return Current; }
        public void Write(string windowsDisplayName, GammaRamp ramp)
        {
            if (ramp.GetHash() == Identity().GetHash() && (Attempts.Count == 0 || DiscardAcceptedWrite))
            { _calls.Add("gamma:restore"); Current = ramp; return; }
            if (ramp.GetHash() == Identity().GetHash() && !_values.ContainsKey(ramp.GetHash()))
            { _calls.Add("gamma:restore"); Current = ramp; return; }
            var value = _values[ramp.GetHash()];
            Attempts.Add(value);
            if (_accepted != value)
            {
                _calls.Add("gamma:reject");
                throw new GammaRampRejectedException(5, "SetDeviceGammaRamp failed for DISPLAY1.");
            }
            _calls.Add("gamma:accept");
            if (!DiscardAcceptedWrite) Current = ramp;
        }
    }

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
