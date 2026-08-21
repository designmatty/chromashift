using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using ChromaShift.DisplayService.Core;
using Microsoft.Win32;

namespace ChromaShift.DisplayService.Services;

internal sealed class DisplayRegistry
{
    private const uint QueryOnlyActivePaths = 0x00000002;
    private const int ErrorSuccess = 0;
    private const int ErrorInsufficientBuffer = 122;
    private const int GetSourceName = 1;
    private const int GetTargetName = 2;
    private const int GetAdvancedColorInfo = 9;
    private const int DisplayDevicePrimary = 0x00000004;

    internal IReadOnlyList<DisplayDescriptor> List()
    {
        var edidByInstance = ReadMonitorEdid();
        var paths = QueryActivePaths();
        var displays = new List<DisplayDescriptor>(paths.Length);

        foreach (var path in paths)
        {
            var source = GetSource(path.Source.AdapterId, path.Source.Id);
            var target = GetTarget(path.Target.AdapterId, path.Target.Id);
            var adapter = GetAdapter(source.ViewGdiDeviceName, path.Source.AdapterId);
            var advancedColor = GetAdvancedColor(path.Target.AdapterId, path.Target.Id);
            edidByInstance.TryGetValue(NormalizeTargetPath(target.MonitorDevicePath), out var edid);

            var name = FirstNonEmpty(
                edid?.FriendlyName,
                target.MonitorFriendlyDeviceName,
                target.MonitorDevicePath,
                source.ViewGdiDeviceName);
            var manufacturer = edid?.Manufacturer ?? target.EdidManufactureId.ToString("X4");
            var productCode = edid?.ProductCode ?? target.EdidProductCodeId.ToString("X4");
            var serial = NormalizeOptional(edid?.SerialNumber);
            var stableMaterial = serial is not null
                ? $"edid|{manufacturer}|{productCode}|{serial}"
                : $"path|{target.MonitorDevicePath}";
            var endpointId = CreateStableId(stableMaterial);

            displays.Add(new DisplayDescriptor(
                endpointId,
                PhysicalDisplayIdentity.Create(endpointId, manufacturer, serial),
                name,
                source.ViewGdiDeviceName,
                target.MonitorDevicePath,
                NormalizeOptional(manufacturer),
                NormalizeOptional(productCode),
                serial,
                adapter.Descriptor,
                GetConnectionName(path.Target.OutputTechnology),
                adapter.Primary,
                advancedColor.Enabled,
                advancedColor.Supported,
                advancedColor.BitsPerColorChannel,
                GetRefreshRate(path.Target.RefreshRate)));
        }

        return displays;
    }

    private static DisplayConfigPathInfo[] QueryActivePaths()
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var result = GetDisplayConfigBufferSizes(QueryOnlyActivePaths, out var pathCount, out var modeCount);
            ThrowIfFailed(result, "GetDisplayConfigBufferSizes");

