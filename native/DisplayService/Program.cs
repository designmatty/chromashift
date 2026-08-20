using System.Text.Json;
using ChromaShift.DisplayService.Ipc;
using ChromaShift.DisplayService.Providers.Windows;
using ChromaShift.DisplayService.Providers.Nvidia;
using ChromaShift.DisplayService.Providers.Amd;
using ChromaShift.DisplayService.Services;

Console.InputEncoding = System.Text.Encoding.UTF8;
Console.OutputEncoding = System.Text.Encoding.UTF8;

var protocol = new ProtocolWriter(Console.Out);
var input = new ProtocolInputReader(Console.In);
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

using var topologyWatcher = new DisplayTopologyWatcher(async reason =>
{
    await protocol.WriteEventAsync("displayTopologyChanged", new { reason });
    await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
    {
        level = "information",
        eventName = "DisplayTopologyChanged",
        reason
    }));
});
topologyWatcher.Start();

var displays = new DisplayRegistry();
foreach (var display in displays.List())
{
    await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
    {
        level = "information",
        eventName = "DisplayDetected",
        display.Id,
        display.PhysicalId,
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
using var heartbeat = new HeartbeatWatchdog(TimeSpan.FromSeconds(10));
var serviceInstanceId = Guid.NewGuid().ToString("D");
var baselineOwnerId = Guid.NewGuid().ToString("D");
var processor = new CommandProcessor(
    protocol,
    foregroundApplications,
    displays,
    baselines,
    capabilities,
    heartbeat,
    serviceInstanceId,
    baselineOwnerId);
var parentProcessId = ParentProcessMonitor.ParseParentProcessId(args);
using var parentProcess = parentProcessId is int processId
    ? ParentProcessMonitor.TryOpen(processId)
    : null;
var parentExited = parentProcessId is null
    ? null
    : parentProcess is null ? Task.CompletedTask : parentProcess.WaitForExitAsync();

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
    while (!processor.ShutdownRequested)
    {
        var readLine = input.ReadLineAsync();
        var completed = parentExited is null
            ? await Task.WhenAny(readLine, heartbeat.Expired)
            : await Task.WhenAny(readLine, parentExited, heartbeat.Expired);
        if (completed == heartbeat.Expired)
        {
            await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
            {
                level = "critical",
                eventName = "HeartbeatTimedOut"
            }));
            break;
        }
        if (parentExited is not null && completed == parentExited)
        {
            await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
            {
                level = "warning",
                eventName = "ParentProcessExited",
                parentProcessId
            }));
            break;
        }
        if (await readLine is not { } line)
        {
            break;
        }
        await processor.ProcessLineAsync(line);
    }
}
finally
{
    var restoration = baselines.RestoreAll();
    try
    {
        await protocol.WriteEventAsync("service.baselinesRestored", restoration);
    }
    catch (Exception exception)
    {
        await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
        {
            level = "warning",
            eventName = "BaselineRestoreAcknowledgementFailed",
            message = exception.Message
        }));
    }
}

await Console.Error.WriteLineAsync(JsonSerializer.Serialize(new
{
    level = "information",
    eventName = "NativeServiceExited",
    processId = Environment.ProcessId
}));
