using System.Text.Json.Nodes;
using ChromaShift.DisplayService.Ipc;

namespace ChromaShift.DisplayService.Services;

/// <summary>The production input, parent-exit and watchdog loop, including final restoration.</summary>
internal sealed class ServiceLifecycle(
    ProtocolInputReader input,
    HeartbeatWatchdog heartbeat,
    BaselineManager baselines,
    ProtocolWriter protocol)
{
    internal async Task RunAsync(
        Func<string, Task> processLine,
        Func<bool> shutdownRequested,
        Task? parentExited = null,
        int? parentProcessId = null)
    {
        try
        {
            while (!shutdownRequested())
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
                if (await readLine is not { } line) break;
                await processLine(line);
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
    }
}
