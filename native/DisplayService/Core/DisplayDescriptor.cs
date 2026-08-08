namespace ChromaShift.DisplayService.Core;

internal sealed record DisplayDescriptor(
    string Id,
    string Name,
    string WindowsDisplayName,
    string MonitorDevicePath,
    string? Manufacturer,
    string? ProductCode,
    string? SerialNumber,
    DisplayAdapterDescriptor Adapter,
    string Connection,
    bool Primary,
    bool Hdr,
    bool AdvancedColorSupported,
    uint BitsPerColorChannel,
    double RefreshRate);

internal sealed record DisplayAdapterDescriptor(
    string Id,
    string Name,
    string Vendor,
    string DeviceId);
