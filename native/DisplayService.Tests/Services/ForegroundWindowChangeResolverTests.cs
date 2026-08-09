using ChromaShift.DisplayService.Core;
using ChromaShift.DisplayService.Services;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Services;

public sealed class ForegroundWindowChangeResolverTests
{
    [Fact]
    public void ResolvesTheActualForegroundWindowInsteadOfAStaleAltTabEventWindow()
    {
        var staleEventWindow = new IntPtr(10);
        var actualForegroundWindow = new IntPtr(20);
        IntPtr? resolvedWindow = null;
        var expected = Application("Game.exe");
        var resolver = new ForegroundWindowChangeResolver(
            () => actualForegroundWindow,
            window =>
            {
                resolvedWindow = window;
                return expected;
            });

        var result = resolver.ResolveForEvent(staleEventWindow);

        Assert.Same(expected, result);
        Assert.Equal(actualForegroundWindow, resolvedWindow);
    }

    [Fact]
    public void RetriesTheSameWindowWhenItsFirstResolutionFails()
    {
        var foregroundWindow = new IntPtr(20);
        var attempts = 0;
        var expected = Application("Game.exe");
        var resolver = new ForegroundWindowChangeResolver(
            () => foregroundWindow,
            _ => ++attempts == 1 ? null : expected);

        Assert.Null(resolver.ResolveForEvent(foregroundWindow));
        Assert.Same(expected, resolver.ResolveForEvent(foregroundWindow));
        Assert.Equal(2, attempts);
    }

    [Fact]
    public void LeavesDuplicateTargetSuppressionToTheActivationCoordinator()
    {
        var foregroundWindow = new IntPtr(20);
        var attempts = 0;
        var resolver = new ForegroundWindowChangeResolver(
            () => foregroundWindow,
            _ =>
            {
                attempts += 1;
                return Application("Game.exe");
            });

        Assert.NotNull(resolver.ResolveForEvent(foregroundWindow));
        Assert.NotNull(resolver.ResolveForEvent(foregroundWindow));
        Assert.Equal(2, attempts);
    }

    private static ForegroundApplication Application(string executable) =>
        new(42, executable, $"C:\\Games\\{executable}", executable, "\\\\.\\DISPLAY1");
}
