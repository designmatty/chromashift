using System.Text.Json.Nodes;

namespace ChromaShift.DisplayService.Ipc;

internal sealed class ProtocolWriter(TextWriter output)
{
    internal const int ProtocolVersion = 1;

    private readonly SemaphoreSlim _writeLock = new(1, 1);

    internal Task WriteEventAsync(string eventName, JsonNode? data) =>
        WriteAsync(new JsonObject { ["event"] = eventName, ["data"] = data });

    internal Task WriteSuccessAsync(string id, JsonNode? result) =>
        WriteAsync(new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = result });

    internal Task WriteErrorAsync(string? id, string code, string message) =>
        WriteAsync(new JsonObject
        {
            ["id"] = id,
            ["ok"] = false,
            ["error"] = new JsonObject { ["code"] = code, ["message"] = message }
        });

    private async Task WriteAsync(JsonObject message)
    {
        await _writeLock.WaitAsync();
        try
        {
            RemoveNullProperties(message);
            await output.WriteLineAsync(message.ToJsonString());
            await output.FlushAsync();
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static void RemoveNullProperties(JsonNode node)
    {
        if (node is JsonObject value)
        {
            foreach (var property in value.ToArray())
            {
                if (property.Value is null) value.Remove(property.Key);
                else RemoveNullProperties(property.Value);
            }
            return;
        }

        if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                if (item is not null) RemoveNullProperties(item);
            }
        }
    }
}
