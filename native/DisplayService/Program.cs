using System.Text.Json;
using ChromaShift.DisplayService.Ipc;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Amd;
using ChromaShift.DisplayService.Services;

Console.InputEncoding = System.Text.Encoding.UTF8;
Console.OutputEncoding = System.Text.Encoding.UTF8;

var protocol = new ProtocolWriter(Console.Out);
var foregroundApplications = new ForegroundApplicationService();
using var foregroundWatcher = new ForegroundWindowWatcher(
    foregroundApplications,
    async application =>
    {
        await protocol.WriteEventAsync("foregroundApplicationChanged", new { application });
        await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
        {
            level = "information",
            eventName = "ForegroundApplicationChanged",
            application.Pid,
            application.Executable,
            application.Path,
            application.Title,
            application.MonitorDeviceName
        }));
    });
await foregroundWatcher.StartAsync();

var displays = new DisplayRegistry();
foreach (var display in displays.List())
{
    await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
    {
        level = "information",
        eventName = "DisplayDetected",
        display.Id,
        display.Name,
        display.WindowsDisplayName,
        adapter = display.Adapter.Name,
        vendor = display.Adapter.Vendor,
        display.Hdr
    }));
}
var gamma = new WindowsGammaProvider();
using var nvidia = new NvidiaColorProvider();
using var amd = new AmdAdlxProvider();
var baselines = new BaselineManager(displays, gamma, nvidia, amd);
var capabilities = new CapabilityResolver(gamma, nvidia, amd);
var processor = new CommandProcessor(protocol, foregroundApplications, displays, baselines, capabilities);

await protocol.WriteEventAsync("service.ready", new
{
    protocolVersion = ProtocolWriter.ProtocolVersion
});
await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
{
    level = "information",
    eventName = "NativeServiceStarted",
    processId = Environment.ProcessId
}));

try
{
    while (!processor.ShutdownRequested && await Console.In.ReadLineAsync() is { } line)
    {
        await processor.ProcessLineAsync(line);
    }
}
finally
{
    _ = baselines.RestoreAll();
}

await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
{
    level = "information",
    eventName = "NativeServiceExited",
    processId = Environment.ProcessId
}));
