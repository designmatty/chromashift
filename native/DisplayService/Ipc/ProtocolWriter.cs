using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChromaShift.DisplayService.Ipc;

internal sealed class ProtocolWriter(TextWriter output)
{
    internal const int ProtocolVersion = 1;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    internal Task WriteEventAsync(string eventName, object data) =>
        WriteAsync(new { @event = eventName, data });

    internal Task WriteSuccessAsync(string id, object result) =>
        WriteAsync(new { id, ok = true, result });

    internal Task WriteErrorAsync(string? id, string code, string message) =>
        WriteAsync(new { id, ok = false, error = new { code, message } });

    private async Task WriteAsync(object message)
    {
        await _writeLock.WaitAsync();
        try
        {
            await output.WriteLineAsync(JsonSerializer.Serialize(message, JsonOptions));
            await output.FlushAsync();
        }
        finally
        {
            _writeLock.Release();
        }
    }
}
