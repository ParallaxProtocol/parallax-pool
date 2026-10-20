using System;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autofac;
using Miningcore.Blockchain.Parallax;
using Miningcore.Blockchain.Parallax.DaemonResponses;
using Miningcore.Configuration;
using Miningcore.Messaging;
using Miningcore.Mining;
using Miningcore.Persistence;
using Miningcore.Persistence.Model;
using Miningcore.Persistence.Repositories;
using Miningcore.Time;
using Newtonsoft.Json.Linq;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Xunit;
using Block = Miningcore.Persistence.Model.Block;
using ChainBlock = Miningcore.Blockchain.Parallax.DaemonResponses.Block;

namespace Miningcore.Tests.Blockchain.Parallax;

public class ParallaxPayoutHandlerTests : TestBase
{
    private const string Miner = "0x1234567890abcdef1234567890abcdef12345678";
    private const string TxHash = "0xabababababababababababababababababababababababababababababababab";

    private readonly IBalanceRepository balanceRepo = Substitute.For<IBalanceRepository>();
    private readonly IPaymentRepository paymentRepo = Substitute.For<IPaymentRepository>();
    private readonly IMasterClock clock = Substitute.For<IMasterClock>();
    private static readonly DateTime Now = new(2026, 10, 20, 12, 0, 0, DateTimeKind.Utc);

    public ParallaxPayoutHandlerTests()
    {
        clock.Now.Returns(Now);
        paymentRepo.InsertAsync(default, default, default).ReturnsForAnyArgs(42L);
    }

    private async Task<ParallaxPayoutHandler> CreateHandlerAsync(FakeNode node)
    {
        var handler = new ParallaxPayoutHandler(container, Substitute.For<IConnectionFactory>(), Substitute.For<IShareRepository>(),
            Substitute.For<IBlockRepository>(), balanceRepo, paymentRepo, clock, Substitute.For<IMessageBus>());

        var pool = new PoolConfig
        {
            Id = "lax1",
            Address = "0x00000000000000000000000000000000000000aa",
            Template = new ParallaxCoinTemplate { Family = CoinFamily.Parallax, Symbol = "LAX" },
            PaymentProcessing = new PoolPaymentProcessingConfig { Enabled = true, MinimumPayment = 0.1m },
            Daemons = new[] { new DaemonEndpointConfig { Host = "127.0.0.1", Port = node.Port } }
        };

        await handler.ConfigureAsync(new ClusterConfig { Pools = new[] { pool } }, pool, CancellationToken.None);

        return handler;
    }

    private static Balance Owed => new() { PoolId = "lax1", Address = Miner, Amount = 1.5m };

    // a node with a peer that answers sendTransaction with the given behaviour
    private static FakeNode Node(Func<JToken> sendTransaction) => new((method, _) => method switch
    {
        "net_peerCount" => "0x1",
        "eth_sendTransaction" => sendTransaction(),
        _ => throw new FakeNode.RpcError(-32601, $"unexpected {method}")
    });

    [Fact]
    public async Task Payout_Is_Not_Sent_When_It_Cannot_Be_Recorded_First()
    {
        paymentRepo.InsertAsync(default, default, default).ThrowsAsyncForAnyArgs(new InvalidOperationException("database down"));

        using var node = Node(() => TxHash);
        var handler = await CreateHandlerAsync(node);

        await handler.PayoutAsync(Substitute.For<IMiningPool>(), new[] { Owed }, CancellationToken.None);

        Assert.DoesNotContain("eth_sendTransaction", node.Calls);
    }

