using ChromaShift.DisplayService.Providers.Amd;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Providers;

public sealed class AmdControlMappingTests
{
    // Ranges reported by ADLX 1.4 on the integrated Radeon Graphics of a Ryzen 9 9950X3D (#119).
    [Theory]
    [InlineData(-100, 100, AmdControlMapping.NeutralBrightness)]
    [InlineData(0, 200, AmdControlMapping.NeutralContrast)] // Saturation shares this range and neutral.
    [InlineData(4000, 10000, AmdControlMapping.NeutralColorTemperature)]
    public void ProductNeutralAndExtremesReachTheAmdNeutralAndRangeEnds(int minimum, int maximum, int neutral)
    {
        Assert.Equal(neutral, AmdControlMapping.MapCentered(50, minimum, maximum, 1, neutral));
        Assert.Equal(minimum, AmdControlMapping.MapCentered(0, minimum, maximum, 1, neutral));
        Assert.Equal(maximum, AmdControlMapping.MapCentered(100, minimum, maximum, 1, neutral));
    }

    [Fact]
    public void ColorTemperatureIsLinearOnEachSideOfTheNeutralPoint()
    {
        Assert.Equal(5250, AmdControlMapping.MapCentered(25, 4000, 10000, 1, 6500));
        Assert.Equal(8250, AmdControlMapping.MapCentered(75, 4000, 10000, 1, 6500));
        Assert.Equal(6500, AmdControlMapping.MapCentered(50, 4000, 10000, 100, 6500));
    }

    [Fact]
    public void MildBrightnessKeepsItsExistingScale()
    {
        Assert.Equal(4, AmdControlMapping.MapCentered(52, -100, 100, 1, 0));
        Assert.Equal(-4, AmdControlMapping.MapCentered(48, -100, 100, 1, 0));
    }

    [Fact]
    public void ANeutralOutsideTheRangeClampsToTheNearestEnd()
    {
        Assert.Equal(7000, AmdControlMapping.MapCentered(50, 7000, 9000, 1, 6500));
        Assert.Equal(9000, AmdControlMapping.MapCentered(100, 7000, 9000, 1, 6500));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(100, 0)]
    [InlineData(25, 15)]
    [InlineData(50, 30)]
    [InlineData(51, -29)]
    [InlineData(75, -15)]
    public void HueScalesTheProductWheelAroundAmdNeutral(double product, int expected)
    {
        Assert.Equal(expected, AmdControlMapping.MapHue(product, -30, 30, 1));
    }

    [Fact]
    public void MappedValuesSnapToTheAdlxStep()
    {
        Assert.Equal(15, AmdControlMapping.MapHue(25, -30, 30, 5));
        Assert.Equal(6500, AmdControlMapping.MapCentered(51, 4000, 10000, 500, 6500));
        Assert.Equal(7000, AmdControlMapping.MapCentered(57, 4000, 10000, 500, 6500));
    }
}
