using System.Text.Json.Nodes;
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
        await protocol.WriteEventAsync("foregroundApplicationChanged", new JsonObject
        {
            ["application"] = NativeJson.ToNode(application)
        });
        await NativeLog.WriteAsync(new JsonObject
        {
            ["level"] = "information",
            ["eventName"] = "ForegroundApplicationChanged",
            ["Pid"] = application.Pid,
            ["Executable"] = application.Executable,
            ["Path"] = application.Path,
            ["Title"] = application.Title,
            ["MonitorDeviceName"] = application.MonitorDeviceName
        });
    });
await foregroundWatcher.StartAsync();

using var topologyWatcher = new DisplayTopologyWatcher(async reason =>
{
    await protocol.WriteEventAsync("displayTopologyChanged", new JsonObject { ["reason"] = reason });
    await NativeLog.WriteAsync(new JsonObject
    {
        ["level"] = "information",
        ["eventName"] = "DisplayTopologyChanged",
        ["reason"] = reason
    });
});
topologyWatcher.Start();

var displays = new DisplayRegistry();
foreach (var display in displays.List())
{
    await NativeLog.WriteAsync(new JsonObject
    {
        ["level"] = "information",
        ["eventName"] = "DisplayDetected",
        ["Id"] = display.Id,
        ["PhysicalId"] = display.PhysicalId,
        ["Name"] = display.Name,
        ["WindowsDisplayName"] = display.WindowsDisplayName,
        ["adapter"] = display.Adapter.Name,
        ["vendor"] = display.Adapter.Vendor,
        ["Hdr"] = display.Hdr
    });
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

await protocol.WriteEventAsync("service.ready", new JsonObject
{
    ["protocolVersion"] = ProtocolWriter.ProtocolVersion
});
await NativeLog.WriteAsync(new JsonObject
{
    ["level"] = "information",
    ["eventName"] = "NativeServiceStarted",
    ["processId"] = Environment.ProcessId
});

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
            await NativeLog.WriteAsync(new JsonObject
            {
                ["level"] = "critical",
                ["eventName"] = "HeartbeatTimedOut"
            });
            break;
        }
        if (parentExited is not null && completed == parentExited)
        {
            await NativeLog.WriteAsync(new JsonObject
            {
                ["level"] = "warning",
                ["eventName"] = "ParentProcessExited",
                ["parentProcessId"] = parentProcessId
            });
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
        await NativeLog.WriteAsync(new JsonObject
        {
            ["level"] = "warning",
            ["eventName"] = "BaselineRestoreAcknowledgementFailed",
            ["message"] = exception.Message
        });
    }
}

await NativeLog.WriteAsync(new JsonObject
{
    ["level"] = "information",
    ["eventName"] = "NativeServiceExited",
    ["processId"] = Environment.ProcessId
});
