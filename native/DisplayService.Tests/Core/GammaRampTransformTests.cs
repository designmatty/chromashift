using ChromaShift.DisplayService.Core;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Core;

public sealed class GammaRampTransformTests
{
    [Fact]
    public void UnspecifiedSettingsPreserveTheExactBaseline()
    {
        var baseline = CreateLinearRamp();

        var transformed = GammaRampTransform.Apply(baseline, new GammaSettings(null, null, null));

        Assert.Equal(baseline.Red, transformed.Red);
        Assert.Equal(baseline.Green, transformed.Green);
        Assert.Equal(baseline.Blue, transformed.Blue);
        Assert.NotSame(baseline.Red, transformed.Red);
    }

    [Fact]
    public void ProfileTransformsAreAlwaysCalculatedFromBaseline()
    {
        var baseline = CreateLinearRamp();
        var settings = new GammaSettings(55, 60, 1.15);

        var first = GammaRampTransform.Apply(baseline, settings);
        var second = GammaRampTransform.Apply(baseline, settings);

        Assert.Equal(first.GetHash(), second.GetHash());
        Assert.NotEqual(baseline.GetHash(), first.GetHash());
    }

    [Fact]
    public void ProductMaximumGammaIsAccepted()
    {
        var baseline = CreateLinearRamp();

        var transformed = GammaRampTransform.Apply(
            baseline,
            new GammaSettings(null, null, 2.8));

        Assert.NotEqual(baseline.GetHash(), transformed.GetHash());
    }

    [Theory]
    [InlineData(-1, 50, 1)]
    [InlineData(50, 101, 1)]
    [InlineData(50, 50, 0.49)]
    [InlineData(50, 50, 2.81)]
    public void ValuesOutsideProductRangesAreRejected(double brightness, double contrast, double gamma)
    {
        var baseline = CreateLinearRamp();

        Assert.Throws<ArgumentOutOfRangeException>(() =>
            GammaRampTransform.Apply(baseline, new GammaSettings(brightness, contrast, gamma)));
    }

    private static GammaRamp CreateLinearRamp()
    {
        var channel = Enumerable.Range(0, GammaRamp.ChannelLength)
            .Select(index => checked((ushort)(index * 257)))
            .ToArray();
        return new GammaRamp([.. channel], [.. channel], [.. channel]);
    }
}
