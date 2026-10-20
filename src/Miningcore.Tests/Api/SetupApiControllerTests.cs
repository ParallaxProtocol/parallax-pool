using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Net;
using Autofac;
using Microsoft.Extensions.Hosting;
using Miningcore.Api;
using Miningcore.Api.Controllers;
using Miningcore.Configuration;
using Miningcore.Persistence;
using NSubstitute;
using Xunit;

namespace Miningcore.Tests.Api;

public class SetupApiControllerTests : IDisposable
{
    private const string First = "0x1111111111111111111111111111111111111111";
    private const string Second = "0x2222222222222222222222222222222222222222";

    private readonly string settingsDir = Path.Combine(Path.GetTempPath(), "pp-setup-" + Guid.NewGuid().ToString("n"));
    private readonly IHostApplicationLifetime lifetime = Substitute.For<IHostApplicationLifetime>();

    public void Dispose()
    {
        // a saved address restarts the pool a second later by setting the exit code: wait for it
        // and undo it, so it doesn't become the test run's exit code
        if(saves > 0)
        {
            SpinWait.SpinUntil(() => lifetime.ReceivedCalls().Count() >= saves, TimeSpan.FromSeconds(5));
            Environment.ExitCode = 0;
        }

        if(Directory.Exists(settingsDir))
            Directory.Delete(settingsDir, true);
    }

    private int saves;

    private SetupApiController.SetupStatus Save(SetupApiController controller, string address)
    {
        var status = controller.Post(new SetupApiController.SetupRequest(address));
        saves++;
        return status;
    }

    private SetupApiController CreateController(bool allowChanges, params PoolConfig[] pools)
    {
        var builder = new ContainerBuilder();

        builder.RegisterInstance(new ClusterConfig
        {
            SettingsDirectory = settingsDir,
            AllowSettingsChanges = allowChanges,
            Pools = pools
        });

        builder.RegisterInstance(Substitute.For<IConnectionFactory>());
        builder.RegisterInstance(lifetime);

        return new SetupApiController(builder.Build());
    }

    [Fact]
    public void First_Run_Sets_The_Address()
    {
        var controller = CreateController(false);

        Assert.True(controller.Get().CanChange);

        var status = Save(controller, First);

        Assert.Equal(First, status.Address);
        Assert.Equal(First, PoolSettings.Load(settingsDir).Address);
    }

    [Fact]
    public void Address_Cannot_Be_Changed_After_The_First_Run()
    {
        Save(CreateController(false), First);

        var controller = CreateController(false);
        Assert.False(controller.Get().CanChange);

        var ex = Assert.Throws<ApiException>(() => controller.Post(new SetupApiController.SetupRequest(Second)));

        Assert.Equal((int) HttpStatusCode.Forbidden, ex.ResponseStatusCode);
        Assert.Equal(First, PoolSettings.Load(settingsDir).Address);
    }

    [Fact]
    public void Address_Set_From_The_Environment_Counts_As_Configured()
    {
        var controller = CreateController(false, new PoolConfig { Id = "lax1", Enabled = true, Address = First });

        var status = controller.Get();
        Assert.True(status.Configured);
        Assert.False(status.CanChange);
        Assert.Equal(First, status.Address);

        Assert.Throws<ApiException>(() => controller.Post(new SetupApiController.SetupRequest(Second)));
        Assert.Null(PoolSettings.Load(settingsDir).Address);
    }

    [Fact]
    public void Address_Can_Be_Changed_Where_Allowed()
    {
        Save(CreateController(true), First);

        var controller = CreateController(true);
        Assert.True(controller.Get().CanChange);

        Save(controller, Second);

        var settings = PoolSettings.Load(settingsDir);
        Assert.Equal(Second, settings.Address);
        Assert.Equal(new[] { First }, settings.PreviousAddresses);
    }
}
