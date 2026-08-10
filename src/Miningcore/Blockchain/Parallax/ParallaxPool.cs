using Autofac;
using AutoMapper;
using Microsoft.IO;
using Miningcore.Blockchain.Ethereum;
using Miningcore.Configuration;
using Miningcore.Messaging;
using Miningcore.Nicehash;
using Miningcore.Persistence;
using Miningcore.Persistence.Repositories;
using Miningcore.Time;
using Newtonsoft.Json;

namespace Miningcore.Blockchain.Parallax;

/// <summary>
/// Parallax stratum pool. The wire protocol, job management and share validation
/// are identical to the Ethereum family (geth-style getWork/submitWork with the
/// xhash hasher selected via the coin template), so all behavior is inherited.
/// Only the coin family binding and the network-type display differ.
/// </summary>
[CoinFamily(CoinFamily.Parallax)]
public class ParallaxPool : EthereumPool
{
    public ParallaxPool(IComponentContext ctx,
        JsonSerializerSettings serializerSettings,
        IConnectionFactory cf,
        IStatsRepository statsRepo,
        IMapper mapper,
        IMasterClock clock,
        IMessageBus messageBus,
        RecyclableMemoryStreamManager rmsm,
        NicehashService nicehashService) :
        base(ctx, serializerSettings, cf, statsRepo, mapper, clock, messageBus, rmsm, nicehashService)
    {
    }

    protected override async Task InitStatsAsync(CancellationToken ct)
    {
        await base.InitStatsAsync(ct);

        // the inherited Ethereum job manager can't resolve Parallax's chain id (2110/2111)
        // to a known geth chain type, so fix up the display value here
        blockchainStats.NetworkType = "Parallax";
    }
}
