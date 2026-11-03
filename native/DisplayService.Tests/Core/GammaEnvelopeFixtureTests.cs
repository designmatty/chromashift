using System.Text.Json;
using ChromaShift.DisplayService.Core;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Core;

public sealed class GammaEnvelopeFixtureTests
{
    public static IEnumerable<object[]> Cases()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "gamma-envelope.json")));
        foreach (var row in document.RootElement.EnumerateArray())
        foreach (var sample in row.GetProperty("tests").EnumerateArray())
            yield return [row.GetProperty("brightness").GetDouble(), sample.GetProperty("gamma").GetDouble(), sample.GetProperty("accepted").GetBoolean()];
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void MatchesSharedEnvelope(double brightness, double gamma, bool accepted)
    {
        var exception = Record.Exception(() => GammaRampTransform.ValidateSettings(new GammaSettings(brightness, 50, gamma)));
        if (accepted) Assert.Null(exception);
        else Assert.IsType<ArgumentOutOfRangeException>(exception);
    }
}
