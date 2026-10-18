using Miningcore.Crypto.Hashing.Xhash;
using Newtonsoft.Json;

namespace Miningcore.Configuration;

public abstract partial class CoinTemplate
{
    public T As<T>() where T : CoinTemplate
    {
        return (T) this;
    }

    public abstract string GetAlgorithmName();

    /// <summary>
    /// json source file where this template originated from
    /// </summary>
    [JsonIgnore]
    public string Source { get; set; }
}

public partial class ParallaxCoinTemplate
{
    // all pools share the light-cache/DAG manager since caches are keyed by epoch only
    private static readonly Lazy<XhashLight> xhashLight = new(() => new XhashLight());

    [JsonIgnore]
    public XhashLight Xhash => xhashLight.Value;

    #region Overrides of CoinTemplate

    public override string GetAlgorithmName()
    {
        return "XHash";
    }

    #endregion
}

public partial class PoolConfig
{
    /// <summary>
    /// Back-reference to coin template for this pool
    /// </summary>
    [JsonIgnore]
    public CoinTemplate Template { get; set; }
}