            var paths = new DisplayConfigPathInfo[pathCount];
            var modes = new DisplayConfigModeInfo[modeCount];
            result = QueryDisplayConfig(
                QueryOnlyActivePaths,
                ref pathCount,
                paths,
                ref modeCount,
                modes,
                IntPtr.Zero);
            if (result == ErrorInsufficientBuffer)
            {
                continue;
            }
            ThrowIfFailed(result, "QueryDisplayConfig");
            return paths[..checked((int)pathCount)];
        }

        throw new InvalidOperationException("Display topology changed repeatedly during enumeration.");
    }

    private static DisplayConfigSourceDeviceName GetSource(Luid adapterId, uint sourceId)
    {
        var source = new DisplayConfigSourceDeviceName
        {
            Header = CreateHeader(GetSourceName, Marshal.SizeOf<DisplayConfigSourceDeviceName>(), adapterId, sourceId),
            ViewGdiDeviceName = string.Empty
        };
        ThrowIfFailed(DisplayConfigGetSourceName(ref source), "DisplayConfigGetDeviceInfo(source)");
        return source;
    }

    private static DisplayConfigTargetDeviceName GetTarget(Luid adapterId, uint targetId)
    {
        var target = new DisplayConfigTargetDeviceName
        {
            Header = CreateHeader(GetTargetName, Marshal.SizeOf<DisplayConfigTargetDeviceName>(), adapterId, targetId),
            MonitorFriendlyDeviceName = string.Empty,
            MonitorDevicePath = string.Empty
        };
        ThrowIfFailed(DisplayConfigGetTargetName(ref target), "DisplayConfigGetDeviceInfo(target)");
        return target;
    }

    private static AdvancedColorState GetAdvancedColor(Luid adapterId, uint targetId)
    {
        var info = new DisplayConfigGetAdvancedColorInfo
        {
            Header = CreateHeader(GetAdvancedColorInfo, Marshal.SizeOf<DisplayConfigGetAdvancedColorInfo>(), adapterId, targetId)
        };
        var result = GetAdvancedColorInfoNative(ref info);
        if (result != ErrorSuccess)
        {
            return new AdvancedColorState(false, false, 0);
        }

        return new AdvancedColorState(
            (info.Value & 0x1) != 0,
            (info.Value & 0x2) != 0,
            info.BitsPerColorChannel);
    }

    private static AdapterState GetAdapter(string sourceName, Luid adapterId)
    {
        for (uint index = 0; ; index++)
        {
            var device = new DisplayDevice
            {
                Size = Marshal.SizeOf<DisplayDevice>(),
                DeviceName = string.Empty,
                DeviceString = string.Empty,
                DeviceId = string.Empty,
                DeviceKey = string.Empty
            };
            if (!EnumDisplayDevices(null, index, ref device, 0))
            {
                break;
            }
            if (!string.Equals(device.DeviceName, sourceName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var descriptor = new DisplayAdapterDescriptor(
                FormatLuid(adapterId),
                FirstNonEmpty(device.DeviceString, "Unknown adapter"),
                DetectVendor(device.DeviceId, device.DeviceString),
                device.DeviceId);
            return new AdapterState(descriptor, (device.StateFlags & DisplayDevicePrimary) != 0);
        }

        var unknown = new DisplayAdapterDescriptor(
            FormatLuid(adapterId),
            "Unknown adapter",
            "unknown",
            string.Empty);
        return new AdapterState(unknown, false);
    }

    private static Dictionary<string, MonitorEdid> ReadMonitorEdid()
    {
        var result = new Dictionary<string, MonitorEdid>(StringComparer.OrdinalIgnoreCase);
        using var displayKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\DISPLAY");
        if (displayKey is null)
        {
            return result;
        }

        foreach (var hardwareId in displayKey.GetSubKeyNames())
        {
            using var hardwareKey = displayKey.OpenSubKey(hardwareId);
            if (hardwareKey is null)
            {
                continue;
            }

            foreach (var instanceId in hardwareKey.GetSubKeyNames())
            {
                using var parameters = hardwareKey.OpenSubKey($@"{instanceId}\Device Parameters");
                if (parameters?.GetValue("EDID") is not byte[] edid || edid.Length < 128)
                {
                    continue;
                }

                result[$"{hardwareId}|{instanceId}".ToLowerInvariant()] = ParseMonitorEdid(edid);
            }
        }

        return result;
    }

    internal static MonitorEdid ParseMonitorEdid(byte[] edid)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(edid.Length, 128);

        var serial = ReadEdidDescriptor(edid, 0xFF);
        if (string.IsNullOrEmpty(serial))
        {
            var numericSerial = BitConverter.ToUInt32(edid, 12);
            serial = numericSerial == 0 ? string.Empty : numericSerial.ToString();
        }

        return new MonitorEdid(
            DecodeEdidManufacturer(edid),
            BitConverter.ToUInt16(edid, 10).ToString("X4"),
            serial,
            ReadEdidDescriptor(edid, 0xFC));
    }

    private static string DecodeEdidManufacturer(byte[] edid)
    {
        var value = (edid[8] << 8) | edid[9];
        Span<char> manufacturer = stackalloc char[3];
        manufacturer[0] = (char)(((value >> 10) & 0x1F) + 'A' - 1);
        manufacturer[1] = (char)(((value >> 5) & 0x1F) + 'A' - 1);
        manufacturer[2] = (char)((value & 0x1F) + 'A' - 1);
        return manufacturer.ToString();
    }

    private static string ReadEdidDescriptor(byte[] edid, byte descriptorType)
    {
        for (var offset = 54; offset + 18 <= edid.Length && offset < 126; offset += 18)
        {
            if (edid[offset] != 0 || edid[offset + 1] != 0 || edid[offset + 3] != descriptorType)
            {
                continue;
            }

            return Encoding.ASCII.GetString(edid, offset + 5, 13).Trim('\0', '\r', '\n', ' ');
        }

        return string.Empty;
    }

    private static string NormalizeTargetPath(string path)
    {
        var parts = path.Split('#');
        return parts.Length >= 3 ? $"{parts[1]}|{parts[2]}".ToLowerInvariant() : path.ToLowerInvariant();
    }

    private static string CreateStableId(string material)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material.ToLowerInvariant()));
        return $"display:{Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    private static string DetectVendor(string deviceId, string name)
    {
        var value = $"{deviceId} {name}";
        if (value.Contains("VEN_10DE", StringComparison.OrdinalIgnoreCase) || value.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase)) return "nvidia";
        if (value.Contains("VEN_1002", StringComparison.OrdinalIgnoreCase) || value.Contains("AMD", StringComparison.OrdinalIgnoreCase) || value.Contains("Radeon", StringComparison.OrdinalIgnoreCase)) return "amd";
        if (value.Contains("VEN_8086", StringComparison.OrdinalIgnoreCase) || value.Contains("Intel", StringComparison.OrdinalIgnoreCase)) return "intel";
        return "unknown";
    }

    private static string GetConnectionName(int technology) => technology switch
    {
        0 => "VGA",
        4 => "DVI",
        5 => "HDMI",
        6 => "LVDS",
        10 => "DisplayPort",
        11 => "Embedded DisplayPort",
        12 => "UDI",
        13 => "Embedded UDI",
        15 => "Miracast",
        16 => "Indirect wired",
        unchecked((int)0x80000000) => "Internal",
        _ => "Other"
    };

    private static double GetRefreshRate(DisplayConfigRational value) =>
        value.Denominator == 0 ? 0 : Math.Round((double)value.Numerator / value.Denominator, 3);

    private static string FormatLuid(Luid luid) => $"{unchecked((uint)luid.HighPart):X8}:{luid.LowPart:X8}";

    private static string FirstNonEmpty(params string?[] values) =>
        values.First(value => !string.IsNullOrWhiteSpace(value))!;

    private static string? NormalizeOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static DisplayConfigDeviceInfoHeader CreateHeader(int type, int size, Luid adapterId, uint id) =>
        new() { Type = type, Size = checked((uint)size), AdapterId = adapterId, Id = id };

    private static void ThrowIfFailed(int result, string operation)
    {
        if (result != ErrorSuccess)
        {
            throw new Win32Exception(result, $"{operation} failed with Win32 error {result}.");
        }
    }

    internal sealed record MonitorEdid(string Manufacturer, string ProductCode, string SerialNumber, string FriendlyName);
    private sealed record AdvancedColorState(bool Supported, bool Enabled, uint BitsPerColorChannel);
    private sealed record AdapterState(DisplayAdapterDescriptor Descriptor, bool Primary);
    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint pathCount, out uint modeCount);

    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(
        uint flags,
        ref uint pathCount,
        [Out] DisplayConfigPathInfo[] paths,
        ref uint modeCount,
        [Out] DisplayConfigModeInfo[] modes,
        IntPtr currentTopologyId);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int DisplayConfigGetSourceName(ref DisplayConfigSourceDeviceName request);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int DisplayConfigGetTargetName(ref DisplayConfigTargetDeviceName request);

    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")]
    private static extern int GetAdvancedColorInfoNative(ref DisplayConfigGetAdvancedColorInfo request);

    [DllImport("user32.dll", EntryPoint = "EnumDisplayDevicesW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayDevices(string? device, uint deviceNumber, ref DisplayDevice displayDevice, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid
    {
        internal uint LowPart;
        internal int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DisplayConfigPathInfo
    {
        internal DisplayConfigPathSourceInfo Source;
        internal DisplayConfigPathTargetInfo Target;
        internal uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DisplayConfigPathSourceInfo
    {
        internal Luid AdapterId;
        internal uint Id;
        internal uint ModeInfoIndex;
        internal uint StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DisplayConfigPathTargetInfo
    {
        internal Luid AdapterId;
        internal uint Id;
        internal uint ModeInfoIndex;
        internal int OutputTechnology;
        internal int Rotation;
        internal int Scaling;
        internal DisplayConfigRational RefreshRate;
        internal int ScanLineOrdering;
        [MarshalAs(UnmanagedType.Bool)] internal bool TargetAvailable;
        internal uint StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DisplayConfigRational
    {
        internal uint Numerator;
        internal uint Denominator;
    }

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    private struct DisplayConfigModeInfo;

    [StructLayout(LayoutKind.Sequential)]
    private struct DisplayConfigDeviceInfoHeader
    {
        internal int Type;
        internal uint Size;
        internal Luid AdapterId;
        internal uint Id;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayConfigSourceDeviceName
    {
        internal DisplayConfigDeviceInfoHeader Header;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] internal string ViewGdiDeviceName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayConfigTargetDeviceName
    {
        internal DisplayConfigDeviceInfoHeader Header;
        internal uint Flags;
        internal int OutputTechnology;
        internal ushort EdidManufactureId;
        internal ushort EdidProductCodeId;
        internal uint ConnectorInstance;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] internal string MonitorFriendlyDeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string MonitorDevicePath;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DisplayConfigGetAdvancedColorInfo
    {
        internal DisplayConfigDeviceInfoHeader Header;
        internal uint Value;
        internal int ColorEncoding;
        internal uint BitsPerColorChannel;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        internal int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] internal string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string DeviceString;
        internal int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string DeviceId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string DeviceKey;
    }
}
