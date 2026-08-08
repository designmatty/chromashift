namespace ChromaShift.DisplayService.Core;

internal sealed record ForegroundApplication(
    uint Pid,
    string? Executable,
    string? Path,
    string Title,
    string? MonitorDeviceName);
