namespace ChromaShift.DisplayService.Services;

internal sealed class HeartbeatWatchdog : IDisposable
{
    private readonly TaskCompletionSource _expired = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly AutoResetEvent _heartbeat = new(false);
    private readonly ManualResetEvent _disposeSignal = new(false);
    private readonly Thread _thread;
    private readonly TimeSpan _timeout;
    private bool _disposed;

    internal HeartbeatWatchdog(TimeSpan timeout)
    {
        if (timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
        _timeout = timeout;
        _thread = new Thread(Watch)
        {
            IsBackground = true,
            Name = "ChromaShift heartbeat watchdog"
        };
        _thread.Start();
    }

    internal bool Armed { get; private set; }
    internal Task Expired => _expired.Task;

    internal void RecordHeartbeat()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Armed = true;
        _heartbeat.Set();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _disposeSignal.Set();
        _thread.Join(TimeSpan.FromSeconds(1));
        _heartbeat.Dispose();
        _disposeSignal.Dispose();
    }

    private void Watch()
    {
        var handles = new WaitHandle[] { _heartbeat, _disposeSignal };
        if (WaitHandle.WaitAny(handles) != 0) return;

        while (true)
        {
            var signaled = WaitHandle.WaitAny(handles, _timeout);
            if (signaled == 0) continue;
            if (signaled == 1) return;
            _expired.TrySetResult();
            return;
        }
    }
}
