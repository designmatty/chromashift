using System.Text.Json;
using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Services;

namespace ChromaShift.DisplayService.Ipc;

internal sealed class CommandProcessor(
    ProtocolWriter protocol,
    ForegroundApplicationService foregroundApplications,
    DisplayRegistry displays,
    BaselineManager baselines,
    CapabilityResolver capabilities)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    internal bool ShutdownRequested { get; private set; }

    internal async Task ProcessLineAsync(string line)
    {
        RequestEnvelope? request;
        try
        {
            request = JsonSerializer.Deserialize<RequestEnvelope>(line, JsonOptions);
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
                await protocol.WriteSuccessAsync(request.Id!, new
                {
                    protocolVersion = ProtocolWriter.ProtocolVersion,
                    serviceVersion = typeof(CommandProcessor).Assembly.GetName().Version?.ToString() ?? "unknown",
                    operatingSystem = Environment.OSVersion.VersionString,
                    processId = Environment.ProcessId,
                    providers = new { amd = capabilities.GetAmdDiagnostics() }
                });
                break;
            case "foreground.current":
                await protocol.WriteSuccessAsync(request.Id!, new
                {
                    application = foregroundApplications.GetCurrent()
                });
                break;
            case "displays.list":
                await protocol.WriteSuccessAsync(request.Id!, new
                {
                    displays = displays.List()
                });
                break;
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
                    await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
                    {
                        level = "information",
                        eventName = "DisplayCapabilityResolved",
                        displayId,
                        capabilities = resolvedCapabilities
                    }));
                    await protocol.WriteSuccessAsync(request.Id!, new
                    {
                        displayId,
                        capabilities = resolvedCapabilities,
                        nativeState = new
                        {
                            nvidia = capabilities.GetNvidiaState(display),
                            amd = new
                            {
                                amdState.Brightness,
                                amdState.Contrast,
                                amdState.Saturation,
                                amdState.Hue,
                                amdState.ColorTemperature,
                                gammaRampHash = amdState.GammaRamp?.GetHash(),
                                amdState.GammaReason
                            }
                        }
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
                await protocol.WriteSuccessAsync(request.Id!, baselines.RestoreAll(failOnError: true));
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

        return request.Params.Value.Deserialize<T>(JsonOptions)
            ?? throw new DisplayOperationException("INVALID_REQUEST", $"{request.Command} params are invalid.");
    }

    private static void LogFailure(string command, string code, string message) =>
        Console.Error.WriteLine(JsonSerializer.Serialize(new
        {
            level = "error",
            eventName = "DisplaySettingFailed",
            command,
            code,
            message
        }));

    private sealed record RequestEnvelope(string? Id, string? Command, JsonElement? Params);
    private sealed record DisplayRequest(string DisplayId);
    private sealed record DisplayApplyRequest(string DisplayId, DisplaySettings? Settings);
}
