using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Amd;
using System.ComponentModel;
using System.Text.Json.Nodes;
using ChromaShift.DisplayService.Ipc;

namespace ChromaShift.DisplayService.Services;

internal sealed class BaselineManager(
    DisplayRegistry displays,
    WindowsGammaProvider gamma,
    NvidiaColorProvider nvidia,
    AmdAdlxProvider amd)
{
    private readonly Dictionary<string, BaselineEntry> _baselines = new(StringComparer.Ordinal);
    private readonly Lock _sync = new();

    internal JsonObject Capture(string displayId)
    {
        lock (_sync)
        {
            var display = FindDisplay(displayId);
            EnsureDisplayWritesSafe(display);
            if (_baselines.TryGetValue(displayId, out var existing))
            {
                return Describe(existing, "alreadyCaptured");
            }

            var ramp = display.Adapter.Vendor != "amd" && gamma.IsSupported(display.WindowsDisplayName)
                ? ReadGamma(display)
                : null;
            var nvidiaState = nvidia.GetState(display);
            var amdState = amd.GetState(display);
            if (ramp is null && !nvidiaState.Saturation.Supported && !nvidiaState.Hue.Supported && !HasAmdCapability(amdState))
            {
                throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", $"No controllable capabilities were found for {display.Name}.");
            }
            var entry = new BaselineEntry(
                new BaselineOwner(display.Id, display.Adapter.Vendor, display.Adapter.DeviceId),
                display.WindowsDisplayName,
                ramp,
                nvidiaState,
                amdState);
            _baselines.Add(display.Id, entry);
            Log("BaselineCaptured", display, ramp?.GetHash());
            return Describe(entry, "captured");
        }
    }

    internal JsonObject ReadState(string displayId)
    {
        lock (_sync)
        {
            var display = FindDisplay(displayId);
            if (display.Adapter.Vendor == "amd")
            {
                var state = amd.GetState(display);
                return new JsonObject
                {
                    ["displayId"] = displayId,
                    ["provider"] = "amd",
                    ["gammaRampHash"] = state.GammaRamp?.GetHash(),
                    ["brightness"] = state.Brightness.Current,
                    ["contrast"] = state.Contrast.Current,
                    ["saturation"] = state.Saturation.Current,
                    ["hue"] = state.Hue.Current,
                    ["colorTemperature"] = state.ColorTemperature.Current
                };
            }
            EnsureGammaSafe(display);
            var ramp = ReadGamma(display);
            return new JsonObject
            {
                ["displayId"] = displayId,
                ["provider"] = "windows",
                ["gammaRamp"] = NativeJson.ToNode(ramp),
                ["gammaRampHash"] = ramp.GetHash()
            };
        }
    }

    internal JsonObject Apply(string displayId, DisplaySettings settings)
    {
        lock (_sync)
        {
            var display = FindDisplay(displayId);
            if (display.Hdr && HasAnySetting(settings))
            {
                throw new DisplayOperationException(
                    "HDR_UNSAFE",
                    $"Display writes are disabled while HDR is active on {display.Name}; HDR provider behavior has not been validated.");
            }
            if (!_baselines.TryGetValue(displayId, out var baseline))
            {
                _ = Capture(displayId);
                baseline = _baselines[displayId];
            }
            EnsureBaselineOwnership(display, baseline);

            try
            {
                // Every request represents the complete product-level state for this
                // display. Restore first so settings omitted from a later profile or
                // live-preview update do not inherit values from the previous request.
                RestoreEntry(display, baseline);

                string? gammaHash = null;
                int? brightness = null;
                int? contrast = null;
                int? colorTemperature = null;
                if (display.Adapter.Vendor == "amd")
                {
                    if (settings.Brightness is not null) brightness = amd.SetBrightness(display, settings.Brightness.Value);
                    if (settings.Contrast is not null) contrast = amd.SetContrast(display, settings.Contrast.Value);
                    if (settings.Gamma is not null)
                    {
                        if (baseline.Amd.GammaRamp is null) throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", baseline.Amd.GammaReason ?? "AMD gamma is unavailable.");
                        gammaHash = amd.SetGamma(display, baseline.Amd.GammaRamp, settings.Gamma.Value);
                    }
                }
                else if (settings.Brightness is not null || settings.Contrast is not null || settings.Gamma is not null)
                {
                    EnsureGammaSafe(display);
                    if (baseline.GammaRamp is null)
                    {
                        throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "Windows gamma controls are unavailable for this display.");
                    }
                    var requested = GammaRampTransform.Apply(
                        baseline.GammaRamp,
                        new GammaSettings(settings.Brightness, settings.Contrast, settings.Gamma));
                    WriteAndVerify(display, requested);
                    gammaHash = requested.GetHash();
                }

                int? saturation = null;
                if (settings.Saturation is not null)
                {
                    if (display.Adapter.Vendor == "amd")
                    {
                        saturation = amd.SetSaturation(display, settings.Saturation.Value);
                    }
                    else if (!baseline.Nvidia.Saturation.Supported)
                    {
                        throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "NVIDIA saturation is unavailable for this display.");
                    }
                    else saturation = nvidia.SetSaturation(display, settings.Saturation.Value);
                }

                int? hue = null;
                if (settings.Hue is not null)
                {
                    if (display.Adapter.Vendor == "amd")
                    {
                        hue = amd.SetHue(display, settings.Hue.Value);
                    }
                    else if (!baseline.Nvidia.Hue.Supported)
                    {
                        throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "NVIDIA hue is unavailable for this display.");
                    }
                    else hue = nvidia.SetHue(display, settings.Hue.Value);
                }

                if (settings.ColorTemperature is not null)
                {
                    if (display.Adapter.Vendor != "amd") throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "Color temperature has no verified provider for this display.");
                    colorTemperature = amd.SetColorTemperature(display, settings.ColorTemperature.Value);
                }

                Log("DisplaySettingApplied", display, gammaHash);
                return new JsonObject
                {
                    ["displayId"] = displayId,
                    ["settings"] = NativeJson.ToNode(settings),
                    ["applied"] = new JsonObject
                    {
                        ["gammaRampHash"] = gammaHash,
                        ["brightness"] = brightness,
                        ["contrast"] = contrast,
                        ["saturation"] = saturation,
                        ["hue"] = hue,
                        ["colorTemperature"] = colorTemperature
                    }
                };
            }
            catch (ArgumentOutOfRangeException exception)
            {
                TryRestoreAfterFailedApply(display, baseline);
                throw new DisplayOperationException("VALUE_OUT_OF_RANGE", exception.Message, exception);
            }
            catch
            {
                TryRestoreAfterFailedApply(display, baseline);
                throw;
            }
        }
    }

    internal JsonObject Restore(string displayId)
    {
        lock (_sync)
        {
            if (!_baselines.TryGetValue(displayId, out var baseline))
            {
                return RestoreResult(displayId, restored: false, reason: "baselineNotCaptured");
            }

            var display = FindDisplay(displayId);
            EnsureBaselineOwnership(display, baseline);
            RestoreEntry(display, baseline);
            _baselines.Remove(displayId);
            Log("BaselineRestored", display, baseline.GammaRamp?.GetHash());
            return RestoreResult(displayId, restored: true, gammaRampHash: baseline.GammaRamp?.GetHash());
        }
    }

    internal JsonObject RestoreAll(bool failOnError = false, bool discardDisconnected = false)
    {
        lock (_sync)
        {
            var results = new JsonArray();
            var failures = new List<string>();
            foreach (var displayId in _baselines.Keys.ToArray())
            {
                try
                {
                    var display = FindDisplay(displayId);
                    if (display.Hdr)
                    {
                        results.Add((JsonNode?)RestoreResult(displayId, restored: false, reason: "hdrActive"));
                        failures.Add($"{displayId}: restoration is deferred while HDR is active");
                        NativeLog.Write(new JsonObject
                        {
                            ["level"] = "information",
                            ["eventName"] = "BaselineRestoreDeferred",
                            ["displayId"] = displayId,
                            ["reason"] = "hdrActive"
                        });
                        continue;
                    }
                    results.Add((JsonNode?)Restore(displayId));
                }
                catch (DisplayOperationException exception)
                {
                    if (TryDiscardDisconnectedBaseline(displayId, discardDisconnected, results)) continue;
                    results.Add((JsonNode?)RestoreResult(
                        displayId,
                        restored: false,
                        code: exception.Code,
                        error: exception.Message));
                    failures.Add($"{displayId}: {exception.Message}");
                    NativeLog.Write(new JsonObject
                    {
                        ["level"] = "critical",
                        ["eventName"] = "BaselineRestoreFailed",
                        ["displayId"] = displayId,
                        ["code"] = exception.Code,
                        ["message"] = exception.Message
                    });
                }
                catch (Exception exception)
                {
                    if (TryDiscardDisconnectedBaseline(displayId, discardDisconnected, results)) continue;
                    results.Add((JsonNode?)RestoreResult(displayId, restored: false, error: exception.Message));
                    failures.Add($"{displayId}: {exception.Message}");
                    NativeLog.Write(new JsonObject
                    {
                        ["level"] = "critical",
                        ["eventName"] = "BaselineRestoreFailed",
                        ["displayId"] = displayId,
                        ["message"] = exception.Message
                    });
                }
            }
            if (failOnError && failures.Count > 0)
            {
                throw new DisplayOperationException("BASELINE_RESTORE_FAILED", string.Join("; ", failures));
            }
            return new JsonObject { ["displays"] = results };
        }
    }

    internal bool HasBaseline(string displayId)
    {
        lock (_sync) return _baselines.ContainsKey(displayId);
    }

    internal static bool ShouldDiscardDisconnectedBaseline(bool discardDisconnected, bool connected) =>
        discardDisconnected && !connected;

    internal int Count
    {
        get { lock (_sync) return _baselines.Count; }
    }

    internal IReadOnlyList<BaselineTopologyValidation> ValidateTopology(
        IReadOnlyList<DisplayDescriptor> connectedDisplays)
    {
        lock (_sync)
        {
            var connectedById = connectedDisplays.ToDictionary(display => display.Id, StringComparer.Ordinal);
            return _baselines.Values.Select(baseline =>
            {
                if (!connectedById.TryGetValue(baseline.Owner.DisplayId, out var display))
                {
                    return new BaselineTopologyValidation(
                        baseline.Owner.DisplayId,
                        "disconnected",
                        "notConnected");
                }

                return new BaselineTopologyValidation(
                    baseline.Owner.DisplayId,
                    "connected",
                    BaselineOwnership.IsValid(baseline.Owner, display)
                        ? "validated"
                        : "providerChanged");
            }).ToArray();
        }
    }

    private GammaRamp ReadGamma(DisplayDescriptor display)
    {
        try
        {
            return gamma.Read(display.WindowsDisplayName);
        }
        catch (Exception exception) when (exception is Win32Exception or InvalidOperationException)
        {
            throw new DisplayOperationException("GAMMA_READ_FAILED", exception.Message, exception);
        }
    }

    private void WriteAndVerify(DisplayDescriptor display, GammaRamp requested)
    {
        try
        {
            gamma.Write(display.WindowsDisplayName, requested);
            var actual = gamma.Read(display.WindowsDisplayName);
            if (!actual.ToInterleavedBuffer().SequenceEqual(requested.ToInterleavedBuffer()))
            {
                throw new DisplayOperationException(
                    "GAMMA_VERIFY_FAILED",
                    $"The driver did not retain the requested gamma ramp for {display.Name}.");
            }
        }
        catch (DisplayOperationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is Win32Exception or InvalidOperationException)
        {
            throw new DisplayOperationException("GAMMA_WRITE_FAILED", exception.Message, exception);
        }
    }

    private void RestoreEntry(DisplayDescriptor display, BaselineEntry baseline)
    {
        EnsureDisplayWritesSafe(display);
        var failures = new List<string>();
        if (baseline.GammaRamp is not null)
        {
            try
            {
                EnsureGammaSafe(display);
                WriteAndVerify(display, baseline.GammaRamp);
            }
            catch (Exception exception)
            {
                failures.Add($"Windows gamma: {exception.Message}");
            }
        }

        if (baseline.Nvidia.Saturation.Supported || baseline.Nvidia.Hue.Supported)
        {
            try
            {
                nvidia.Restore(display, baseline.Nvidia);
            }
            catch (Exception exception)
            {
                failures.Add($"NVIDIA color: {exception.Message}");
            }
        }

        if (HasAmdCapability(baseline.Amd))
        {
            try
            {
                amd.Restore(display, baseline.Amd);
            }
            catch (Exception exception)
            {
                failures.Add($"AMD ADLX color: {exception.Message}");
            }
        }

        if (failures.Count > 0)
        {
            throw new DisplayOperationException("BASELINE_RESTORE_FAILED", string.Join("; ", failures));
        }
    }

    private bool TryDiscardDisconnectedBaseline(
        string displayId,
        bool discardDisconnected,
        JsonArray results)
    {
        bool connected;
        try
        {
            connected = displays.List().Any(display => display.Id == displayId);
        }
        catch
        {
            return false;
        }

        if (!ShouldDiscardDisconnectedBaseline(discardDisconnected, connected)) return false;
        _baselines.Remove(displayId);
        results.Add((JsonNode?)RestoreResult(
            displayId,
            restored: false,
            reason: "displayDisconnected",
            discarded: true));
        NativeLog.Write(new JsonObject
        {
            ["level"] = "information",
            ["eventName"] = "DisconnectedBaselineDiscarded",
            ["displayId"] = displayId
        });
        return true;
    }

    private static void EnsureBaselineOwnership(DisplayDescriptor display, BaselineEntry baseline)
    {
        if (BaselineOwnership.IsValid(baseline.Owner, display)) return;
        throw new DisplayOperationException(
            "BASELINE_OWNERSHIP_CHANGED",
            $"The captured baseline for {display.Name} belongs to a different display provider. " +
            "ChromaShift will retain it and refuse to recapture modified output.");
    }

    private void TryRestoreAfterFailedApply(DisplayDescriptor display, BaselineEntry baseline)
    {
        try
        {
            RestoreEntry(display, baseline);
        }
        catch (Exception exception)
        {
            NativeLog.Write(new JsonObject
            {
                ["level"] = "critical",
                ["eventName"] = "BaselineRestoreFailed",
                ["displayId"] = display.Id,
                ["message"] = exception.Message
            });
        }
    }

    private DisplayDescriptor FindDisplay(string displayId) =>
        displays.List().SingleOrDefault(display => string.Equals(display.Id, displayId, StringComparison.Ordinal))
        ?? throw new DisplayOperationException("DISPLAY_NOT_FOUND", $"Display not found: {displayId}");

    private void EnsureGammaSafe(DisplayDescriptor display)
    {
        if (display.Hdr)
        {
            throw new DisplayOperationException(
                "HDR_UNSAFE",
                $"Windows gamma-ramp operations are disabled while HDR is active on {display.Name}.");
        }

        if (!gamma.IsSupported(display.WindowsDisplayName))
        {
            throw new DisplayOperationException(
                "CAPABILITY_UNSUPPORTED",
                $"Windows gamma ramps are not supported by {display.Name}.");
        }
    }

    internal static void EnsureDisplayWritesSafe(DisplayDescriptor display)
    {
        if (!display.Hdr) return;
        throw new DisplayOperationException(
            "HDR_UNSAFE",
            $"Display baseline capture and writes are disabled while HDR is active on {display.Name}; " +
            "HDR provider behavior has not been validated.");
    }

    private static JsonObject Describe(BaselineEntry entry, string state) => new()
    {
        ["displayId"] = entry.Owner.DisplayId,
        ["state"] = state,
        ["gammaRampHash"] = entry.GammaRamp?.GetHash(),
        ["nvidiaSaturation"] = entry.Nvidia.Saturation.Current,
        ["nvidiaHue"] = entry.Nvidia.Hue.Current,
        ["amdBrightness"] = entry.Amd.Brightness.Current,
        ["amdContrast"] = entry.Amd.Contrast.Current,
        ["amdSaturation"] = entry.Amd.Saturation.Current,
        ["amdHue"] = entry.Amd.Hue.Current,
        ["amdColorTemperature"] = entry.Amd.ColorTemperature.Current,
        ["amdGammaRampHash"] = entry.Amd.GammaRamp?.GetHash()
    };

    private static void Log(string eventName, DisplayDescriptor display, string? gammaRampHash) =>
        NativeLog.Write(new JsonObject
        {
            ["level"] = "information",
            ["eventName"] = eventName,
            ["displayId"] = display.Id,
            ["displayName"] = display.Name,
            ["provider"] = "windows",
            ["gammaRampHash"] = gammaRampHash
        });

    private static JsonObject RestoreResult(
        string displayId,
        bool restored,
        string? reason = null,
        string? code = null,
        string? error = null,
        string? gammaRampHash = null,
        bool? discarded = null) => new()
    {
        ["displayId"] = displayId,
        ["restored"] = restored,
        ["reason"] = reason,
        ["code"] = code,
        ["error"] = error,
        ["gammaRampHash"] = gammaRampHash,
        ["discarded"] = discarded
    };

    private sealed record BaselineEntry(
        BaselineOwner Owner,
        string WindowsDisplayName,
        GammaRamp? GammaRamp,
        NvidiaDisplayState Nvidia,
        AmdDisplayState Amd);

    private static bool HasAmdCapability(AmdDisplayState state) =>
        state.Brightness.Supported || state.Contrast.Supported || state.Saturation.Supported ||
        state.Hue.Supported || state.ColorTemperature.Supported || state.GammaRamp is not null;

    private static bool HasAnySetting(DisplaySettings settings) =>
        settings.Brightness is not null || settings.Contrast is not null || settings.Gamma is not null ||
        settings.Saturation is not null || settings.Hue is not null || settings.ColorTemperature is not null;
}
