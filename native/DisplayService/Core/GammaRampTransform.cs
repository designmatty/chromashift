namespace ChromaShift.DisplayService.Core;

internal static class GammaRampTransform
{
    internal static GammaRamp Apply(GammaRamp baseline, GammaSettings settings)
    {
        baseline.Validate();
        ValidateRange(settings.Brightness, 0, 100, nameof(settings.Brightness));
        ValidateRange(settings.Contrast, 0, 100, nameof(settings.Contrast));
        ValidateRange(settings.Gamma, 0.5, 2.0, nameof(settings.Gamma));

        if (settings is { Brightness: null, Contrast: null, Gamma: null })
        {
            return new GammaRamp([.. baseline.Red], [.. baseline.Green], [.. baseline.Blue]);
        }

        return new GammaRamp(
            TransformChannel(baseline.Red, settings),
            TransformChannel(baseline.Green, settings),
            TransformChannel(baseline.Blue, settings));
    }

    private static ushort[] TransformChannel(ushort[] channel, GammaSettings settings)
    {
        var brightnessOffset = ((settings.Brightness ?? 50) - 50) / 100;
        var contrastFactor = (settings.Contrast ?? 50) / 50;
        var gamma = settings.Gamma ?? 1;
        var result = new ushort[channel.Length];

        for (var index = 0; index < channel.Length; index++)
        {
            var normalized = channel[index] / (double)ushort.MaxValue;
            var corrected = Math.Pow(normalized, 1 / gamma);
            corrected = ((corrected - 0.5) * contrastFactor) + 0.5 + brightnessOffset;
            result[index] = checked((ushort)Math.Round(Math.Clamp(corrected, 0, 1) * ushort.MaxValue));
        }

        return result;
    }

    private static void ValidateRange(double? value, double minimum, double maximum, string name)
    {
        if (value is not null && (double.IsNaN(value.Value) || value < minimum || value > maximum))
        {
            throw new ArgumentOutOfRangeException(name, value, $"Value must be between {minimum} and {maximum}.");
        }
    }
}
