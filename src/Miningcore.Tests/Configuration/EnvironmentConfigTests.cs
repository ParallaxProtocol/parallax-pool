using System.Collections.Generic;
using System.IO;
using System.Linq;
using Miningcore.Blockchain.Parallax.Configuration;
using Miningcore.Configuration;
using Miningcore.Extensions;
using Miningcore.Mining;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Schema;
using Newtonsoft.Json.Serialization;
using Xunit;

namespace Miningcore.Tests.Configuration;

public class EnvironmentConfigTests : TestBase
{
    private const string Address = "0x1234567890abcdef1234567890abcdef12345678";

    private static ClusterConfig Load(Dictionary<string, string> env)
    {
        var json = EnvironmentConfig.Build(name => env.TryGetValue(name, out var value) ? value : null).ToString();

        // same path as a config file: schema validation, then deserialization
        var schema = JSchema.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(typeof(Program).Assembly.Location)!, "config.schema.json")));
        using var reader = new JSchemaValidatingReader(new JsonTextReader(new StringReader(json))) { Schema = schema };

        return JsonSerializer.Create(new JsonSerializerSettings { ContractResolver = new CamelCasePropertyNamesContractResolver() })
            .Deserialize<ClusterConfig>(reader);
    }

    private static Dictionary<string, string> Minimal => new()
    {
        ["POOL_ADDRESS"] = Address,
        ["DB_PASSWORD"] = "secret",
    };

    [Fact]
    public void Requires_Pool_Address()
    {
        Assert.False(EnvironmentConfig.IsPresent(_ => null));
        Assert.True(EnvironmentConfig.IsPresent(name => name == "POOL_ADDRESS" ? Address : null));
    }

    [Fact]
    public void Minimal_Environment_Is_A_Direct_Rewards_Solo_Pool()
    {
        var config = Load(Minimal);
        var pool = config.Pools.Single();

        Assert.Equal("lax1", pool.Id);
        Assert.Equal("parallax", pool.Coin);
        Assert.Equal(Address, pool.Address);
        Assert.Empty(pool.RewardRecipients);

        Assert.True(config.PaymentProcessing.Enabled);
        Assert.True(pool.PaymentProcessing.DirectRewards);
        Assert.Equal(PayoutScheme.SOLO, pool.PaymentProcessing.PayoutScheme);

        var port = pool.Ports[4073];
        Assert.Equal(0.25, port.Difficulty);
        Assert.Equal(0.05, port.VarDiff.MinDiff);
        Assert.Null(port.VarDiff.MaxDiff);
        Assert.Equal(15, port.VarDiff.TargetTime);

        var daemon = pool.Daemons.Single();
        Assert.Equal("127.0.0.1", daemon.Host);
        Assert.Equal(8545, daemon.Port);
        Assert.Null(daemon.Extra.SafeExtensionDataAs<ParallaxDaemonEndpointConfigExtra>()?.PortWs);

        Assert.Equal("127.0.0.1", config.Persistence.Postgres.Host);
        Assert.Equal("pool", config.Persistence.Postgres.User);
        Assert.Equal("secret", config.Persistence.Postgres.Password);

        Assert.Equal("recovered-shares.txt", config.ShareRecoveryFile);
        Assert.Equal(4000, config.Api.Port);
        Assert.False(config.Api.RateLimiting.Disabled);
        Assert.Equal(20, config.Api.RateLimiting.Rules.Single().Limit);
    }

    [Fact]
    public void Pool_Mode_With_Fee_And_Block_Finder_Bonus()
    {
        var env = Minimal;
        env["PAYOUT_MODE"] = "pool";
        env["PAYOUT_SCHEME"] = "pplnsbf";
        env["PPLNS_FACTOR"] = "3";
        env["BLOCK_FINDER_PERCENT"] = "2.5";
        env["POOL_FEE_PERCENT"] = "1.5";
        env["POOL_FEE_ADDRESS"] = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
        env["MINIMUM_PAYMENT"] = "0.5";
        env["NODE_HOST"] = "node";
        env["NODE_WS_PORT"] = "8546";
        env["STRATUM_PORT"] = "3333";
        env["API_RATE_LIMIT"] = "0";

        var config = Load(env);
        var pool = config.Pools.Single();

        Assert.False(pool.PaymentProcessing.DirectRewards);
        Assert.Equal(PayoutScheme.PPLNSBF, pool.PaymentProcessing.PayoutScheme);
        Assert.Equal(0.5m, pool.PaymentProcessing.MinimumPayment);
        Assert.Equal(3, pool.PaymentProcessing.PayoutSchemeConfig["factor"]!.Value<double>());
        Assert.Equal(2.5, pool.PaymentProcessing.PayoutSchemeConfig["blockFinderPercentage"]!.Value<double>());

        var fee = pool.RewardRecipients.Single();
        Assert.Equal("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", fee.Address);
        Assert.Equal(1.5m, fee.Percentage);

        Assert.Equal("node", pool.Daemons.Single().Host);
        Assert.Equal(8546, pool.Daemons.Single().Extra.SafeExtensionDataAs<ParallaxDaemonEndpointConfigExtra>().PortWs);
        Assert.Contains(3333, pool.Ports.Keys);
        Assert.True(config.Api.RateLimiting.Disabled);
    }

    [Fact]
    public void Settings_Directory_Without_Address_Waits_For_Setup()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        var env = new Dictionary<string, string> { ["SETTINGS_DIR"] = dir, ["DB_PASSWORD"] = "secret" };

        Assert.True(EnvironmentConfig.IsPresent(n => env.TryGetValue(n, out var v) ? v : null));

        var config = Load(env);
        Assert.Empty(config.Pools);
        Assert.Equal(dir, config.SettingsDirectory);
    }

    [Fact]
    public void Settings_Directory_Provides_Address_And_Previous_Addresses()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        new PoolSettings().WithAddress("0x1111111111111111111111111111111111111111").Save(dir);
        PoolSettings.Load(dir).WithAddress(Address).Save(dir);

        Assert.Equal(Address + "\n", File.ReadAllText(Path.Combine(dir, "coinbase")));

        var config = Load(new Dictionary<string, string> { ["SETTINGS_DIR"] = dir, ["DB_PASSWORD"] = "secret" });
        var pool = config.Pools.Single();

        Assert.Equal(Address, pool.Address);
        Assert.Equal(new[] { "0x1111111111111111111111111111111111111111" },
            pool.Extra.SafeExtensionDataAs<ParallaxPoolConfigExtra>().PreviousAddresses);
    }

    [Fact]
    public void Changing_Back_To_A_Previous_Address_Removes_It_From_The_List()
    {
        var settings = new PoolSettings().WithAddress("0x1111111111111111111111111111111111111111").WithAddress(Address);
        Assert.Same(settings, settings.WithAddress(Address.ToUpperInvariant().Replace("0X", "0x")));

        var back = settings.WithAddress("0x1111111111111111111111111111111111111111");
        Assert.Equal(new[] { Address }, back.PreviousAddresses);
    }

    [Theory]
    [InlineData("DB_PASSWORD", null)]
    [InlineData("STRATUM_DIFFICULTY", "abc")]
    [InlineData("PAYOUT_MODE", "shared")]
    [InlineData("POOL_FEE_PERCENT", "1")]
    public void Rejects_Invalid_Environment(string name, string value)
    {
        var env = Minimal;
        env[name] = value;

        Assert.Throws<PoolStartupException>(() => EnvironmentConfig.Build(n => env.TryGetValue(n, out var v) ? v : null));
    }
}