    [Fact]
    public async Task Payout_Takes_The_Balance_Before_Sending_And_Records_The_Transaction()
    {
        using var node = Node(() => TxHash);
        var handler = await CreateHandlerAsync(node);

        await handler.PayoutAsync(Substitute.For<IMiningPool>(), new[] { Owed }, CancellationToken.None);

        Received.InOrder(() =>
        {
            paymentRepo.InsertAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(),
                Arg.Is<Payment>(x => x.Status == PaymentStatus.Sending && x.Amount == 1.5m && x.Address == Miner));
            balanceRepo.AddAmountAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), "lax1", Miner, -1.5m, Arg.Any<string>());
            paymentRepo.UpdateStatusAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), 42L, PaymentStatus.Pending, TxHash);
        });

        Assert.Contains("eth_sendTransaction", node.Calls);
    }

    [Fact]
    public async Task Payout_Turned_Down_By_The_Node_Goes_Back_On_The_Balance()
    {
        using var node = Node(() => throw new FakeNode.RpcError(-32000, "insufficient funds for transfer"));
        var handler = await CreateHandlerAsync(node);

        await handler.PayoutAsync(Substitute.For<IMiningPool>(), new[] { Owed }, CancellationToken.None);

        await paymentRepo.Received().DeleteAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), 42L);
        await balanceRepo.Received().AddAmountAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), "lax1", Miner, 1.5m, Arg.Any<string>());
        await paymentRepo.DidNotReceiveWithAnyArgs().UpdateStatusAsync(default, default, default, default, default);
    }

    [Fact]
    public async Task Payout_Without_An_Answer_Is_Neither_Refunded_Nor_Marked_Sent()
    {
        // e.g. a timeout after the node accepted the transaction: refunding would pay it twice
        using var node = Node(() => throw new FakeNode.NoAnswer());
        var handler = await CreateHandlerAsync(node);

        await handler.PayoutAsync(Substitute.For<IMiningPool>(), new[] { Owed }, CancellationToken.None);

        await balanceRepo.Received(1).AddAmountAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), "lax1", Miner, -1.5m, Arg.Any<string>());
        await balanceRepo.DidNotReceive().AddAmountAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), "lax1", Miner, 1.5m, Arg.Any<string>());
        await paymentRepo.DidNotReceiveWithAnyArgs().DeleteAsync(default, default, default);
        await paymentRepo.DidNotReceiveWithAnyArgs().UpdateStatusAsync(default, default, default, default, default);
    }

    private static JToken Receipt(string status, ulong block) => new JObject
    {
        ["transactionHash"] = TxHash,
        ["blockNumber"] = "0x" + block.ToString("x"),
        ["status"] = status,
    };

    private static FakeNode ChainNode(ulong latest, JToken receipt) => new((method, _) => method switch
    {
        "eth_getBlockByNumber" => new JObject { ["number"] = "0x" + latest.ToString("x"), ["transactions"] = new JArray() },
        "eth_getTransactionReceipt" => receipt,
        _ => throw new FakeNode.RpcError(-32601, $"unexpected {method}")
    });

    private void HavePendingPayment()
    {
        paymentRepo.GetPaymentsByStatusAsync(default, default, default).ReturnsForAnyArgs(new[]
        {
            new Payment { Id = 7, PoolId = "lax1", Address = Miner, Amount = 1.5m, Status = PaymentStatus.Pending, TransactionConfirmationData = TxHash, Created = Now }
        });
    }

    [Fact]
    public async Task Mined_Payment_Is_Confirmed_After_Enough_Blocks()
    {
        HavePendingPayment();

        using var node = ChainNode(100 + ParallaxConstants.PaymentConfirmations, Receipt("0x1", 100));
        var handler = await CreateHandlerAsync(node);

        await handler.ConfirmPaymentsAsync(Substitute.For<IMiningPool>(), CancellationToken.None);

        await paymentRepo.Received().UpdateStatusAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), 7L, PaymentStatus.Confirmed, TxHash);
    }

    [Fact]
    public async Task Unmined_Payment_Stays_Pending()
    {
        HavePendingPayment();

        using var node = ChainNode(200, JValue.CreateNull());
        var handler = await CreateHandlerAsync(node);

        await handler.ConfirmPaymentsAsync(Substitute.For<IMiningPool>(), CancellationToken.None);

        await paymentRepo.DidNotReceiveWithAnyArgs().UpdateStatusAsync(default, default, default, default, default);
        await paymentRepo.DidNotReceiveWithAnyArgs().DeleteAsync(default, default, default);
    }

    [Fact]
    public async Task Failed_Payment_Goes_Back_On_The_Balance()
    {
        HavePendingPayment();

        using var node = ChainNode(200, Receipt("0x0", 100));
        var handler = await CreateHandlerAsync(node);

        await handler.ConfirmPaymentsAsync(Substitute.For<IMiningPool>(), CancellationToken.None);

        await paymentRepo.Received().DeleteAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), 7L);
        await balanceRepo.Received().AddAmountAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(), "lax1", Miner, 1.5m, Arg.Any<string>());
    }

    [Theory]
    [InlineData(null, 200ul, ParallaxPayoutHandler.PaymentCheck.Waiting)]
    [InlineData("0x1", 105ul, ParallaxPayoutHandler.PaymentCheck.Waiting)]
    [InlineData("0x1", 106ul, ParallaxPayoutHandler.PaymentCheck.Confirmed)]
    [InlineData("0x0", 105ul, ParallaxPayoutHandler.PaymentCheck.Waiting)]
    [InlineData("0x0", 106ul, ParallaxPayoutHandler.PaymentCheck.Failed)]
    public void Payment_Outcome_Waits_For_Confirmations(string status, ulong latest, ParallaxPayoutHandler.PaymentCheck expected)
    {
        var receipt = status == null ? null : new TransactionReceipt { BlockNumber = 100, Status = status };

        Assert.Equal(expected, ParallaxPayoutHandler.CheckPayment(receipt, latest));
    }

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
