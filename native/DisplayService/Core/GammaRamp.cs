using System.Security.Cryptography;

namespace ChromaShift.DisplayService.Core;

internal sealed record GammaRamp(ushort[] Red, ushort[] Green, ushort[] Blue)
{
    internal const int ChannelLength = 256;

    internal void Validate()
    {
        if (Red.Length != ChannelLength || Green.Length != ChannelLength || Blue.Length != ChannelLength)
        {
            throw new ArgumentException("Gamma ramps must contain exactly 256 values per RGB channel.");
        }
    }

    internal ushort[] ToInterleavedBuffer()
    {
        Validate();
        var values = new ushort[ChannelLength * 3];
        Red.CopyTo(values, 0);
        Green.CopyTo(values, ChannelLength);
        Blue.CopyTo(values, ChannelLength * 2);
        return values;
    }

    internal string GetHash()
    {
        var values = ToInterleavedBuffer();
        var bytes = new byte[values.Length * sizeof(ushort)];
        Buffer.BlockCopy(values, 0, bytes, 0, bytes.Length);
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    internal static GammaRamp FromInterleavedBuffer(ushort[] values)
    {
        if (values.Length != ChannelLength * 3)
        {
            throw new ArgumentException("A native gamma-ramp buffer must contain exactly 768 values.", nameof(values));
        }

        return new GammaRamp(
            values[..ChannelLength],
            values[ChannelLength..(ChannelLength * 2)],
            values[(ChannelLength * 2)..]);
    }
}

internal sealed record GammaSettings(double? Brightness, double? Contrast, double? Gamma);

internal sealed record DisplaySettings(
    double? Brightness,
    double? Contrast,
    double? Gamma,
    double? Saturation,
    double? Hue,
    double? ColorTemperature);
