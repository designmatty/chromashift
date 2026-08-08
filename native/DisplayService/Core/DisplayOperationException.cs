namespace ChromaShift.DisplayService.Core;

internal sealed class DisplayOperationException(string code, string message, Exception? innerException = null)
    : Exception(message, innerException)
{
    internal string Code { get; } = code;
}
