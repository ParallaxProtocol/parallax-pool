namespace Miningcore.Blockchain.Parallax;

public class ParallaxExtraNonceProvider : ExtraNonceProviderBase
{
    public ParallaxExtraNonceProvider(string poolId, byte? clusterInstanceId) : base(poolId, 2, clusterInstanceId)
    {
    }
}
