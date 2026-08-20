using ChromaShift.DisplayService.Core;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Core;

public sealed class BaselineOwnershipTests
{
    [Fact]
    public void AcceptsSameStableDisplayAndProviderAcrossSourceChanges()
    {
        var owner = new BaselineOwner("display:one", "nvidia", "PCI\\VEN_10DE");
        var display = Display("display:one", "nvidia", "PCI\\VEN_10DE", "\\\\.\\DISPLAY7");

        Assert.True(BaselineOwnership.IsValid(owner, display));
    }

    [Theory]
    [InlineData("display:two", "nvidia", "PCI\\VEN_10DE")]
    [InlineData("display:one", "amd", "PCI\\VEN_1002")]
    [InlineData("display:one", "nvidia", "PCI\\VEN_10DE&DEV_OTHER")]
    public void RejectsChangedStableIdentityOrProvider(
        string displayId,
        string vendor,
        string deviceId)
    {
        var owner = new BaselineOwner("display:one", "nvidia", "PCI\\VEN_10DE");

        Assert.False(BaselineOwnership.IsValid(owner, Display(displayId, vendor, deviceId)));
    }

    private static DisplayDescriptor Display(
        string id,
        string vendor,
        string deviceId,
        string windowsName = "\\\\.\\DISPLAY1") =>
        new(
            id,
            id,
            "Test display",
            windowsName,
            "monitor-path",
            "TST",
            "0001",
            "serial",
            new DisplayAdapterDescriptor("adapter", "Test adapter", vendor, deviceId),
            "DisplayPort",
            true,
            false,
            true,
            8,
            144);
}
