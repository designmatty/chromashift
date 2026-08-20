using System.Security.Cryptography;
using System.Text;

namespace ChromaShift.DisplayService.Core;

internal static class PhysicalDisplayIdentity
{
    private static readonly HashSet<string> PlaceholderSerials = new(StringComparer.OrdinalIgnoreCase)
    {
        "0",
        "0000",
        "00000000",
        "default",
        "none",
        "serialnumber",
        "unknown"
    };

    internal static string Create(string endpointId, string? manufacturer, string? serialNumber)
    {
        var manufacturerValue = Normalize(manufacturer);
        var serialValue = Normalize(serialNumber);
        if (manufacturerValue is null || !IsReliableSerial(serialValue))
        {
            return endpointId;
        }

        var material = $"physical|{manufacturerValue}|{serialValue}".ToLowerInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return $"display:{Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    internal static bool IsReliableSerial(string? serialNumber)
    {
        var serial = Normalize(serialNumber);
        if (serial is null || serial.Length < 4 || PlaceholderSerials.Contains(serial))
        {
            return false;
        }

        return serial.Any(character => character != '0');
    }

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
