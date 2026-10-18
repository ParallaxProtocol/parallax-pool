using Miningcore.Blockchain;
using Miningcore.Configuration;

namespace Miningcore.Mining;

public interface IMiningPool
{
    PoolConfig Config { get; }
    PoolStats PoolStats { get; }
    BlockchainStats NetworkStats { get; }

    /// <summary>
    /// True once the pool is connected to a synced node and accepts miners
    /// </summary>
    bool IsOnline { get; }

    double ShareMultiplier { get; }
    void Configure(PoolConfig pc, ClusterConfig cc);
    double HashrateFromShares(double shares, double interval);
    Task RunAsync(CancellationToken ct);
}
