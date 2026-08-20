namespace ChromaShift.DisplayService.Core;

internal sealed record BaselineOwner(
    string DisplayId,
    string AdapterVendor,
    string AdapterDeviceId);

internal sealed record BaselineTopologyValidation(
    string DisplayId,
    string State,
    string Ownership);

internal static class BaselineOwnership
{
    internal static bool IsValid(BaselineOwner owner, DisplayDescriptor display) =>
        string.Equals(owner.DisplayId, display.Id, StringComparison.Ordinal) &&
        string.Equals(owner.AdapterVendor, display.Adapter.Vendor, StringComparison.OrdinalIgnoreCase) &&
        (string.IsNullOrWhiteSpace(owner.AdapterDeviceId) ||
         string.IsNullOrWhiteSpace(display.Adapter.DeviceId) ||
         string.Equals(owner.AdapterDeviceId, display.Adapter.DeviceId, StringComparison.OrdinalIgnoreCase));
}
