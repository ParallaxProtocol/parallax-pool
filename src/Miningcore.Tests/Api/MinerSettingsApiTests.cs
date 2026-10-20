using System.Collections.Concurrent;
using System.Data;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Autofac;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Miningcore.Api;
using Miningcore.Api.Controllers;
using Miningcore.Api.Requests;
using Miningcore.Configuration;
using Miningcore.Mining;
using Miningcore.Persistence;
using Miningcore.Persistence.Model;
using Miningcore.Persistence.Repositories;
using Miningcore.Time;
using NSubstitute;
using Xunit;
using Dto = Miningcore.Api.Responses;

namespace Miningcore.Tests.Api;

public class MinerSettingsApiTests
{
    private const string Miner = "0x1234567890abcdef1234567890abcdef12345678";
    private const string MinerIp = "198.51.100.20";

    private readonly IShareRepository shareRepo = Substitute.For<IShareRepository>();
    private readonly IMinerRepository minerRepo = Substitute.For<IMinerRepository>();

    public MinerSettingsApiTests()
    {
        shareRepo.GetRecentyUsedIpAddressesAsync(default, default, default, default, default)
            .ReturnsForAnyArgs(new[] { MinerIp });

        minerRepo.GetSettingsAsync(default, default, default, default)
            .ReturnsForAnyArgs(new MinerSettings { PaymentThreshold = 1 });
    }

    private PoolApiController CreateController(string remoteIp)
    {
        var pool = new PoolConfig
        {
            Id = "lax1",
            Enabled = true,
            Template = new ParallaxCoinTemplate { Family = CoinFamily.Parallax },
            PaymentProcessing = new PoolPaymentProcessingConfig { MinimumPayment = 0.5m }
        };

        var builder = new ContainerBuilder();
        builder.RegisterInstance(new ClusterConfig { Pools = new[] { pool } });
        builder.RegisterInstance(Substitute.For<IConnectionFactory>());
        builder.RegisterInstance(Substitute.For<IStatsRepository>());
        builder.RegisterInstance(Substitute.For<IBlockRepository>());
        builder.RegisterInstance(Substitute.For<IPaymentRepository>());
        builder.RegisterInstance(Substitute.For<IMasterClock>());
        builder.RegisterInstance(new ConcurrentDictionary<string, IMiningPool>());
        builder.RegisterInstance(minerRepo);
        builder.RegisterInstance(shareRepo);

        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(remoteIp);

        return new PoolApiController(builder.Build(), null)
        {
            ControllerContext = new ControllerContext { HttpContext = context }
        };
    }

    private static UpdateMinerSettingsRequest Request(decimal threshold) => new()
    {
        Settings = new Dto.MinerSettings { PaymentThreshold = threshold }
    };

    [Fact]
    public async Task Settings_Change_From_Another_Address_Is_Refused()
    {
        // the miner's IP used to be accepted from the request body; only the connection counts now
        var controller = CreateController("203.0.113.66");

        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            controller.SetMinerSettingsAsync("lax1", Miner, Request(2), CancellationToken.None));

        Assert.Equal((int) HttpStatusCode.Forbidden, ex.ResponseStatusCode);
        await minerRepo.DidNotReceiveWithAnyArgs().UpdateSettingsAsync(default, default, default);
    }

    [Fact]
    public async Task Settings_Change_From_The_Miners_Address_Is_Saved()
    {
        var controller = CreateController(MinerIp);

        await controller.SetMinerSettingsAsync("lax1", Miner, Request(2), CancellationToken.None);

        await minerRepo.Received().UpdateSettingsAsync(Arg.Any<IDbConnection>(), Arg.Any<IDbTransaction>(),
            Arg.Is<MinerSettings>(x => x.Address == Miner && x.PaymentThreshold == 2));
    }

    [Theory]
    [InlineData(0.1, 0.5)]
    [InlineData(2, 2)]
    [InlineData(500, 500)]
    [InlineData(1000000, 500)]
    public void Payment_Threshold_Is_Kept_Within_Limits(decimal threshold, decimal expected)
    {
        Assert.Equal(expected, PoolApiController.ClampPaymentThreshold(threshold, 0.5m));
    }
}
