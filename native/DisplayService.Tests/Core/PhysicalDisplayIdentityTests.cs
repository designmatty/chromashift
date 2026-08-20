using ChromaShift.DisplayService.Core;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Core;

public sealed class PhysicalDisplayIdentityTests
{
    [Fact]
    public void SameManufacturerAndSerialUnifyDifferentConnectorEndpoints()
    {
        var displayPort = PhysicalDisplayIdentity.Create("display:dp", "SAM", "HNAY301023");
        var hdmi = PhysicalDisplayIdentity.Create("display:hdmi", "sam", "hnay301023");

        Assert.Equal(displayPort, hdmi);
        Assert.StartsWith("display:", displayPort, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("00000000")]
    [InlineData("Unknown")]
    public void UnreliableSerialKeepsEndpointIdentity(string? serial)
    {
        Assert.Equal("display:endpoint", PhysicalDisplayIdentity.Create("display:endpoint", "SAM", serial));
    }

    [Fact]
    public void MissingManufacturerKeepsEndpointIdentity()
    {
        Assert.Equal(
            "display:endpoint",
            PhysicalDisplayIdentity.Create("display:endpoint", null, "HNAY301023"));
    }
}
