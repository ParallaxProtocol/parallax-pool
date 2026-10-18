using System.Numerics;
using System.Threading;
using System.Threading.Tasks;
using Autofac;
using Microsoft.IO;
using Miningcore.Blockchain.Parallax;
using Miningcore.Crypto.Hashing.Xhash;
using Miningcore.Stratum;
using Miningcore.Time;
using NLog;
using Xunit;

namespace Miningcore.Tests.Blockchain.Parallax;

public class ParallaxJobTests : TestBase
{
    // XHash vector (see XhashTests): block 2, header 100cbec5..., nonce 307692cf71b12f6d
    private const ulong Height = 2;
    private const string Header = "0x100cbec5e5ef82991290d0d93d758f19082e71f234cf479192a8b94df6da6bfe";
    private const string Nonce = "307692cf71b12f6d";
    private const string Result = "7913bb30f11bbf36a162338dbee4ccc51894d43792d9234a1336e3dee9ca803e";

    private static readonly ILogger logger = new NullLogger(LogManager.LogFactory);
    private static readonly XhashLight xhash = new();

    private ParallaxJob CreateJob(BigInteger target)
    {
        var blockTemplate = new ParallaxBlockTemplate
        {
            Height = Height,
            Header = Header,
            Seed = "0x" + new string('0', 64),
            Target = "0x" + target.ToString("x64"),
        };

        return new ParallaxJob("1", blockTemplate, logger, xhash);
    }

    private StratumConnection CreateWorker(double difficulty)
    {
        var connection = new StratumConnection(logger, container.Resolve<RecyclableMemoryStreamManager>(),
            container.Resolve<IMasterClock>(), "test", false);

        connection.SetContext(new ParallaxWorkerContext
        {
            Miner = "0x1234567890abcdef1234567890abcdef12345678",
            Worker = "rig1",
            Difficulty = difficulty
        });

        return connection;
    }

    private static BigInteger ResultValue => BigInteger.Parse("0" + Result, System.Globalization.NumberStyles.HexNumber);

    [Fact]
    public async Task Share_At_Target_Is_Block_Candidate()
    {
        var job = CreateJob(ResultValue);

        var result = await job.ProcessShareAsync(CreateWorker(1e-12), "rig1", Nonce, string.Empty, CancellationToken.None);

        Assert.True(result.Share.IsBlockCandidate);
        Assert.Equal("0x" + Nonce, result.FullNonceHex);
        Assert.Equal(Header, result.HeaderHash);
        Assert.Equal((long) Height, result.Share.BlockHeight);
    }

    [Fact]
    public async Task Share_Above_Target_Is_Not_Block_Candidate()
    {
        var job = CreateJob(ResultValue - 1);

        var result = await job.ProcessShareAsync(CreateWorker(1e-12), "rig1", Nonce, string.Empty, CancellationToken.None);

        Assert.False(result.Share.IsBlockCandidate);
        Assert.Null(result.FullNonceHex);
    }

    [Fact]
    public async Task Share_Below_Worker_Difficulty_Is_Rejected()
    {
        var job = CreateJob(ResultValue - 1);

        var ex = await Assert.ThrowsAsync<StratumException>(() =>
            job.ProcessShareAsync(CreateWorker(1), "rig1", Nonce, string.Empty, CancellationToken.None));

        Assert.Equal(StratumError.LowDifficultyShare, ex.Code);
    }

    [Fact]
    public async Task Duplicate_Share_Is_Rejected()
    {
        var job = CreateJob(ResultValue - 1);
        var worker = CreateWorker(1e-12);

        await job.ProcessShareAsync(worker, "rig1", Nonce, string.Empty, CancellationToken.None);

        var ex = await Assert.ThrowsAsync<StratumException>(() =>
            job.ProcessShareAsync(worker, "rig1", Nonce, string.Empty, CancellationToken.None));

        Assert.Contains("duplicate", ex.Message);
    }

    [Theory]
    [InlineData(1ul, 50)]
    [InlineData(209999ul, 50)]
    [InlineData(210000ul, 25)]
    [InlineData(420000ul, 12.5)]
    public void Block_Reward_Halves_Every_210000_Blocks(ulong height, decimal expected)
    {
        Assert.Equal(expected, ParallaxPayoutHandler.GetBaseBlockReward(height));
    }
}
