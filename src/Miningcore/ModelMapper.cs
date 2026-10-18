using Miningcore.Blockchain;
using Miningcore.Configuration;
using Miningcore.Persistence.Model;
using Riok.Mapperly.Abstractions;
using Dto = Miningcore.Api.Responses;
using Entities = Miningcore.Persistence.Postgres.Entities;
using Projections = Miningcore.Persistence.Model.Projections;

namespace Miningcore;

/// <summary>
/// Object mappings between the stratum/mining layer, the persistence model, the PostgreSQL
/// entities and the API responses. Generated at compile time by Mapperly; every destination
/// member must either be mapped or explicitly ignored, so new fields can't silently go missing.
/// </summary>
[Mapper(EnumMappingIgnoreCase = true, UseDeepCloning = true, RequiredMappingStrategy = RequiredMappingStrategy.Target)]
public static partial class ModelMapper
{
    // block status is stored and served in lowercase ("pending", "confirmed", "orphaned")
    private static string MapBlockStatus(BlockStatus status) => status.ToString().ToLower();

    #region Mining -> Model

    public static partial Persistence.Model.Share ToModel(this Blockchain.Share share);

    [MapProperty(nameof(Blockchain.Share.BlockReward), nameof(Block.Reward))]
    [MapProperty(nameof(Blockchain.Share.BlockHash), nameof(Block.Hash))]
    [MapProperty(nameof(Blockchain.Share.BlockType), nameof(Block.Type))]
    [MapperIgnoreTarget(nameof(Block.Id))]
    [MapperIgnoreTarget(nameof(Block.Status))]
    [MapperIgnoreTarget(nameof(Block.ConfirmationProgress))]
    [MapperIgnoreTarget(nameof(Block.Effort))]
    [MapperIgnoreTarget(nameof(Block.MinerEffort))]
    public static partial Block ToBlock(this Blockchain.Share share);

    // PoolStats is an init-only record, so the pool and network halves are combined in one go
    public static PoolStats ToPoolStats(this Mining.PoolStats pool, BlockchainStats network, string poolId, DateTime created)
    {
        return new PoolStats
        {
            PoolId = poolId,
            Created = created,
            ConnectedMiners = pool?.ConnectedMiners ?? 0,
            PoolHashrate = pool?.PoolHashrate ?? 0,
            SharesPerSecond = pool?.SharesPerSecond ?? 0,
            NetworkHashrate = network?.NetworkHashrate ?? 0,
            NetworkDifficulty = network?.NetworkDifficulty ?? 0,
            LastNetworkBlockTime = network?.LastNetworkBlockTime,
            BlockHeight = (long) (network?.BlockHeight ?? 0),
            ConnectedPeers = network?.ConnectedPeers ?? 0,
        };
    }

    #endregion

    #region Model -> Mining

    [MapperIgnoreTarget(nameof(Mining.PoolStats.LastPoolBlockTime))]
    public static partial Mining.PoolStats ToMiningPoolStats(this PoolStats stats);

    [MapperIgnoreTarget(nameof(BlockchainStats.NetworkType))]
    [MapperIgnoreTarget(nameof(BlockchainStats.NextNetworkTarget))]
    [MapperIgnoreTarget(nameof(BlockchainStats.NextNetworkBits))]
    [MapperIgnoreTarget(nameof(BlockchainStats.NodeVersion))]
    [MapperIgnoreTarget(nameof(BlockchainStats.RewardType))]
    [MapperIgnoreTarget(nameof(BlockchainStats.SyncProgress))]
    public static partial BlockchainStats ToBlockchainStats(this PoolStats stats);

    #endregion

    #region Model -> API

    public static Dto.ApiCoinConfig ToApi(this CoinTemplate coin)
    {
        if(coin == null)
            return null;

        return new Dto.ApiCoinConfig
        {
            Type = coin.Symbol,
            Name = coin.Name,
            CanonicalName = coin.CanonicalName,
            Symbol = coin.Symbol,
            Website = coin.Website,
            Market = coin.Market,
            Family = coin.Family.ToString().ToLower(),
            Algorithm = coin.GetAlgorithmName(),
            Twitter = coin.Twitter,
            Discord = coin.Discord,
            Telegram = coin.Telegram,
            Github = coin.Github,
        };
    }

