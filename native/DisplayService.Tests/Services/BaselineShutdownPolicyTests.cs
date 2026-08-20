using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class BaselineShutdownPolicyTests
{
    [Fact]
    public void DiscardsOnlyMissingDisplaysDuringExplicitShutdown()
    {
        Assert.True(BaselineManager.ShouldDiscardDisconnectedBaseline(true, false));
        Assert.False(BaselineManager.ShouldDiscardDisconnectedBaseline(false, false));
        Assert.False(BaselineManager.ShouldDiscardDisconnectedBaseline(true, true));
    }
}
