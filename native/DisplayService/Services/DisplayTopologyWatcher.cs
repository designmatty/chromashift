using System.Text.Json;
using Microsoft.Win32;

namespace ChromaShift.DisplayService.Services;

internal sealed class DisplayTopologyWatcher(Func<string, Task> onChanged) : IDisposable
{
    private bool _started;
    private bool _disposed;

    internal void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_started) return;
        SystemEvents.DisplaySettingsChanged += HandleDisplaySettingsChanged;
        _started = true;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (!_started) return;
        SystemEvents.DisplaySettingsChanged -= HandleDisplaySettingsChanged;
        _started = false;
    }

    private void HandleDisplaySettingsChanged(object? sender, EventArgs eventArgs)
    {
        _ = sender;
        _ = eventArgs;
        try
        {
            onChanged("displaySettingsChanged").GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            {
                level = "error",
                eventName = "ProviderError",
                provider = "windows.displayTopology",
                message = exception.Message
            }));
        }
    }
}