    // ports are deep-cloned: the API strips TLS secrets from the copy, not from the live config
    [MapProperty(nameof(PoolConfig.Template), nameof(Dto.PoolInfo.Coin))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.ShareBasedBanning))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.PoolFeePercent))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.AddressInfoLink))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.PoolStats))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.NetworkStats))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.TopMiners))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.TotalPaid))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.TotalBlocks))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.TotalConfirmedBlocks))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.TotalPendingBlocks))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.BlockReward))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.LastPoolBlockTime))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.PoolEffort))]
    [MapperIgnoreTarget(nameof(Dto.PoolInfo.Status))]
    public static partial Dto.PoolInfo ToApi(this PoolConfig pool);

    // the payout scheme config is converted from its raw JSON by MiningPoolExtensions.ToPoolInfo
    [MapperIgnoreTarget(nameof(Dto.ApiPoolPaymentProcessingConfig.PayoutSchemeConfig))]
    private static partial Dto.ApiPoolPaymentProcessingConfig ToApi(PoolPaymentProcessingConfig config);

    [MapProperty(nameof(PoolStats.SharesPerSecond), nameof(Dto.AggregatedPoolStats.ValidSharesPerSecond))]
    public static partial Dto.AggregatedPoolStats ToApi(this PoolStats stats);

    [MapperIgnoreTarget(nameof(Dto.Block.InfoLink))]
    public static partial Dto.Block ToApi(this Block block);

    public static partial Dto.MinerSettings ToApi(this MinerSettings settings);

    [MapperIgnoreTarget(nameof(Dto.Payment.AddressInfoLink))]
    [MapperIgnoreTarget(nameof(Dto.Payment.TransactionInfoLink))]
    public static partial Dto.Payment ToApi(this Payment payment);

    public static partial Dto.BalanceChange ToApi(this BalanceChange change);

    [MapperIgnoreTarget(nameof(Dto.MinerStats.LastPayment))]
    [MapperIgnoreTarget(nameof(Dto.MinerStats.LastPaymentLink))]
    [MapperIgnoreTarget(nameof(Dto.MinerStats.PerformanceSamples))]
    public static partial Dto.MinerStats ToApi(this Projections.MinerStats stats);

    public static partial Dto.WorkerPerformanceStatsContainer ToApi(this Projections.WorkerPerformanceStatsContainer stats);

    public static partial Dto.WorkerPerformanceStatsContainer[] ToApi(this Projections.WorkerPerformanceStatsContainer[] stats);

    public static partial Dto.MinerPerformanceStats ToApi(this MinerWorkerPerformanceStats stats);

    public static partial Dto.MinerPerformanceStats ToApi(this Entities.MinerWorkerPerformanceStats stats);

    #endregion

    #region API -> Model

    [MapperIgnoreTarget(nameof(MinerSettings.PoolId))]
    [MapperIgnoreTarget(nameof(MinerSettings.Address))]
    [MapperIgnoreTarget(nameof(MinerSettings.Created))]
    [MapperIgnoreTarget(nameof(MinerSettings.Updated))]
    public static partial MinerSettings ToModel(this Dto.MinerSettings settings);

    #endregion

    #region Model <-> PostgreSQL

    public static partial Entities.Share ToEntity(this Persistence.Model.Share share);
    public static partial Entities.Block ToEntity(this Block block);
    public static partial Entities.Balance ToEntity(this Balance balance);
    public static partial Entities.Payment ToEntity(this Payment payment);
    public static partial Entities.MinerSettings ToEntity(this MinerSettings settings);
    public static partial Entities.PoolStats ToEntity(this PoolStats stats);

    [MapperIgnoreTarget(nameof(Entities.MinerWorkerPerformanceStats.Id))]
    [MapperIgnoreTarget(nameof(Entities.MinerWorkerPerformanceStats.Partition))]
    public static partial Entities.MinerWorkerPerformanceStats ToEntity(this MinerWorkerPerformanceStats stats);

    public static partial Persistence.Model.Share ToModel(this Entities.Share share);
    public static partial Block ToModel(this Entities.Block block);
    public static partial Balance ToModel(this Entities.Balance balance);
    public static partial Payment ToModel(this Entities.Payment payment);
    public static partial BalanceChange ToModel(this Entities.BalanceChange change);
    public static partial PoolStats ToModel(this Entities.PoolStats stats);
    public static partial MinerSettings ToModel(this Entities.MinerSettings settings);
    public static partial MinerWorkerPerformanceStats ToModel(this Entities.MinerWorkerPerformanceStats stats);

    #endregion
}
