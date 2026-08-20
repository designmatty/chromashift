using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class HdrDisplaySafetyTests
{
    [Fact]
    public void RejectsAllBaselineWritesWhileHdrIsActive()
    {
        var exception = Assert.Throws<DisplayOperationException>(
            () => BaselineManager.EnsureDisplayWritesSafe(Display(hdr: true)));

        Assert.Equal("HDR_UNSAFE", exception.Code);
    }

    [Fact]
    public void AllowsBaselineWritesWhenHdrIsInactive()
    {
        BaselineManager.EnsureDisplayWritesSafe(Display(hdr: false));
    }

    private static DisplayDescriptor Display(bool hdr) =>
        new(
            "display:test",
            "display:test",
            "Test display",
            "\\\\.\\DISPLAY1",
            "monitor-path",
            "TST",
            "0001",
            "serial",
            new DisplayAdapterDescriptor("adapter", "Test adapter", "nvidia", "PCI\\VEN_10DE"),
            "DisplayPort",
            true,
            hdr,
            true,
            10,
            240);
}
