using ChromaShift.DisplayService.Ipc;
using Xunit;

namespace ChromaShift.DisplayService.Tests.Ipc;

public sealed class ProtocolInputReaderTests
{
    [Fact]
    public async Task ReadsLinesAndReportsEndOfInput()
    {
        var input = new ProtocolInputReader(new StringReader("first\nsecond\n"));

        Assert.Equal("first", await input.ReadLineAsync());
        Assert.Equal("second", await input.ReadLineAsync());
        Assert.Null(await input.ReadLineAsync());
    }
}
