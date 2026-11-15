using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Ipc;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Ipc;

public sealed class ForegroundApplicationTests
{
    [Fact]
    public void SerializesWindowClassForElectronShellClassification()
    {
        var application = new ForegroundApplication(
            42, "explorer.exe", @"C:\Windows\explorer.exe", "", null, "Shell_TrayWnd");

        Assert.Equal("Shell_TrayWnd", NativeJson.ToNode(application)?["windowClass"]?.GetValue<string>());
    }

    [Fact]
    public void OmitsUnavailableWindowClass()
    {
        var application = new ForegroundApplication(42, "explorer.exe", null, "", null);

        Assert.False(NativeJson.ToNode(application)!.AsObject().ContainsKey("windowClass"));
    }
}
