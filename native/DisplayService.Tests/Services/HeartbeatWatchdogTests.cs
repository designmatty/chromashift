using ChromaShift.DisplayService.Services;
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
        using var watchdog = new HeartbeatWatchdog(TimeSpan.FromMilliseconds(80));
        watchdog.RecordHeartbeat();
        await Task.Delay(50, TestContext.Current.CancellationToken);
        watchdog.RecordHeartbeat();
        await Task.Delay(50, TestContext.Current.CancellationToken);

        Assert.False(watchdog.Expired.IsCompleted);
        await watchdog.Expired.WaitAsync(
            TimeSpan.FromMilliseconds(100),
            TestContext.Current.CancellationToken);
        Assert.True(watchdog.Armed);
    }
}
