namespace ChromaShift.DisplayService.Providers.Amd;

/// <summary>
/// Maps a product color value (0 to 100) onto an ADLX custom-color range so
/// that product neutral always lands on the AMD neutral point.
/// </summary>
internal static class AmdControlMapping
{
    /// <summary>AMD neutral brightness. Product neutral is 50.</summary>
    internal const int NeutralBrightness = 0;

    /// <summary>AMD neutral contrast. Product neutral is 50.</summary>
    internal const int NeutralContrast = 100;

    /// <summary>AMD neutral saturation. Product neutral is 50.</summary>
    internal const int NeutralSaturation = 100;

    /// <summary>AMD neutral color temperature in kelvin. Product neutral is 50.</summary>
    internal const int NeutralColorTemperature = 6500;

    /// <summary>AMD neutral hue. Product neutral is 0, the start of the hue wheel.</summary>
    internal const int NeutralHue = 0;

    /// <summary>
    /// Product 0 maps to the minimum, 50 to <paramref name="neutral"/>, and 100 to
    /// the maximum, linearly on each side.
    /// </summary>
    internal static int MapCentered(double value, int minimum, int maximum, int step, int neutral)
    {
        var center = Math.Clamp(neutral, minimum, maximum);
        var raw = value <= 50
            ? minimum + ((value / 50) * (center - minimum))
            : center + (((value - 50) / 50) * (maximum - center));
        return Snap(raw, minimum, maximum, step);
    }

    /// <summary>
    /// Product hue is a 0–359° wheel with neutral at 0°. Turning from 0° toward
    /// 180° scales to the AMD neutral through the maximum; turning back from 359°
    /// toward 180° scales to the AMD neutral through the minimum.
    /// </summary>
    internal static int MapHue(double value, int minimum, int maximum, int step)
    {
        var degrees = value * 3.59;
        var signed = degrees <= 180 ? degrees : degrees - 360;
        var center = Math.Clamp(NeutralHue, minimum, maximum);
        var raw = signed >= 0
            ? center + ((signed / 180) * (maximum - center))
            : center + ((-signed / 180) * (minimum - center));
        return Snap(raw, minimum, maximum, step);
    }

    private static int Snap(double raw, int minimum, int maximum, int step)
    {
        var size = Math.Max(step, 1);
        var steps = checked((int)Math.Round((raw - minimum) / size, MidpointRounding.AwayFromZero));
        return Math.Clamp(minimum + (steps * size), minimum, maximum);
    }
}
