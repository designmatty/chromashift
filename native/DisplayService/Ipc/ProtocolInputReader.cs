using System.Threading.Channels;

namespace ChromaShift.DisplayService.Ipc;

internal sealed class ProtocolInputReader
{
    private readonly Channel<string> _lines = Channel.CreateUnbounded<string>(
        new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true
        });

    internal ProtocolInputReader(TextReader input)
    {
        var thread = new Thread(() => Read(input))
        {
            IsBackground = true,
            Name = "ChromaShift protocol input"
        };
        thread.Start();
    }

    internal async Task<string?> ReadLineAsync()
    {
        while (await _lines.Reader.WaitToReadAsync())
        {
            if (_lines.Reader.TryRead(out var line)) return line;
        }
        return null;
    }

    private void Read(TextReader input)
    {
        try
        {
            while (input.ReadLine() is { } line)
            {
                if (!_lines.Writer.TryWrite(line)) break;
            }
            _lines.Writer.TryComplete();
        }
        catch (Exception exception)
        {
            _lines.Writer.TryComplete(exception);
        }
    }
}
