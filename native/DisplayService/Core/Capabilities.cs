namespace ChromaShift.DisplayService.Core;

internal sealed record CapabilityDescriptor(
    bool Supported,
    string Provider,
    double? Min,
    double? Max,
    double? Default,
    string? Reason);

internal sealed record DisplayCapabilities(
    CapabilityDescriptor Brightness,
    CapabilityDescriptor Contrast,
    CapabilityDescriptor Gamma,
    CapabilityDescriptor Saturation,
    CapabilityDescriptor Hue,
    CapabilityDescriptor ColorTemperature);

internal sealed record ProviderControlState(
    bool Supported,
    int? Current,
    int? Min,
    int? Max,
    int? Default,
    string? Reason);

internal sealed record NvidiaDisplayState(
    ProviderControlState Saturation,
    ProviderControlState Hue);

internal sealed record AmdDisplayState(
    ProviderControlState Brightness,
    ProviderControlState Contrast,
    ProviderControlState Saturation,
    ProviderControlState Hue,
    ProviderControlState ColorTemperature,
    GammaRamp? GammaRamp,
    string? GammaReason);

internal sealed record AmdAdlxDiagnostics(
    bool LibraryAvailable,
    bool Initialized,
    string? Version,
    ulong? FullVersion,
    uint DisplayCount,
    string RuntimeValidation,
    string? Error);
