using Miningcore.Blockchain.Parallax;
using Xunit;
using Block = Miningcore.Persistence.Model.Block;
using ChainBlock = Miningcore.Blockchain.Parallax.DaemonResponses.Block;

namespace Miningcore.Tests.Blockchain.Parallax;

public class ParallaxPayoutHandlerTests
{
    [Theory]
    [InlineData("0x307692cf71b12f6d", "0x307692cf71b12f6d", true)]
    [InlineData("0x307692cf71b12f6d", "0x307692CF71B12F6D", true)]
    [InlineData("0x307692cf71b12f6d", "0x0000000000000001", false)]
    [InlineData("", "0x307692cf71b12f6d", null)]
    [InlineData(null, "0x307692cf71b12f6d", null)]
    public void Block_On_Chain_Is_Told_Apart_By_Nonce(string recorded, string onChain, bool? expected)
    {
        var block = new Block { TransactionConfirmationData = recorded };

        Assert.Equal(expected, ParallaxPayoutHandler.IsBlockOnChain(block, new ChainBlock { Nonce = onChain }));
    }
}
