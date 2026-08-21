using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using ChromaShift.DisplayService.Core;

namespace ChromaShift.DisplayService.Ipc;

[JsonSourceGenerationOptions(
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    PropertyNameCaseInsensitive = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(RequestEnvelope))]
[JsonSerializable(typeof(DisplayRequest))]
[JsonSerializable(typeof(DisplayApplyRequest))]
[JsonSerializable(typeof(DisplaySettings))]
[JsonSerializable(typeof(DisplayCapabilities))]
[JsonSerializable(typeof(NvidiaDisplayState))]
[JsonSerializable(typeof(AmdDisplayState))]
[JsonSerializable(typeof(AmdAdlxDiagnostics))]
[JsonSerializable(typeof(ForegroundApplication))]
[JsonSerializable(typeof(IReadOnlyList<ForegroundApplication>))]
[JsonSerializable(typeof(DisplayDescriptor))]
[JsonSerializable(typeof(IReadOnlyList<DisplayDescriptor>))]
[JsonSerializable(typeof(GammaRamp))]
[JsonSerializable(typeof(IReadOnlyList<BaselineTopologyValidation>))]
internal sealed partial class NativeJsonContext : JsonSerializerContext;

internal static class NativeJson
{
    internal static T? Deserialize<T>(string json)
    {
        var typeInfo = GetTypeInfo<T>();
        return JsonSerializer.Deserialize(json, typeInfo);
    }

    internal static JsonNode? ToNode<T>(T value)
    {
        var typeInfo = GetTypeInfo<T>();
        return JsonSerializer.SerializeToNode(value, typeInfo);
    }

    private static JsonTypeInfo<T> GetTypeInfo<T>() =>
        NativeJsonContext.Default.GetTypeInfo(typeof(T)) as JsonTypeInfo<T>
        ?? throw new InvalidOperationException($"No generated JSON metadata exists for {typeof(T)}.");
}

internal static class NativeLog
{
    internal static void Write(JsonObject entry) => Console.Error.WriteLine(entry.ToJsonString());

    internal static Task WriteAsync(JsonObject entry) => Console.Error.WriteLineAsync(entry.ToJsonString());
}

internal sealed record RequestEnvelope(string? Id, string? Command, JsonElement? Params);
internal sealed record DisplayRequest(string DisplayId);
internal sealed record DisplayApplyRequest(string DisplayId, DisplaySettings? Settings);
