using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class ParentProcessMonitorTests
{
    [Fact]
    public void ParsesTheElectronParentProcessId()
    {
        Assert.Equal(1234, ParentProcessMonitor.ParseParentProcessId(["--parent-pid=1234"]));
    }

    [Fact]
    public void AllowsTheMonitorToRunWithoutAParentProcess()
    {
        Assert.Null(ParentProcessMonitor.ParseParentProcessId([]));
    }

    [Theory]
    [InlineData("--parent-pid=0")]
    [InlineData("--parent-pid=invalid")]
    public void RejectsInvalidParentProcessIds(string argument)
    {
        Assert.Throws<ArgumentException>(() => ParentProcessMonitor.ParseParentProcessId([argument]));
    }
}
