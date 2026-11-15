using System.Text.Json.Nodes;

namespace ChromaShift.DisplayService.Ipc;

/// <summary>
/// Decides whether a resolved capability result is worth a diagnostic entry.
/// Electron reads capabilities before every write and on panel refreshes, so
/// only a display's first result and later changes are logged. A helper restart
/// starts with an empty record and logs every display again.
/// </summary>
internal sealed class CapabilityLogDeduplicator
{
    private readonly Dictionary<string, string> _lastLogged = new(StringComparer.OrdinalIgnoreCase);
    private readonly Lock _gate = new();

    internal bool ShouldLog(string displayId, JsonNode? capabilities)
    {
        var serialized = capabilities?.ToJsonString() ?? "null";
        lock (_gate)
        {
            if (_lastLogged.TryGetValue(displayId, out var previous) && previous == serialized)
            {
                return false;
            }

            _lastLogged[displayId] = serialized;
            return true;
        }
    }
}
