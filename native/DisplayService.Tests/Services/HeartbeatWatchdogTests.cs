using ChromaShift.DisplayService.Services;
using System.Threading.Channels;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class HeartbeatWatchdogTests
{
    [Fact]
    public async Task DoesNotExpireUntilArmed()
    {
        using var watchdog = new HeartbeatWatchdog(TimeSpan.FromMilliseconds(30));

        await Task.Delay(60, TestContext.Current.CancellationToken);

        Assert.False(watchdog.Expired.IsCompleted);
        Assert.False(watchdog.Armed);
    }

    [Fact]
    public async Task HeartbeatResetsTheExpirationDeadline()
    {
        var timeout = TimeSpan.FromMilliseconds(80);
        var waitCalls = Channel.CreateUnbounded<TimeSpan?>();
        var waitResults = Channel.CreateUnbounded<int>();
        using var watchdog = new HeartbeatWatchdog(timeout, (_, waitTimeout) =>
        {
            waitCalls.Writer.TryWrite(waitTimeout);
            return waitResults.Reader.ReadAsync().AsTask().GetAwaiter().GetResult();
        });

        Assert.Null(await waitCalls.Reader.ReadAsync(TestContext.Current.CancellationToken));
        watchdog.RecordHeartbeat();
        await waitResults.Writer.WriteAsync(0, TestContext.Current.CancellationToken);

        Assert.Equal(
            timeout,
            await waitCalls.Reader.ReadAsync(TestContext.Current.CancellationToken));
        watchdog.RecordHeartbeat();
        await waitResults.Writer.WriteAsync(0, TestContext.Current.CancellationToken);

        Assert.Equal(
            timeout,
            await waitCalls.Reader.ReadAsync(TestContext.Current.CancellationToken));
        Assert.False(watchdog.Expired.IsCompleted);
        await waitResults.Writer.WriteAsync(
            WaitHandle.WaitTimeout,
            TestContext.Current.CancellationToken);
        await watchdog.Expired.WaitAsync(TestContext.Current.CancellationToken);
        Assert.True(watchdog.Armed);
    }
}
