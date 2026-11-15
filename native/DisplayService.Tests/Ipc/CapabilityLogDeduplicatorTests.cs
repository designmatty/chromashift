using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Ipc;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Ipc;

public sealed class CapabilityLogDeduplicatorTests
{
    [Fact]
    public void LogsEachDisplaysFirstResolutionOnly()
    {
        var log = new CapabilityLogDeduplicator();

        Assert.True(log.ShouldLog("display-a", Node(gammaSupported: true)));
        Assert.True(log.ShouldLog("display-b", Node(gammaSupported: true)));
        Assert.False(log.ShouldLog("display-a", Node(gammaSupported: true)));
        Assert.False(log.ShouldLog("DISPLAY-B", Node(gammaSupported: true)));
    }

    [Fact]
    public void LogsAgainWhenCapabilitiesChangeAndWhenTheyReturn()
    {
        var log = new CapabilityLogDeduplicator();

        Assert.True(log.ShouldLog("display-a", Node(gammaSupported: true)));
        // HDR on disables Windows gamma, then HDR off restores it.
        Assert.True(log.ShouldLog("display-a", Node(gammaSupported: false)));
        Assert.False(log.ShouldLog("display-a", Node(gammaSupported: false)));
        Assert.True(log.ShouldLog("display-a", Node(gammaSupported: true)));
    }

    private static System.Text.Json.Nodes.JsonNode? Node(bool gammaSupported)
    {
        var supported = new CapabilityDescriptor(true, "windows", 0, 100, 50, null);
        var gamma = gammaSupported
            ? new CapabilityDescriptor(true, "windows", 0.5, 2.5, 1, null)
            : new CapabilityDescriptor(false, "windows", null, null, null, "HDR is active.");
        return NativeJson.ToNode(new DisplayCapabilities(
            supported, supported, gamma, supported, supported, supported));
    }
}
