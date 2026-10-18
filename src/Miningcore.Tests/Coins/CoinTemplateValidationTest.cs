using System.Linq;
using System.Reflection;
using System.Runtime.Serialization;
using Miningcore.Configuration;
using Xunit;
using Xunit.Abstractions;
#pragma warning disable 8974

namespace Miningcore.Tests.Coins;

public class CoinTemplateValidationTest : TestBase
{
    private readonly ITestOutputHelper output;

    public CoinTemplateValidationTest(ITestOutputHelper output)
    {
        this.output = output;
    }

    [Fact]
    public void Validate_Coin_Templates()
    {
        var cft = typeof(CoinFamily).GetTypeInfo();

        foreach(var template in ModuleInitializer.CoinTemplates)
        {
            var t = template.Value;

            output.WriteLine($"* {t.Name ?? t.Symbol ?? t.CanonicalName}");

            Assert.NotEmpty(t.Name);
            Assert.NotEmpty(t.Symbol);
            Assert.True(CoinTemplate.Families.ContainsKey(t.Family));
            Assert.NotNull(cft.DeclaredMembers.SingleOrDefault(x => x.Name == t.Family.ToString())?.GetCustomAttribute<EnumMemberAttribute>(false));

            Assert.NotEmpty(t.GetAlgorithmName());
        }
    }
}
