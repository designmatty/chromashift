using System.ComponentModel;
using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Ipc;
using ChromaShift.DisplayService.Providers.Amd;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class HdrDisplaySafetyTests
{
    [Fact]
    public void RejectsSdrWritesWhileHdrIsActiveOnEveryAdapter()
    {
        foreach (var vendor in new[] { "nvidia", "amd", "intel", "unknown" })
        {
            Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(
                () => BaselineManager.EnsureSdrWritesSafe(Display(hdr: true, vendor: vendor))).Code);
            BaselineManager.EnsureSdrWritesSafe(Display(hdr: false, vendor: vendor));
        }
    }

    [Theory]
    [InlineData("nvidia", true)]
    [InlineData("amd", true)]
    [InlineData("intel", true)]
    [InlineData("unknown", true)]
    [InlineData("nvidia", false)]
    [InlineData("amd", false)]
    public void CaptureIsAllowedOnEveryAdapterAndRecordsTheColorMode(string vendor, bool hdr)
    {
        var fixture = new Fixture(vendor);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = hdr };
        var captured = fixture.Manager.Capture(fixture.Displays.Current.Id);
        Assert.Equal("captured", captured["state"]!.GetValue<string>());
        Assert.Equal(hdr ? "hdr" : "sdr", captured["colorMode"]!.GetValue<string>());
        Assert.Empty(fixture.Calls);
    }

    [Fact]
    public void NvidiaCaptureUnderHdrRecordsHdrModeReadsTheRampAndNeverRecaptures()
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        var captured = fixture.Manager.Capture(fixture.Displays.Current.Id);
        Assert.Equal("captured", captured["state"]!.GetValue<string>());
        Assert.Equal("hdr", captured["colorMode"]!.GetValue<string>());
        Assert.Equal(Ramp(250).GetHash(), captured["gammaRampHash"]!.GetValue<string>());
        Assert.Equal(43, captured["nvidiaSaturation"]!.GetValue<int>());
        fixture.Gamma.Current = Ramp(200);
        fixture.Nvidia.Current = new(Control(85), Control(40));
        var again = fixture.Manager.Capture(fixture.Displays.Current.Id);
        Assert.Equal("alreadyCaptured", again["state"]!.GetValue<string>());
        Assert.Equal(Ramp(250).GetHash(), again["gammaRampHash"]!.GetValue<string>());
        Assert.Equal(43, again["nvidiaSaturation"]!.GetValue<int>());
        Assert.Empty(fixture.Calls);
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void SdrCaptureRecordsSdrMode()
    {
        var fixture = new Fixture();
        var captured = fixture.Manager.Capture(fixture.Displays.Current.Id);
        Assert.Equal("sdr", captured["colorMode"]!.GetValue<string>());
    }

    [Fact]
    public void HdrApplyRestoresTheBaselineThenWritesSaturationAndHueWithReadBack()
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        var result = fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 75, 10, null));
        Assert.Equal(new[]
        {
            "gamma:write", "gamma:read", "nvidia:restore", "nvidia:read",
            "nvidia:setSaturation", "nvidia:readSaturation", "nvidia:setHue", "nvidia:readHue"
        }, fixture.Calls);
        Assert.Equal(new[] { Ramp(250).GetHash() }, fixture.Gamma.Writes);
        Assert.Equal(75, result["applied"]!["saturation"]!.GetValue<int>());
        Assert.Equal(36, result["applied"]!["hue"]!.GetValue<int>());
        Assert.Null(result["applied"]!["gammaRampHash"]);
        Assert.Equal(new NvidiaDisplayState(Control(75), Control(36)), fixture.Nvidia.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(1, fixture.Manager.Count);

        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Fact]
    public void HdrApplyAfterAnSdrEditRestoresTheSdrRampBeforeSaturation()
    {
        var fixture = new Fixture();
        fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(30, 50, 1, 85, null, null));
        Assert.NotEqual(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Calls.Clear();
        fixture.Gamma.Writes.Clear();
        fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 85, null, null));
        Assert.Equal(new[] { Ramp(250).GetHash() }, fixture.Gamma.Writes);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(85, fixture.Nvidia.Current.Saturation.Current);
        Assert.Equal(12, fixture.Nvidia.Current.Hue.Current);
    }

    public static TheoryData<double?, double?, double?, double?, double?, double?> RejectedHdrRequests => new()
    {
        { 30, null, null, 85, null, null },
        { null, 40, null, 85, null, null },
        { null, null, 1, 85, null, null },
        { null, null, null, 85, 0, 60 },
        { 30, 50, 1, 85, 0, null },
        { null, null, null, null, null, null }
    };

    [Theory]
    [MemberData(nameof(RejectedHdrRequests))]
    public void HdrApplyRejectsSdrOnlyFieldsAndEmptyRequestsBeforeCaptureOrAnyWrite(
        double? brightness, double? contrast, double? gamma, double? saturation, double? hue, double? colorTemperature)
    {
        foreach (var captured in new[] { false, true })
        {
            var fixture = new Fixture();
            if (captured) fixture.Manager.Capture(fixture.Displays.Current.Id);
            fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
            var settings = new DisplaySettings(brightness, contrast, gamma, saturation, hue, colorTemperature);
            Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(
                () => fixture.Manager.Apply(fixture.Displays.Current.Id, settings)).Code);
            Assert.Empty(fixture.Calls);
            Assert.Empty(fixture.Gamma.Writes);
            Assert.Equal(captured ? 1 : 0, fixture.Manager.Count);
        }
    }

    [Theory]
    [InlineData("intel")]
    [InlineData("unknown")]
    public void HdrApplyStaysBlockedForDisplaysWithoutAnHdrProvider(string vendor)
    {
        foreach (var captured in new[] { false, true })
        {
            var fixture = new Fixture(vendor);
            if (captured) fixture.Manager.Capture(fixture.Displays.Current.Id);
            fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
            Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
                fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 75, 10, null))).Code);
            Assert.Empty(fixture.Calls);
            Assert.Equal(captured ? 1 : 0, fixture.Manager.Count);
        }
    }

    [Fact]
    public void AmdHdrApplyRestoresTheBaselineThenWritesEveryAdlxControlWithoutATransformedRamp()
    {
        var fixture = new Fixture("amd");
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        var result = fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(60, 55, null, 40, 10, 70));
        Assert.Equal(new[]
        {
            "gamma:write", "gamma:read", "amd:restore", "amd:read",
            "amd:set:brightness", "amd:set:contrast", "amd:set:saturation", "amd:set:hue", "amd:set:colorTemperature"
        }, fixture.Calls);
        // The captured ramp is the only ramp write; ADLX carries every profile value.
        Assert.Equal([Ramp(250).GetHash()], fixture.Gamma.Writes);
        Assert.Null(result["applied"]!["gammaRampHash"]);
        Assert.Equal(60, result["applied"]!["brightness"]!.GetValue<int>());
        Assert.Equal(55, result["applied"]!["contrast"]!.GetValue<int>());
        Assert.Equal(40, result["applied"]!["saturation"]!.GetValue<int>());
        Assert.Equal(10, result["applied"]!["hue"]!.GetValue<int>());
        Assert.Equal(70, result["applied"]!["colorTemperature"]!.GetValue<int>());
        Assert.DoesNotContain(fixture.Calls, call => call.StartsWith("nvidia:set", StringComparison.Ordinal));

        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(0, fixture.Manager.Count);
    }

    public static TheoryData<double?, double?, double?, double?, double?, double?> RejectedAmdHdrRequests => new()
    {
        { null, null, 1, null, null, null },
        { 60, null, 1.2, null, null, null },
        { 60, 55, 0.8, 40, 10, 70 },
        { null, null, null, null, null, null }
    };

    [Theory]
    [MemberData(nameof(RejectedAmdHdrRequests))]
    public void AmdHdrApplyRejectsGammaAndEmptyRequestsBeforeCaptureOrAnyWrite(
        double? brightness, double? contrast, double? gamma, double? saturation, double? hue, double? colorTemperature)
    {
        foreach (var captured in new[] { false, true })
        {
            var fixture = new Fixture("amd");
            if (captured) fixture.Manager.Capture(fixture.Displays.Current.Id);
            fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
            var settings = new DisplaySettings(brightness, contrast, gamma, saturation, hue, colorTemperature);
            Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(
                () => fixture.Manager.Apply(fixture.Displays.Current.Id, settings)).Code);
            Assert.Empty(fixture.Calls);
            Assert.Empty(fixture.Gamma.Writes);
            Assert.Equal(captured ? 1 : 0, fixture.Manager.Count);
        }
    }

    [Fact]
    public void AmdHdrApplyAfterAnSdrEditRestoresTheSdrRampAndAdlxValuesFirst()
    {
        var fixture = new Fixture("amd");
        fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(30, 50, 1.2, 85, null, null));
        Assert.NotEqual(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Calls.Clear();
        fixture.Gamma.Writes.Clear();
        fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(30, null, null, null, null, null));
        Assert.Equal([Ramp(250).GetHash()], fixture.Gamma.Writes);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.True(fixture.Calls.IndexOf("amd:restore") < fixture.Calls.IndexOf("amd:set:brightness"));
        Assert.Equal(30, fixture.Amd.Current.Brightness.Current);
        // Saturation was not requested under HDR, so it is back at its captured value.
        Assert.Equal(fixture.Amd.Baseline.Saturation, fixture.Amd.Current.Saturation);
    }

    [Fact]
    public void AmdCaptureUnderHdrRecordsHdrModeAndTheAdlxOriginals()
    {
        var fixture = new Fixture("amd");
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        var captured = fixture.Manager.Capture(fixture.Displays.Current.Id);
        Assert.Equal("hdr", captured["colorMode"]!.GetValue<string>());
        Assert.Equal(47, captured["amdBrightness"]!.GetValue<int>());
        Assert.Equal(51, captured["amdColorTemperature"]!.GetValue<int>());
        fixture.Amd.Current = fixture.Amd.Baseline with { Brightness = Control(10) };
        Assert.Equal("alreadyCaptured", fixture.Manager.Capture(fixture.Displays.Current.Id)["state"]!.GetValue<string>());
        Assert.Equal(1, fixture.Manager.Count);
        Assert.Empty(fixture.Calls);
    }

    [Fact]
    public void AmdControlUnreadableAtCaptureStaysUnwritableUnderHdr()
    {
        var fixture = new Fixture("amd");
        fixture.Amd.Current = fixture.Amd.Baseline with { Contrast = Unsupported };
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Amd.Current = fixture.Amd.Baseline;
        Assert.Equal("CAPABILITY_UNSUPPORTED", Assert.Throws<DisplayOperationException>(() =>
            fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(60, 55, null, null, null, null))).Code);
        Assert.Empty(fixture.Calls);
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Theory]
    [InlineData("brightness")]
    [InlineData("colorTemperature")]
    public void FailedAdlxWriteUnderHdrRestoresTheWholeDisplay(string failing)
    {
        var fixture = new Fixture("amd");
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Amd.FailSet = failing;
        Assert.Equal("AMD_VERIFY_FAILED", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(60, 55, null, 40, 10, 70))).Code);
        // Baseline-first restore, the failed write, then whole-display restoration.
        Assert.Equal(2, fixture.Calls.Count(call => call == "amd:restore"));
        Assert.Equal("amd:read", fixture.Calls[^1]);
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void RestoreAllAfterAnAmdHdrApplyReturnsTheCapturedValues()
    {
        var fixture = new Fixture("amd");
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(60, null, null, 40, null, null));
        fixture.Manager.RestoreAll(failOnError: true, discardDisconnected: true);
        Assert.Equal(0, fixture.Manager.Count);
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
    }

    [Theory]
    [InlineData("saturation")]
    [InlineData("hue")]
    public void HdrApplyOfAnUnsupportedNvidiaControlFailsBeforeAnyWrite(string control)
    {
        var fixture = new Fixture();
        fixture.Nvidia.Current = control == "saturation"
            ? new(Unsupported, Control(12))
            : new(Control(43), Unsupported);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        var settings = control == "saturation"
            ? new DisplaySettings(null, null, null, 75, null, null)
            : new DisplaySettings(null, null, null, null, 10, null);
        Assert.Equal("CAPABILITY_UNSUPPORTED", Assert.Throws<DisplayOperationException>(
            () => fixture.Manager.Apply(fixture.Displays.Current.Id, settings)).Code);
        Assert.Empty(fixture.Calls);
    }

    [Theory]
    [InlineData("saturationWrite", "COMMAND_FAILED")]
    [InlineData("saturationReadBack", "NVIDIA_VERIFY_FAILED")]
    [InlineData("hueReadBack", "NVIDIA_VERIFY_FAILED")]
    public void FailedNvidiaWriteOrReadBackUnderHdrRestoresTheWholeDisplay(string failure, string code)
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Nvidia.FailSaturationWrite = failure == "saturationWrite";
        fixture.Nvidia.IgnoreSaturationWrite = failure == "saturationReadBack";
        fixture.Nvidia.IgnoreHueWrite = failure == "hueReadBack";
        var exception = Assert.ThrowsAny<Exception>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 75, 10, null)));
        Assert.Equal(code, exception is DisplayOperationException operation ? operation.Code : "COMMAND_FAILED");
        // Baseline-first restore, the failed write, then whole-display restoration.
        Assert.Equal(2, fixture.Calls.Count(call => call == "nvidia:restore"));
        Assert.Equal(2, fixture.Calls.Count(call => call == "gamma:write"));
        Assert.Equal("nvidia:read", fixture.Calls[^1]);
        Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void BaselineRestoreFailureInsideHdrApplyIsARestoreFailure()
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Nvidia.FailVerify = true;
        Assert.Equal("BASELINE_RESTORE_FAILED", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 75, null, null))).Code);
        Assert.DoesNotContain("nvidia:setSaturation", fixture.Calls);
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void UnconfirmedCleanupAfterAFailedNvidiaWriteIsARestoreFailure(bool hdr)
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = hdr };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Nvidia.MismatchSaturationReadBack = true;
        fixture.Nvidia.FailCleanupRestore = true;
        var settings = hdr
            ? new DisplaySettings(null, null, null, 85, null, null)
            : new DisplaySettings(30, 50, 1, 85, null, null);
        var error = Assert.Throws<DisplayOperationException>(
            () => fixture.Manager.Apply(fixture.Displays.Current.Id, settings));
        Assert.Equal("BASELINE_RESTORE_FAILED", error.Code);
        Assert.Contains("NVIDIA_VERIFY_FAILED", error.Message);
        // The profile value is still on screen, and ownership stays for Retry.
        Assert.Equal(85, fixture.Nvidia.Current.Saturation.Current);
        Assert.Equal(1, fixture.Manager.Count);

        fixture.Nvidia.FailCleanupRestore = false;
        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Fact]
    public void FailedCleanupOnADisplayThatDisconnectedKeepsItsBaselineForReconnect()
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Nvidia.MismatchSaturationReadBack = true;
        fixture.Nvidia.FailCleanupRestore = true;
        fixture.Gamma.BeforeWrite = _ =>
        {
            // The display leaves while the cleanup restore runs.
            if (fixture.Calls.Contains("nvidia:setSaturation")) fixture.Displays.Connected = false;
        };
        Assert.Equal("DISPLAY_NOT_FOUND", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 85, null, null))).Code);
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void SdrApplyRefusesTheTransformedRampWhenHdrTurnsOnDuringTheBaselineRestore()
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        var baselineHash = Ramp(250).GetHash();
        var transformedUnderHdr = 0;
        fixture.Gamma.BeforeWrite = ramp =>
        {
            if (ramp.GetHash() != baselineHash && fixture.Displays.Current.Hdr) transformedUnderHdr++;
            // Windows turns HDR on while the baseline-first restore is written.
            if (ramp.GetHash() == baselineHash)
                fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        };
        Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(30, 50, 1, 85, null, null))).Code);
        Assert.Equal(0, transformedUnderHdr);
        Assert.All(fixture.Gamma.Writes, hash => Assert.Equal(baselineHash, hash));
        Assert.Equal(baselineHash, fixture.Gamma.Current.GetHash());
        Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void SdrApplyRefusesARejectedRampRetryOnceHdrIsOn()
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        var baselineHash = Ramp(250).GetHash();
        var transformedWrites = 0;
        var transformedUnderHdr = 0;
        fixture.Gamma.BeforeWrite = ramp =>
        {
            if (ramp.GetHash() == baselineHash) return;
            transformedWrites++;
            if (fixture.Displays.Current.Hdr) transformedUnderHdr++;
            // The driver rejects the first ramp, and HDR turns on before the retry.
            fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
            throw new GammaRampRejectedException(5, "SetDeviceGammaRamp failed for DISPLAY1.");
        };
        Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(50, 50, 1.5, null, null, null))).Code);
        Assert.Equal(1, transformedWrites);
        Assert.Equal(0, transformedUnderHdr);
        Assert.Equal(baselineHash, fixture.Gamma.Current.GetHash());
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void OwnershipChangeFoundBeforeTheTransformedRampWritesNothingAfterDetection()
    {
        var fixture = new Fixture();
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        var enumerations = 0;
        var callsAtDetection = -1;
        fixture.Displays.AfterList = () =>
        {
            enumerations++;
            // Apply's own enumeration still matches; a dock or GPU routing change
            // then gives the pre-ramp enumeration a different adapter.
            if (enumerations == 1)
                fixture.Displays.Current = fixture.Displays.Current with
                {
                    Adapter = fixture.Displays.Current.Adapter with { DeviceId = "PCI\\VEN_10DE&DEV_OTHER" }
                };
            if (enumerations == 2) callsAtDetection = fixture.Calls.Count;
        };
        Assert.Equal("BASELINE_OWNERSHIP_CHANGED", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(30, 50, 1, 85, null, null))).Code);
        Assert.True(callsAtDetection >= 0);
        Assert.DoesNotContain(fixture.Calls.Skip(callsAtDetection),
            call => call is "gamma:write" or "nvidia:restore" or "nvidia:setSaturation");
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void CleanupRefusesToWriteThroughADescriptorWithADifferentOwner()
    {
        var fixture = new Fixture();
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Nvidia.MismatchSaturationReadBack = true;
        var enumerations = 0;
        var callsAtDetection = -1;
        fixture.Displays.AfterList = () =>
        {
            enumerations++;
            if (enumerations == 1)
                fixture.Displays.Current = fixture.Displays.Current with
                {
                    Adapter = fixture.Displays.Current.Adapter with { DeviceId = "PCI\\VEN_10DE&DEV_OTHER" }
                };
            if (enumerations == 2) callsAtDetection = fixture.Calls.Count;
        };
        var error = Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 85, null, null)));
        Assert.Equal("BASELINE_OWNERSHIP_CHANGED", error.Code);
        Assert.Contains("NVIDIA_VERIFY_FAILED", error.Message);
        // The cleanup's fresh enumeration is the second one; nothing is written after it.
        Assert.True(callsAtDetection >= 0);
        Assert.DoesNotContain(fixture.Calls.Skip(callsAtDetection),
            call => call is "gamma:write" or "nvidia:restore");
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void SdrApplyFailsClosedWhenHdrTurnsOnBeforeItsFirstCapture()
    {
        var fixture = new Fixture();
        // The first enumeration is SDR; the capture's re-enumeration sees HDR.
        fixture.Displays.AfterList = () => fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        Assert.Equal("HDR_UNSAFE", Assert.Throws<DisplayOperationException>(() => fixture.Manager.Apply(
            fixture.Displays.Current.Id, new DisplaySettings(30, 50, 1, 85, null, null))).Code);
        Assert.Empty(fixture.Calls);
        Assert.Equal(0, fixture.Manager.Count);
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
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void RestoreAllIncludesHdrForLifecycleExitAndStrictShutdown(bool explicitShutdown, bool appliedUnderHdr)
    {
        var fixture = new Fixture();
        if (appliedUnderHdr)
        {
            fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
            fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 85, 10, null));
        }
        else fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Gamma.Current = Ramp(200);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        // The lifecycle finally uses RestoreAll(); service.shutdown uses strict flags.
        // No real helper or Windows provider is started by this test.
        var result = fixture.Manager.RestoreAll(
            failOnError: explicitShutdown, discardDisconnected: explicitShutdown);
        Assert.True(result["displays"]![0]!["restored"]!.GetValue<bool>());
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
        Assert.Equal(0, fixture.Manager.Count);
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
        var fixture = new Fixture("amd");
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Restored);
        // The captured Windows ramp is the only ramp write, with read-back, then ADLX restores.
        Assert.Equal(new[] { "gamma:write", "gamma:read", "amd:restore", "amd:read" }, fixture.Calls);
        Assert.Equal([Ramp(250).GetHash()], fixture.Gamma.Writes);
        Assert.Equal(0, fixture.Manager.Count);
    }

    [Theory]
    [InlineData("write", false)]
    [InlineData("colorReadBack", false)]
    [InlineData("gammaReadBack", false)]
    [InlineData("write", true)]
    [InlineData("colorReadBack", true)]
    [InlineData("gammaReadBack", true)]
    public void AmdHdrRestoreFailureRetainsCapturedOwnershipAndRetries(string failure, bool restoreAll)
    {
        var fixture = new Fixture("amd");
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Amd.Current = fixture.Amd.Baseline with { Brightness = Control(22) };
        fixture.Gamma.Current = Ramp(200);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        fixture.Amd.FailWrite = failure == "write";
        fixture.Amd.IgnoreColorWrite = failure == "colorReadBack";
        fixture.Gamma.IgnoreWrite = failure == "gammaReadBack";
        Assert.Equal("BASELINE_RESTORE_FAILED", Assert.Throws<DisplayOperationException>(() =>
        {
            if (restoreAll) fixture.Manager.RestoreAll(failOnError: true);
            else fixture.Manager.Restore(fixture.Displays.Current.Id);
        }).Code);
        Assert.Equal(1, fixture.Manager.Count);
        Assert.Contains("amd:restore", fixture.Calls);
        if (failure != "write") Assert.Contains("amd:read", fixture.Calls);
        fixture.Amd.FailWrite = fixture.Amd.IgnoreColorWrite = fixture.Gamma.IgnoreWrite = false;
        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(0, fixture.Manager.Count);
        Assert.Equal(fixture.Amd.Baseline.Brightness, fixture.Amd.Current.Brightness);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Restored);
    }

    [Fact]
    public void AmdSdrCaptureRecordsTheWindowsRamp()
    {
        var fixture = new Fixture("amd");
        var captured = fixture.Manager.Capture(fixture.Displays.Current.Id);
        Assert.Equal(Ramp(250).GetHash(), captured["gammaRampHash"]!.GetValue<string>());
        Assert.Equal(47, captured["amdBrightness"]!.GetValue<int>());
        Assert.Empty(fixture.Calls);
    }

    [Fact]
    public void AmdSdrApplyUsesAdlxForBrightnessAndContrastAndTheWindowsRampForGammaOnly()
    {
        var fixture = new Fixture("amd");
        var result = fixture.Manager.Apply(
            fixture.Displays.Current.Id,
            new DisplaySettings(60, 55, 1.2, 55, 10, 60));

        var expected = GammaRampTransform.Apply(Ramp(250), new GammaSettings(null, null, 1.2));
        Assert.Equal([Ramp(250).GetHash(), expected.GetHash()], fixture.Gamma.Writes);
        Assert.Equal(expected.GetHash(), result["applied"]!["gammaRampHash"]!.GetValue<string>());
        Assert.Equal(60, result["applied"]!["brightness"]!.GetValue<int>());
        Assert.Equal(55, result["applied"]!["contrast"]!.GetValue<int>());
        Assert.Contains("amd:set:brightness", fixture.Calls);
        Assert.Contains("amd:set:contrast", fixture.Calls);
        Assert.Contains("amd:set:saturation", fixture.Calls);
        Assert.Contains("amd:set:hue", fixture.Calls);
        Assert.Contains("amd:set:colorTemperature", fixture.Calls);

        fixture.Manager.Restore(fixture.Displays.Current.Id);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Current);
    }

    [Fact]
    public void AmdControlUnreadableAtCaptureStaysUnwritableAfterAdlxRecovers()
    {
        var fixture = new Fixture("amd");
        fixture.Amd.Current = new(Unsupported, Unsupported, Unsupported, Unsupported, Unsupported);
        fixture.Manager.Capture(fixture.Displays.Current.Id);
        fixture.Amd.Current = fixture.Amd.Baseline;

        Assert.Equal("CAPABILITY_UNSUPPORTED", Assert.Throws<DisplayOperationException>(() =>
            fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(65, null, 1.2, null, null, null))).Code);
        Assert.DoesNotContain(fixture.Calls, call => call.StartsWith("amd:set", StringComparison.Ordinal));
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
        Assert.Equal(1, fixture.Manager.Count);
    }

    [Fact]
    public void AmdSdrApplyWritesEveryAdlxControlBeforeTheRampSoNoneFollowsTheLastHdrCheck()
    {
        var fixture = new Fixture("amd");
        var transformed = GammaRampTransform.Apply(Ramp(250), new GammaSettings(null, null, 1.2)).GetHash();
        fixture.Gamma.BeforeWrite = ramp =>
        {
            // HDR turns on while the transformed ramp is being written.
            if (ramp.GetHash() == transformed)
                fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        };

        fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(60, 55, 1.2, 55, 10, 60));

        var transformedWrite = fixture.Calls.LastIndexOf("gamma:write");
        Assert.True(transformedWrite > 0);
        Assert.DoesNotContain(
            fixture.Calls.Skip(transformedWrite),
            call => call.StartsWith("amd:set", StringComparison.Ordinal));
        Assert.Equal(5, fixture.Calls.Count(call => call.StartsWith("amd:set", StringComparison.Ordinal)));
    }

    [Fact]
    public void AmdSdrApplyWithoutGammaWritesOnlyTheBaselineRamp()
    {
        var fixture = new Fixture("amd");
        var result = fixture.Manager.Apply(
            fixture.Displays.Current.Id,
            new DisplaySettings(60, 55, null, null, null, null));

        Assert.Equal([Ramp(250).GetHash()], fixture.Gamma.Writes);
        Assert.Null(result["applied"]!["gammaRampHash"]);
        Assert.Equal(60, result["applied"]!["brightness"]!.GetValue<int>());
    }

    [Fact]
    public void AmdSdrGammaReadBackFailureRestoresTheWholeDisplay()
    {
        var fixture = new Fixture("amd");
        fixture.Gamma.BeforeWrite = ramp =>
        {
            if (ramp.GetHash() != Ramp(250).GetHash()) fixture.Gamma.IgnoreWrite = true;
        };
        Assert.Equal("GAMMA_VERIFY_FAILED", Assert.Throws<DisplayOperationException>(() =>
            fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(60, null, 1.2, null, null, null))).Code);
        Assert.Equal(fixture.Amd.Baseline, fixture.Amd.Current);
        Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
    }

    [Theory]
    [InlineData("eof", false)]
    [InlineData("parentExit", false)]
    [InlineData("watchdog", false)]
    [InlineData("eof", true)]
    [InlineData("parentExit", true)]
    [InlineData("watchdog", true)]
    public async Task ProductionLifecycleRouteRestoresHdrBaseline(string route, bool appliedUnderHdr)
    {
        var fixture = new Fixture();
        if (appliedUnderHdr)
        {
            // Start in HDR: capture under HDR, then an HDR saturation/hue apply.
            fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
            fixture.Manager.Apply(fixture.Displays.Current.Id, new DisplaySettings(null, null, null, 85, 10, null));
            Assert.Equal(85, fixture.Nvidia.Current.Saturation.Current);
        }
        else
        {
            fixture.Manager.Capture(fixture.Displays.Current.Id);
            fixture.Nvidia.Current = new(Control(85), Control(40));
        }
        fixture.Gamma.Current = Ramp(200);
        fixture.Displays.Current = fixture.Displays.Current with { Hdr = true };
        using var output = new StringWriter();
        // The input thread blocks until released; no helper, processes or real providers run.
        using var releaseInput = new ManualResetEventSlim(route == "eof");
        using var inputRead = new ManualResetEventSlim();
        var input = new ProtocolInputReader(new GatedInput(releaseInput, inputRead));
        using var watchdog = new HeartbeatWatchdog(TimeSpan.FromSeconds(10), (handles, timeout) =>
            timeout is null ? WaitHandle.WaitAny(handles) : WaitHandle.WaitTimeout);
        if (route == "watchdog") watchdog.RecordHeartbeat();
        var lifecycle = new ServiceLifecycle(input, watchdog, fixture.Manager, new ProtocolWriter(output));
        try
        {
            await lifecycle.RunAsync(
                _ => throw new InvalidOperationException("Unexpected command"),
                () => false,
                route == "parentExit" ? Task.CompletedTask : null).WaitAsync(TestContext.Current.CancellationToken);
            Assert.Equal(0, fixture.Manager.Count);
            Assert.Equal(Ramp(250).GetHash(), fixture.Gamma.Current.GetHash());
            Assert.Equal(new NvidiaDisplayState(Control(43), Control(12)), fixture.Nvidia.Current);
            Assert.Contains("service.baselinesRestored", output.ToString());
            Assert.Contains("\"restored\":true", output.ToString());
        }
        finally
        {
            releaseInput.Set();
            Assert.True(inputRead.Wait(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        }
    }

    private sealed class GatedInput(ManualResetEventSlim release, ManualResetEventSlim read) : TextReader
    {
        public override string? ReadLine()
        {
            release.Wait();
            read.Set();
            return null;
        }
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
        internal Fixture(string vendor = "nvidia")
        {
            Displays = new(Display(hdr: false, vendor));
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
        /// <summary>Runs after each enumeration, to model a change between two reads.</summary>
        internal Action? AfterList;
        public IReadOnlyList<DisplayDescriptor> List()
        {
            IReadOnlyList<DisplayDescriptor> result = Connected ? [Current] : [];
            AfterList?.Invoke();
            return result;
        }
    }

    private sealed class FakeGamma(List<string> calls) : IWindowsGammaProvider
    {
        internal GammaRamp Current = Ramp(250);
        internal readonly List<string> Writes = [];
        internal bool FailWrite;
        internal bool IgnoreWrite;
        public bool IsSupported(string name) => true;
        public GammaRamp Read(string name)
        {
            if (calls.Contains("gamma:write")) calls.Add("gamma:read");
            return Current;
        }
        /// <summary>Runs before each write; it may change the registry or reject the ramp.</summary>
        internal Action<GammaRamp>? BeforeWrite;
        public void Write(string name, GammaRamp ramp)
        {
            calls.Add("gamma:write");
            Writes.Add(ramp.GetHash());
            BeforeWrite?.Invoke(ramp);
            if (FailWrite) throw new Win32Exception("write failed");
            if (!IgnoreWrite) Current = ramp;
        }
    }

    /// <summary>Mirrors NvidiaColorProvider: map, write, read back, and fail on mismatch.</summary>
    private sealed class FakeNvidia(List<string> calls) : INvidiaColorProvider
    {
        internal NvidiaDisplayState Current = new(Control(43), Control(12));
        internal bool FailVerify;
        internal bool FailSaturationWrite;
        internal bool IgnoreSaturationWrite;
        /// <summary>The write takes, but read-back reports a different value.</summary>
        internal bool MismatchSaturationReadBack;
        internal bool FailCleanupRestore;
        internal bool IgnoreHueWrite;
        public NvidiaDisplayState GetState(DisplayDescriptor display) => display.Adapter.Vendor == "nvidia" ? Current : new(Unsupported, Unsupported);
        public int SetSaturation(DisplayDescriptor display, double value)
        {
            calls.Add("nvidia:setSaturation");
            if (FailSaturationWrite) throw new InvalidOperationException("NVAPI saturation write failed");
            var target = (int)Math.Round(value);
            if (!IgnoreSaturationWrite) Current = Current with { Saturation = Current.Saturation with { Current = target } };
            calls.Add("nvidia:readSaturation");
            if (Current.Saturation.Current != target || MismatchSaturationReadBack)
                throw new DisplayOperationException("NVIDIA_VERIFY_FAILED", "saturation read-back mismatch");
            return target;
        }
        public int SetHue(DisplayDescriptor display, double value)
        {
            calls.Add("nvidia:setHue");
            var target = (int)Math.Round(value / 100 * 359);
            if (!IgnoreHueWrite) Current = Current with { Hue = Current.Hue with { Current = target } };
            calls.Add("nvidia:readHue");
            if (Current.Hue.Current != target)
                throw new DisplayOperationException("NVIDIA_VERIFY_FAILED", "hue read-back mismatch");
            return target;
        }
        public void Restore(DisplayDescriptor display, NvidiaDisplayState baseline)
        {
            calls.Add("nvidia:restore");
            if (FailCleanupRestore && calls.Any(call => call.StartsWith("nvidia:set", StringComparison.Ordinal)))
            {
                // The cleanup write does not take; the profile value stays on screen.
                calls.Add("nvidia:read");
                throw new DisplayOperationException("NVIDIA_RESTORE_FAILED", "cleanup read-back mismatch");
            }
            Current = baseline;
            calls.Add("nvidia:read");
            if (FailVerify) throw new DisplayOperationException("NVIDIA_RESTORE_FAILED", "read-back mismatch");
        }
    }

    private sealed class FakeAmd : IAmdColorProvider
    {
        private readonly List<string> calls;
        internal readonly AmdDisplayState Baseline = new(Control(47), Control(48), Control(43), Control(12), Control(51));
        internal AmdDisplayState Current;
        internal FakeAmd(List<string> calls)
        {
            this.calls = calls;
            Current = Baseline;
        }
        internal AmdDisplayState? Restored;
        internal bool FailWrite;
        internal bool IgnoreColorWrite;
        /// <summary>The named setter writes, then its read-back fails, as AmdAdlxProvider reports.</summary>
        internal string? FailSet;
        public AmdDisplayState GetState(DisplayDescriptor display) => display.Adapter.Vendor == "amd" ? Current : new(Unsupported, Unsupported, Unsupported, Unsupported, Unsupported);
        public int SetBrightness(DisplayDescriptor display, double value) =>
            Set("brightness", value, target => Current = Current with { Brightness = Control(target) });
        public int SetContrast(DisplayDescriptor display, double value) =>
            Set("contrast", value, target => Current = Current with { Contrast = Control(target) });
        public int SetSaturation(DisplayDescriptor display, double value) =>
            Set("saturation", value, target => Current = Current with { Saturation = Control(target) });
        public int SetHue(DisplayDescriptor display, double value) =>
            Set("hue", value, target => Current = Current with { Hue = Control(target) });
        public int SetColorTemperature(DisplayDescriptor display, double value) =>
            Set("colorTemperature", value, target => Current = Current with { ColorTemperature = Control(target) });
        private int Set(string name, double value, Action<int> write)
        {
            calls.Add($"amd:set:{name}");
            var target = (int)Math.Round(value);
            write(target);
            if (FailSet == name) throw new DisplayOperationException("AMD_VERIFY_FAILED", $"{name} read-back mismatch");
            return target;
        }
        public void Restore(DisplayDescriptor display, AmdDisplayState baseline)
        {
            calls.Add("amd:restore");
            if (FailWrite) throw new DisplayOperationException("AMD_RESTORE_FAILED", "write failed");
            Current = baseline with { Brightness = IgnoreColorWrite ? Current.Brightness : baseline.Brightness };
            calls.Add("amd:read");
            if (Current != baseline)
            {
                throw new DisplayOperationException("AMD_RESTORE_FAILED", "read-back mismatch");
            }
            Restored = baseline;
        }
    }

    internal static DisplayDescriptor Display(bool hdr, string vendor = "nvidia") =>
        new(
            "display:test",
            "display:test",
            "Test display",
            "\\\\.\\DISPLAY1",
            "monitor-path",
            "TST",
            "0001",
            "serial",
            new DisplayAdapterDescriptor("adapter", "Test adapter", vendor, "PCI\\VEN_10DE"),
            "DisplayPort",
            true,
            hdr,
            true,
            10,
            240);
}
