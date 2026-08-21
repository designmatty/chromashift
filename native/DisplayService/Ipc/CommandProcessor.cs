using System.Text.Json;
using System.Text.Json.Nodes;
using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Services;

namespace ChromaShift.DisplayService.Ipc;

internal sealed class CommandProcessor(
    ProtocolWriter protocol,
    ForegroundApplicationService foregroundApplications,
    DisplayRegistry displays,
    BaselineManager baselines,
    CapabilityResolver capabilities,
    HeartbeatWatchdog heartbeat,
    string serviceInstanceId,
    string baselineOwnerId)
{
    internal bool ShutdownRequested { get; private set; }
    private int _topologyGeneration;

    internal async Task ProcessLineAsync(string line)
    {
        RequestEnvelope? request;
        try
        {
            request = NativeJson.Deserialize<RequestEnvelope>(line);
        }
        catch (JsonException exception)
        {
            await protocol.WriteErrorAsync(null, "INVALID_JSON", exception.Message);
            return;
        }

        if (request is null || string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.Command))
        {
            await protocol.WriteErrorAsync(request?.Id, "INVALID_REQUEST", "Requests require non-empty id and command fields.");
            return;
        }

        try
        {
            await DispatchAsync(request);
        }
        catch (DisplayOperationException exception)
        {
            LogFailure(request.Command, exception.Code, exception.Message);
            await protocol.WriteErrorAsync(request.Id, exception.Code, exception.Message);
        }
        catch (JsonException exception)
        {
            await protocol.WriteErrorAsync(request.Id, "INVALID_REQUEST", exception.Message);
        }
        catch (Exception exception)
        {
            LogFailure(request.Command, "COMMAND_FAILED", exception.Message);
            await protocol.WriteErrorAsync(request.Id, "COMMAND_FAILED", exception.Message);
        }
    }

    private async Task DispatchAsync(RequestEnvelope request)
    {
        switch (request.Command)
        {
            case "system.info":
                await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                {
                    ["protocolVersion"] = ProtocolWriter.ProtocolVersion,
                    ["serviceVersion"] = typeof(CommandProcessor).Assembly.GetName().Version?.ToString() ?? "unknown",
                    ["operatingSystem"] = Environment.OSVersion.VersionString,
                    ["processId"] = Environment.ProcessId,
                    ["providers"] = new JsonObject
                    {
                        ["amd"] = NativeJson.ToNode(capabilities.GetAmdDiagnostics())
                    }
                });
                break;
            case "foreground.current":
                await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                {
                    ["application"] = NativeJson.ToNode(foregroundApplications.GetCurrent())
                });
                break;
            case "applications.list":
                await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                {
                    ["applications"] = NativeJson.ToNode(foregroundApplications.ListVisible())
                });
                break;
            case "displays.list":
                await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                {
                    ["displays"] = NativeJson.ToNode(displays.List())
                });
                break;
            case "service.health":
                await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                {
                    ["status"] = "healthy",
                    ["protocolVersion"] = ProtocolWriter.ProtocolVersion,
                    ["serviceVersion"] = typeof(CommandProcessor).Assembly.GetName().Version?.ToString() ?? "unknown",
                    ["processId"] = Environment.ProcessId,
                    ["serviceInstanceId"] = serviceInstanceId,
                    ["baselineOwnerId"] = baselineOwnerId,
                    ["baselineCount"] = baselines.Count,
                    ["watchdogArmed"] = heartbeat.Armed
                });
                break;
            case "service.heartbeat":
                heartbeat.RecordHeartbeat();
                await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                {
                    ["receivedAtUtc"] = DateTimeOffset.UtcNow
                });
                break;
            case "display.topology.refresh":
                {
                    var connectedDisplays = displays.List();
                    var reports = new JsonArray();
                    foreach (var display in connectedDisplays)
                    {
                        var amdState = capabilities.GetAmdState(display);
                        reports.Add((JsonNode?)new JsonObject
                        {
                            ["displayId"] = display.Id,
                            ["capabilities"] = NativeJson.ToNode(capabilities.Get(display)),
                            ["nativeState"] = NativeStateNode(capabilities.GetNvidiaState(display), amdState)
                        });
                    }
                    var baselineValidation = baselines.ValidateTopology(connectedDisplays);
                    var generation = Interlocked.Increment(ref _topologyGeneration);
                    await NativeLog.WriteAsync(new JsonObject
                    {
                        ["level"] = "information",
                        ["eventName"] = "DisplayTopologyRefreshed",
                        ["generation"] = generation,
                        ["displayIds"] = new JsonArray(
                            connectedDisplays.Select(display => (JsonNode?)display.Id).ToArray()),
                        ["baselines"] = NativeJson.ToNode(baselineValidation),
                        ["nativeHandles"] = "reacquiredPerOperation"
                    });
                    await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                    {
                        ["generation"] = generation,
                        ["displays"] = NativeJson.ToNode(connectedDisplays),
                        ["capabilityReports"] = reports,
                        ["baselines"] = NativeJson.ToNode(baselineValidation)
                    });
                    break;
                }
            case "display.state":
                await protocol.WriteSuccessAsync(request.Id!, baselines.ReadState(GetParameters<DisplayRequest>(request).DisplayId));
                break;
            case "display.capabilities":
                {
                    var displayId = GetParameters<DisplayRequest>(request).DisplayId;
                    var display = displays.List().SingleOrDefault(candidate => candidate.Id == displayId)
                        ?? throw new DisplayOperationException("DISPLAY_NOT_FOUND", $"Display not found: {displayId}");
                    var amdState = capabilities.GetAmdState(display);
                    var resolvedCapabilities = capabilities.Get(display);
                    await NativeLog.WriteAsync(new JsonObject
                    {
                        ["level"] = "information",
                        ["eventName"] = "DisplayCapabilityResolved",
                        ["displayId"] = displayId,
                        ["capabilities"] = NativeJson.ToNode(resolvedCapabilities)
                    });
                    await protocol.WriteSuccessAsync(request.Id!, new JsonObject
                    {
                        ["displayId"] = displayId,
                        ["capabilities"] = NativeJson.ToNode(resolvedCapabilities),
                        ["nativeState"] = NativeStateNode(capabilities.GetNvidiaState(display), amdState)
                    });
                    break;
                }
            case "display.apply":
                {
                    var parameters = GetParameters<DisplayApplyRequest>(request);
                    if (parameters.Settings is null)
                    {
                        throw new DisplayOperationException("INVALID_REQUEST", "display.apply requires settings.");
                    }
                    await protocol.WriteSuccessAsync(request.Id!, baselines.Apply(parameters.DisplayId, parameters.Settings));
                    break;
                }
            case "display.restore":
            case "baseline.restore":
                await protocol.WriteSuccessAsync(request.Id!, baselines.Restore(GetParameters<DisplayRequest>(request).DisplayId));
                break;
            case "baseline.capture":
                await protocol.WriteSuccessAsync(request.Id!, baselines.Capture(GetParameters<DisplayRequest>(request).DisplayId));
                break;
            case "baseline.restoreAll":
                await protocol.WriteSuccessAsync(request.Id!, baselines.RestoreAll());
                break;
            case "service.shutdown":
                await protocol.WriteSuccessAsync(
                    request.Id!,
                    baselines.RestoreAll(failOnError: true, discardDisconnected: true));
                ShutdownRequested = true;
                break;
            default:
                await protocol.WriteErrorAsync(request.Id, "COMMAND_UNKNOWN", $"Unknown command: {request.Command}");
                break;
        }
    }

    private static T GetParameters<T>(RequestEnvelope request)
    {
        if (request.Params is null || request.Params.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            throw new DisplayOperationException("INVALID_REQUEST", $"{request.Command} requires params.");
        }

        return NativeJson.Deserialize<T>(request.Params.Value.GetRawText())
            ?? throw new DisplayOperationException("INVALID_REQUEST", $"{request.Command} params are invalid.");
    }

    private static void LogFailure(string command, string code, string message) =>
        NativeLog.Write(new JsonObject
        {
            ["level"] = "error",
            ["eventName"] = "DisplaySettingFailed",
            ["command"] = command,
            ["code"] = code,
            ["message"] = message
        });

    private static JsonObject NativeStateNode(NvidiaDisplayState nvidia, AmdDisplayState amd) => new()
    {
        ["nvidia"] = NativeJson.ToNode(nvidia),
        ["amd"] = new JsonObject
        {
            ["brightness"] = NativeJson.ToNode(amd.Brightness),
            ["contrast"] = NativeJson.ToNode(amd.Contrast),
            ["saturation"] = NativeJson.ToNode(amd.Saturation),
            ["hue"] = NativeJson.ToNode(amd.Hue),
            ["colorTemperature"] = NativeJson.ToNode(amd.ColorTemperature),
            ["gammaRampHash"] = amd.GammaRamp?.GetHash(),
            ["gammaReason"] = amd.GammaReason
        }
    };
}
