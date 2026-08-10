namespace ChromaShift.DisplayService.Core;

internal static class GammaRampTransform
{
    internal static GammaRamp Apply(GammaRamp baseline, GammaSettings settings)
    {
        baseline.Validate();
        ValidateRange(settings.Brightness, 0, 100, nameof(settings.Brightness));
        ValidateRange(settings.Contrast, 0, 100, nameof(settings.Contrast));
        ValidateRange(settings.Gamma, 0.5, 2.8, nameof(settings.Gamma));

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
        var brightness = ((settings.Brightness ?? 50) - 50) / 50;
        var contrast = ((settings.Contrast ?? 50) - 50) / 50;
        var gamma = settings.Gamma ?? 1;
        var result = new ushort[channel.Length];

        for (var index = 0; index < channel.Length; index++)
        {
            var normalized = channel[index] / (double)ushort.MaxValue;
            var corrected = Math.Pow(normalized, 1 / gamma);
            corrected = ApplyContrast(corrected, contrast);
            corrected = ApplyBrightness(corrected, brightness);
            result[index] = checked((ushort)Math.Round(Math.Clamp(corrected, 0, 1) * ushort.MaxValue));
        }

        return result;
    }

    private static double ApplyContrast(double value, double contrast)
    {
        // SetDeviceGammaRamp rejects ramps that compress most of the image near a
        // single value. A symmetric power curve changes contrast while retaining
        // the baseline black and white endpoints and a monotonic recovery path.
        var power = contrast >= 0
            ? 1 + (contrast * 2)
            : 1 / (1 - (contrast * 0.75));
        return value <= 0.5
            ? 0.5 * Math.Pow(value * 2, power)
            : 1 - (0.5 * Math.Pow((1 - value) * 2, power));
    }

    private static double ApplyBrightness(double value, double brightness)
    {
        // Brightness is a bounded midtone curve rather than a DC offset. This
        // keeps black at black and white at white instead of producing the flat,
        // unrecoverable ramps rejected by Windows and some display drivers.
        return brightness >= 0
            ? value + (brightness * (Math.Sqrt(value) - value))
            : value + (-brightness * ((value * value) - value));
    }

    private static void ValidateRange(double? value, double minimum, double maximum, string name)
    {
        if (value is not null && (double.IsNaN(value.Value) || value < minimum || value > maximum))
        {
            throw new ArgumentOutOfRangeException(name, value, $"Value must be between {minimum} and {maximum}.");
        }
    }
}
