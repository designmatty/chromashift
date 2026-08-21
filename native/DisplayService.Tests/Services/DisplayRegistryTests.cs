using System.Text;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class DisplayRegistryTests
{
    [Fact]
    public void ParseMonitorEdidReadsStableIdentityAndFriendlyName()
    {
        var edid = new byte[128];
        var manufacturer = EncodeManufacturer("SAM");
        edid[8] = (byte)(manufacturer >> 8);
        edid[9] = (byte)manufacturer;
        BitConverter.GetBytes((ushort)0x1234).CopyTo(edid, 10);
        WriteDescriptor(edid, 54, 0xFF, "SERIAL-42");
        WriteDescriptor(edid, 72, 0xFC, "Odyssey G8");

        var result = DisplayRegistry.ParseMonitorEdid(edid);

        Assert.Equal("SAM", result.Manufacturer);
        Assert.Equal("1234", result.ProductCode);
        Assert.Equal("SERIAL-42", result.SerialNumber);
        Assert.Equal("Odyssey G8", result.FriendlyName);
    }

    [Fact]
    public void ParseMonitorEdidFallsBackToNumericSerial()
    {
        var edid = new byte[128];
        var manufacturer = EncodeManufacturer("DEL");
        edid[8] = (byte)(manufacturer >> 8);
        edid[9] = (byte)manufacturer;
        BitConverter.GetBytes(123456u).CopyTo(edid, 12);

        var result = DisplayRegistry.ParseMonitorEdid(edid);

        Assert.Equal("123456", result.SerialNumber);
    }

    private static ushort EncodeManufacturer(string value) => checked((ushort)(
        ((value[0] - 'A' + 1) << 10) |
        ((value[1] - 'A' + 1) << 5) |
        (value[2] - 'A' + 1)));

    private static void WriteDescriptor(byte[] edid, int offset, byte type, string value)
    {
        edid[offset + 3] = type;
        Encoding.ASCII.GetBytes(value.PadRight(13, ' ')).CopyTo(edid, offset + 5);
    }
}
