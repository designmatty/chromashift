using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Amd;
using System.ComponentModel;
using System.Text.Json.Nodes;
using ChromaShift.DisplayService.Ipc;

namespace ChromaShift.DisplayService.Services;

internal sealed class BaselineManager(
    IDisplayRegistry displays,
    IWindowsGammaProvider gamma,
    INvidiaColorProvider nvidia,
    IAmdColorProvider amd)
{
    private readonly Dictionary<string, BaselineEntry> _baselines = new(StringComparer.Ordinal);
    private readonly Lock _sync = new();

    internal JsonObject Capture(string displayId) => Capture(displayId, allowHdr: true);

    /// <summary>
    /// Captures once and never recaptures. Under HDR only non-AMD displays may
    /// capture; the entry records the color mode at capture. The SDR apply path
    /// passes <paramref name="allowHdr"/> false so a display that turned HDR
    /// after its first enumeration still fails closed before any write.
    /// </summary>
    private JsonObject Capture(string displayId, bool allowHdr)
    {
        lock (_sync)
        {
            var display = FindDisplay(displayId);
            if (allowHdr) EnsureCaptureSafe(display);
            else EnsureSdrWritesSafe(display);
            if (_baselines.TryGetValue(displayId, out var existing))
            {
                return Describe(existing, "alreadyCaptured");
            }

            // Every adapter's gamma uses the Windows ramp. AMD capture under HDR was refused above.
            var ramp = gamma.IsSupported(display.WindowsDisplayName) ? ReadGamma(display) : null;
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
                amdState,
                ColorModeOf(display));
            _baselines.Add(display.Id, entry);
            Log("BaselineCaptured", display, ramp?.GetHash(), entry.ColorMode);
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
                var windowsRamp = !display.Hdr && gamma.IsSupported(display.WindowsDisplayName) ? ReadGamma(display) : null;
                return new JsonObject
                {
                    ["displayId"] = displayId,
                    ["provider"] = "amd",
                    ["gammaRampHash"] = windowsRamp?.GetHash(),
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
            GammaRampTransform.ValidateSettings(
                new GammaSettings(settings.Brightness, settings.Contrast, settings.Gamma));
            var display = FindDisplay(displayId);
            return display.Hdr ? ApplyUnderHdr(display, settings) : ApplySdr(display, settings);
        }
    }

    /// <summary>
    /// The only profile write allowed while HDR is on: NVIDIA saturation and hue.
    /// The whole request is validated before capture or any write, so no partial
    /// apply can happen. The GDI ramp is written only by <see cref="RestoreEntry"/>,
    /// which restores the captured baseline with read-back.
    /// </summary>
    private JsonObject ApplyUnderHdr(DisplayDescriptor display, DisplaySettings settings)
    {
        EnsureHdrApplyRequest(display, settings);
        if (!_baselines.TryGetValue(display.Id, out var baseline))
        {
            _ = Capture(display.Id, allowHdr: true);
            baseline = _baselines[display.Id];
        }
        EnsureBaselineOwnership(display, baseline);
        if (settings.Saturation is not null && !baseline.Nvidia.Saturation.Supported)
        {
            throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "NVIDIA saturation is unavailable for this display.");
        }
        if (settings.Hue is not null && !baseline.Nvidia.Hue.Supported)
        {
            throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "NVIDIA hue is unavailable for this display.");
        }

        try
        {
            // Restore-then-apply, as in SDR: the captured ramp and NVIDIA values
            // come back first, so profiles never compound.
            RestoreEntry(display, baseline);
            int? saturation = settings.Saturation is { } requestedSaturation
                ? nvidia.SetSaturation(display, requestedSaturation)
                : null;
            int? hue = settings.Hue is { } requestedHue
                ? nvidia.SetHue(display, requestedHue)
                : null;
            NativeLog.Write(new JsonObject
            {
                ["level"] = "information",
                ["eventName"] = "DisplaySettingApplied",
                ["displayId"] = display.Id,
                ["displayName"] = display.Name,
                ["provider"] = "nvidia",
                ["colorMode"] = "hdr",
                ["saturation"] = saturation,
                ["hue"] = hue
            });
            return new JsonObject
            {
                ["displayId"] = display.Id,
                ["settings"] = NativeJson.ToNode(settings),
                ["applied"] = new JsonObject
                {
                    ["saturation"] = saturation,
                    ["hue"] = hue
                }
            };
        }
        catch (ArgumentOutOfRangeException exception)
        {
            RestoreAfterFailedApply(display, baseline, exception);
            throw new DisplayOperationException("VALUE_OUT_OF_RANGE", exception.Message, exception);
        }
        catch (Exception exception)
        {
            RestoreAfterFailedApply(display, baseline, exception);
            throw;
        }
    }

    private JsonObject ApplySdr(DisplayDescriptor display, DisplaySettings settings)
    {
        var displayId = display.Id;
        EnsureSdrWritesSafe(display);
        if (!_baselines.TryGetValue(displayId, out var baseline))
        {
            _ = Capture(displayId, allowHdr: false);
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
            double? appliedGamma = settings.Gamma;
            JsonObject? learnedGammaLimit = null;
            // AMD brightness and contrast use ADLX custom color; elsewhere they
            // shape the Windows ramp. Gamma always uses the Windows ramp.
            var rampBrightness = settings.Brightness;
            var rampContrast = settings.Contrast;
            if (display.Adapter.Vendor == "amd")
            {
                EnsureAmdOriginalsCaptured(baseline.Amd, settings);
                if (settings.Brightness is not null) brightness = amd.SetBrightness(display, settings.Brightness.Value);
                if (settings.Contrast is not null) contrast = amd.SetContrast(display, settings.Contrast.Value);
                rampBrightness = null;
                rampContrast = null;
            }
            if (rampBrightness is not null || rampContrast is not null || settings.Gamma is not null)
            {
                EnsureGammaSafe(display);
                if (baseline.GammaRamp is null)
                {
                    throw new DisplayOperationException("CAPABILITY_UNSUPPORTED", "Windows gamma controls are unavailable for this display.");
                }
                try
                {
                    var candidate = settings.Gamma ?? 1;
                    var rejected = false;
                    while (true)
                    {
                        var requested = GammaRampTransform.Apply(
                            baseline.GammaRamp,
                            new GammaSettings(rampBrightness, rampContrast, candidate));
                        // The path was chosen from an earlier snapshot. Re-read HDR and
                        // ownership right before every transformed ramp write, including
                        // rejection retries; HDR_UNSAFE then restores the whole display.
                        EnsureStillSdrBeforeTransformedRampWrite(display.Id, baseline);
                        try
                        {
                            WriteAndVerify(display, requested);
                            gammaHash = requested.GetHash();
                            appliedGamma = settings.Gamma is null && !rejected ? null : candidate;
                            if (rejected)
                            {
                                learnedGammaLimit = new JsonObject
                                {
                                    ["end"] = (settings.Gamma ?? 1) > 1 ? "max" : "min",
                                    ["value"] = candidate,
                                    ["brightness"] = settings.Brightness ?? 50,
                                    ["colorMode"] = "sdr",
                                    ["baselineHash"] = baseline.GammaRamp.GetHash()
                                };
                                NativeLog.Write(new JsonObject
                                {
                                    ["level"] = "information",
                                    ["eventName"] = "GammaLimitLearned",
                                    ["displayId"] = display.Id,
                                    ["requestedGamma"] = settings.Gamma ?? 1,
                                    ["limit"] = learnedGammaLimit.DeepClone()
                                });
                            }
                            break;
                        }
                        catch (DisplayOperationException exception) when (
                            exception.Code == "GAMMA_WRITE_FAILED" &&
                            exception.InnerException is GammaRampRejectedException && candidate != 1)
                        {
                            rejected = true;
                            NativeLog.Write(new JsonObject
                            {
                                ["level"] = "warning",
                                ["eventName"] = "GammaSettingsRejected",
                                ["displayId"] = display.Id,
                                ["displayName"] = display.Name,
                                ["adapterName"] = display.Adapter.Name,
                                ["adapterDeviceId"] = display.Adapter.DeviceId,
                                ["provider"] = "windows",
                                ["code"] = exception.Code,
                                ["nativeMessage"] = exception.Message,
                                ["brightness"] = settings.Brightness ?? 50,
                                ["contrast"] = settings.Contrast ?? 50,
                                ["gamma"] = candidate,
                                ["baselineHash"] = baseline.GammaRamp.GetHash(),
                                ["retryingTowardNeutral"] = true
                            });
                            candidate = candidate > 1
                                ? Math.Max(1, Math.Round(candidate - 0.05, 10))
                                : Math.Min(1, Math.Round(candidate + 0.05, 10));
                        }
                    }
                }
                catch (DisplayOperationException exception) when (
                    exception.Code is "GAMMA_WRITE_FAILED" or "GAMMA_VERIFY_FAILED")
                {
                    NativeLog.Write(new JsonObject
                    {
                        ["level"] = "error",
                        ["eventName"] = "GammaSettingsRejected",
                        ["displayId"] = display.Id,
                        ["displayName"] = display.Name,
                        ["windowsDisplayName"] = display.WindowsDisplayName,
                        ["provider"] = "windows",
                        ["adapterId"] = display.Adapter.Id,
                        ["adapterName"] = display.Adapter.Name,
                        ["adapterVendor"] = display.Adapter.Vendor,
                        ["adapterDeviceId"] = display.Adapter.DeviceId,
                        ["nativeMessage"] = exception.Message,
                        ["code"] = exception.Code,
                        ["brightness"] = settings.Brightness ?? 50,
                        ["contrast"] = settings.Contrast ?? 50,
                        ["gamma"] = settings.Gamma ?? 1
                    });
                    throw new DisplayOperationException(
                        exception.Code,
                        FormattableString.Invariant($"This display rejected gamma {settings.Gamma ?? 1:0.00} at brightness {settings.Brightness ?? 50:0.##}% ({display.Name})."),
                        exception);
                }
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

            Log("DisplaySettingApplied", display, gammaHash, "sdr");
            return new JsonObject
            {
                ["displayId"] = displayId,
                ["settings"] = NativeJson.ToNode(settings with { Gamma = appliedGamma }),
                ["learnedGammaLimit"] = learnedGammaLimit,
                ["applied"] = new JsonObject
                {
                    ["gammaRampHash"] = gammaHash,
                    ["gamma"] = appliedGamma,
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
            RestoreAfterFailedApply(display, baseline, exception);
            throw new DisplayOperationException("VALUE_OUT_OF_RANGE", exception.Message, exception);
        }
        catch (Exception exception)
        {
            RestoreAfterFailedApply(display, baseline, exception);
            throw;
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
        // Restore accepts only immutable captured state, including under HDR.
        // This is the only GDI ramp write allowed under HDR. Capture and Apply keep
        // their separate HDR guards (EnsureCaptureSafe, EnsureHdrApplyRequest).
        var failures = new List<string>();
        if (baseline.GammaRamp is not null)
        {
            try
            {
                EnsureGammaSupported(display);
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

    /// <summary>
    /// Whole-display restoration after a failed apply. The caller rethrows the
    /// apply error only when this restoration is confirmed. The baseline is
    /// retained whenever restoration is not confirmed:
    /// - an ownership mismatch, in the apply error or in a freshly resolved
    ///   descriptor, writes nothing and reports BASELINE_OWNERSHIP_CHANGED;
    /// - a display that disconnected reports DISPLAY_NOT_FOUND, for reconnect;
    /// - any other unconfirmed restoration reports BASELINE_RESTORE_FAILED, so
    ///   Electron stops further writes.
    /// Permitted cleanup writes go through the fresh, owner-validated descriptor.
    /// </summary>
    private void RestoreAfterFailedApply(DisplayDescriptor display, BaselineEntry baseline, Exception applyError)
    {
        var applyCode = applyError is DisplayOperationException operation ? operation.Code : "COMMAND_FAILED";
        if (applyCode == "BASELINE_OWNERSHIP_CHANGED")
        {
            LogCleanupRefused(display.Id, applyCode, applyError.Message, "ownershipChanged");
            return;
        }

        DisplayDescriptor current;
        try
        {
            current = FindDisplay(display.Id);
        }
        catch (Exception findError)
        {
            var disconnected = findError is DisplayOperationException { Code: "DISPLAY_NOT_FOUND" };
            throw UnconfirmedCleanup(display, applyError, applyCode, findError, disconnected);
        }
        if (!BaselineOwnership.IsValid(baseline.Owner, current))
        {
            LogCleanupRefused(display.Id, applyCode, applyError.Message, "ownershipChanged");
            throw new DisplayOperationException(
                "BASELINE_OWNERSHIP_CHANGED",
                $"The captured baseline for {display.Name} belongs to a different display provider; " +
                $"ChromaShift retained it without writing. The apply failed first with {applyCode}: {applyError.Message}",
                applyError);
        }

        try
        {
            RestoreEntry(current, baseline);
        }
        catch (Exception restoreError)
        {
            throw UnconfirmedCleanup(display, applyError, applyCode, restoreError, !IsConnected(display.Id));
        }
    }

    private static DisplayOperationException UnconfirmedCleanup(
        DisplayDescriptor display,
        Exception applyError,
        string applyCode,
        Exception restoreError,
        bool disconnected)
    {
        NativeLog.Write(new JsonObject
        {
            ["level"] = "critical",
            ["eventName"] = "BaselineRestoreFailed",
            ["displayId"] = display.Id,
            ["message"] = restoreError.Message,
            ["applyCode"] = applyCode,
            ["applyMessage"] = applyError.Message,
            ["connected"] = !disconnected
        });
        return new DisplayOperationException(
            disconnected ? "DISPLAY_NOT_FOUND" : "BASELINE_RESTORE_FAILED",
            $"Restoration after a failed apply could not be confirmed for {display.Name}: {restoreError.Message} " +
            $"The apply failed first with {applyCode}: {applyError.Message}",
            new AggregateException(applyError, restoreError));
    }

    private static void LogCleanupRefused(string displayId, string applyCode, string applyMessage, string reason) =>
        NativeLog.Write(new JsonObject
        {
            ["level"] = "critical",
            ["eventName"] = "BaselineRestoreRefused",
            ["displayId"] = displayId,
            ["reason"] = reason,
            ["applyCode"] = applyCode,
            ["applyMessage"] = applyMessage
        });

    /// <summary>An enumeration failure counts as connected, so restoration fails closed.</summary>
    private bool IsConnected(string displayId)
    {
        try
        {
            return displays.List().Any(display => string.Equals(display.Id, displayId, StringComparison.Ordinal));
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// A fresh enumeration immediately before a transformed GDI ramp write on the
    /// SDR path. HDR or an ownership change refuses the write; baseline restore
    /// writes do not use this check.
    /// </summary>
    private void EnsureStillSdrBeforeTransformedRampWrite(string displayId, BaselineEntry baseline)
    {
        var current = FindDisplay(displayId);
        EnsureBaselineOwnership(current, baseline);
        EnsureSdrWritesSafe(current);
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

        EnsureGammaSupported(display);
    }

    private void EnsureGammaSupported(DisplayDescriptor display)
    {
        if (!gamma.IsSupported(display.WindowsDisplayName))
        {
            throw new DisplayOperationException(
                "CAPABILITY_UNSUPPORTED",
                $"Windows gamma ramps are not supported by {display.Name}.");
        }
    }

    /// <summary>Guards the SDR apply path, including the capture it may need.</summary>
    internal static void EnsureSdrWritesSafe(DisplayDescriptor display)
    {
        if (!display.Hdr) return;
        throw new DisplayOperationException(
            "HDR_UNSAFE",
            $"SDR profile application is disabled while HDR is active on {display.Name}; " +
            "only NVIDIA saturation and hue, or a restore of captured original settings, are allowed.");
    }

    /// <summary>
    /// Capture is a read. Under HDR it stays refused for AMD, whose ADLX behavior
    /// under HDR is unverified. Other displays may capture; the entry records HDR.
    /// </summary>
    internal static void EnsureCaptureSafe(DisplayDescriptor display)
    {
        if (!display.Hdr || display.Adapter.Vendor != "amd") return;
        throw new DisplayOperationException(
            "HDR_UNSAFE",
            $"AMD baseline capture and profile application are disabled while HDR is active on {display.Name}; " +
            "only captured original settings may be restored.");
    }

    /// <summary>
    /// Validates a whole HDR apply request before capture or any write. Only NVIDIA
    /// saturation and hue are accepted. Brightness, contrast and gamma use the GDI
    /// ramp and stay SDR-only; color temperature has no NVIDIA provider. An empty
    /// request is refused: Original settings come back only through restore.
    /// </summary>
    internal static void EnsureHdrApplyRequest(DisplayDescriptor display, DisplaySettings settings)
    {
        if (!display.Hdr) return;
        if (display.Adapter.Vendor != "nvidia")
        {
            throw new DisplayOperationException(
                "HDR_UNSAFE",
                $"Profile application is disabled while HDR is active on {display.Name}; " +
                "only NVIDIA saturation and hue may be applied under HDR.");
        }
        if (settings.Brightness is not null || settings.Contrast is not null ||
            settings.Gamma is not null || settings.ColorTemperature is not null)
        {
            throw new DisplayOperationException(
                "HDR_UNSAFE",
                $"Brightness, contrast, gamma and color temperature stay disabled while HDR is active on {display.Name}; " +
                "only NVIDIA saturation and hue may be applied under HDR.");
        }
        if (settings.Saturation is null && settings.Hue is null)
        {
            throw new DisplayOperationException(
                "HDR_UNSAFE",
                $"An HDR apply for {display.Name} must set saturation or hue; restore original settings instead.");
        }
    }

    private static string ColorModeOf(DisplayDescriptor display) => display.Hdr ? "hdr" : "sdr";

    private static JsonObject Describe(BaselineEntry entry, string state) => new()
    {
        ["displayId"] = entry.Owner.DisplayId,
        ["state"] = state,
        ["colorMode"] = entry.ColorMode,
        ["gammaRampHash"] = entry.GammaRamp?.GetHash(),
        ["nvidiaSaturation"] = entry.Nvidia.Saturation.Current,
        ["nvidiaHue"] = entry.Nvidia.Hue.Current,
        ["amdBrightness"] = entry.Amd.Brightness.Current,
        ["amdContrast"] = entry.Amd.Contrast.Current,
        ["amdSaturation"] = entry.Amd.Saturation.Current,
        ["amdHue"] = entry.Amd.Hue.Current,
        ["amdColorTemperature"] = entry.Amd.ColorTemperature.Current
    };

    private static void Log(
        string eventName,
        DisplayDescriptor display,
        string? gammaRampHash,
        string? colorMode = null) =>
        NativeLog.Write(new JsonObject
        {
            ["level"] = "information",
            ["eventName"] = eventName,
            ["displayId"] = display.Id,
            ["displayName"] = display.Name,
            ["provider"] = "windows",
            ["colorMode"] = colorMode,
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
        AmdDisplayState Amd,
        // "sdr" or "hdr": the color mode when this baseline was captured.
        string ColorMode);

    /// <summary>
    /// Every requested ADLX control must have a captured original, so Restore can
    /// return it. A control that was unreadable at capture stays unwritable for
    /// this baseline, even if ADLX reads recover later.
    /// </summary>
    internal static void EnsureAmdOriginalsCaptured(AmdDisplayState baseline, DisplaySettings settings)
    {
        foreach (var (requested, captured, name) in new[]
        {
            (settings.Brightness, baseline.Brightness, "brightness"),
            (settings.Contrast, baseline.Contrast, "contrast"),
            (settings.Saturation, baseline.Saturation, "saturation"),
            (settings.Hue, baseline.Hue, "hue"),
            (settings.ColorTemperature, baseline.ColorTemperature, "color temperature")
        })
        {
            if (requested is null || (captured.Supported && captured.Current is not null)) continue;
            throw new DisplayOperationException(
                "CAPABILITY_UNSUPPORTED",
                $"AMD {name} has no captured original value for this display.");
        }
    }

    private static bool HasAmdCapability(AmdDisplayState state) =>
        state.Brightness.Supported || state.Contrast.Supported || state.Saturation.Supported ||
        state.Hue.Supported || state.ColorTemperature.Supported;
}
