using System.Diagnostics;

namespace ChromaShift.DisplayService.Services;

internal static class ParentProcessMonitor
{
    private const string ParentProcessIdArgument = "--parent-pid=";

    internal static int? ParseParentProcessId(IEnumerable<string> arguments)
    {
        var argument = arguments.SingleOrDefault(candidate =>
            candidate.StartsWith(ParentProcessIdArgument, StringComparison.OrdinalIgnoreCase));
        if (argument is null)
        {
            return null;
        }

        var value = argument[ParentProcessIdArgument.Length..];
        if (!int.TryParse(value, out var processId) || processId <= 0)
        {
            throw new ArgumentException($"Invalid parent process ID: {value}", nameof(arguments));
        }
        return processId;
    }

    internal static Process? TryOpen(int processId)
    {
        try
        {
            return Process.GetProcessById(processId);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }
}
