using System.Data;
using System.Numerics;
using Autofac;
using Miningcore.Blockchain.Parallax;
using Miningcore.Blockchain.Parallax.Configuration;
using Miningcore.Blockchain.Parallax.DaemonRequests;
using Miningcore.Blockchain.Parallax.DaemonResponses;
using Miningcore.Configuration;
using Miningcore.Extensions;
using Miningcore.Messaging;
using Miningcore.Mining;
using Miningcore.Payments;
using Miningcore.Persistence;
using Miningcore.Persistence.Model;
using Miningcore.Persistence.Repositories;
using Miningcore.Rpc;
using Miningcore.Time;
using Miningcore.Util;
using Newtonsoft.Json;
using Block = Miningcore.Persistence.Model.Block;
using Contract = Miningcore.Contracts.Contract;
using DaemonResponses = Miningcore.Blockchain.Parallax.DaemonResponses;
using EC = Miningcore.Blockchain.Parallax.EthCommands;

namespace Miningcore.Blockchain.Parallax;

/// <summary>
/// Payout handling for Parallax. Differs from the Ethereum family:
/// - block rewards follow a Bitcoin-style halving schedule (50 LAX / 210,000 blocks)
/// - coinbase rewards are only credited (matured) 100 blocks after the block height
/// - the chain has no uncles, so duplicate blocks at the same height are orphans
/// - transactions are always legacy (no EIP-1559)
/// </summary>
[CoinFamily(CoinFamily.Parallax)]
public class ParallaxPayoutHandler : PayoutHandlerBase,
    IPayoutHandler
{
    public ParallaxPayoutHandler(
        IComponentContext ctx,
        IConnectionFactory cf,
        IShareRepository shareRepo,
        IBlockRepository blockRepo,
        IBalanceRepository balanceRepo,
        IPaymentRepository paymentRepo,
        IMasterClock clock,
        IMessageBus messageBus) :
        base(cf, shareRepo, blockRepo, balanceRepo, paymentRepo, clock, messageBus)
    {
        Contract.RequiresNonNull(ctx);
        Contract.RequiresNonNull(balanceRepo);
        Contract.RequiresNonNull(paymentRepo);

        this.ctx = ctx;
    }

    private readonly IComponentContext ctx;
    private RpcClient rpcClient;
    private ParallaxPaymentProcessingConfigExtra extraConfig;
    private ParallaxCoinTemplate coin;

    protected override string LogCategory => "Parallax Payout Handler";

    #region IPayoutHandler

    public Task ConfigureAsync(ClusterConfig cc, PoolConfig pc, CancellationToken ct)
    {
        poolConfig = pc;
        clusterConfig = cc;
        extraConfig = pc.PaymentProcessing.Extra.SafeExtensionDataAs<ParallaxPaymentProcessingConfigExtra>();

        coin = poolConfig.Template.As<ParallaxCoinTemplate>();

        logger = LogUtil.GetPoolScopedLogger(typeof(ParallaxPayoutHandler), pc);

        // configure standard daemon
        var jsonSerializerSettings = ctx.Resolve<JsonSerializerSettings>();

        rpcClient = new RpcClient(pc.Daemons.First(x => string.IsNullOrEmpty(x.Category)), jsonSerializerSettings, messageBus, pc.Id);

        return Task.CompletedTask;
    }

    public async Task<Block[]> ClassifyBlocksAsync(IMiningPool pool, Block[] blocks, CancellationToken ct)
    {
        Contract.RequiresNonNull(poolConfig);
        Contract.RequiresNonNull(blocks);

        // ensure we have enough peers
        var enoughPeers = await EnsureDaemonsSynchedAsync(ct);
        if(!enoughPeers)
            return blocks;

        var pageSize = 100;
        var pageCount = (int) Math.Ceiling(blocks.Length / (double) pageSize);
        var blockCache = new Dictionary<long, DaemonResponses.Block>();
        var result = new List<Block>();

        for(var i = 0; i < pageCount; i++)
        {
            // get a page full of blocks
            var page = blocks
                .Skip(i * pageSize)
                .Take(pageSize)
                .ToArray();

            // get latest block
            var latestBlockResponse = await rpcClient.ExecuteAsync<DaemonResponses.Block>(logger, coin.RpcMethodPrefix + EC.GetBlockByNumber, ct, new[] { (object) "latest", true });
            var latestBlockHeight = latestBlockResponse.Response.Height.Value;

            // execute batch
            var blockInfos = await FetchBlocks(blockCache, ct, page.Select(block => (long) block.BlockHeight).ToArray());

            for(var j = 0; j < blockInfos.Length; j++)
            {
                var blockInfo = blockInfos[j];
                var block = page[j];

                // update progress
                block.ConfirmationProgress = Math.Min(1.0d, (double) (latestBlockHeight - block.BlockHeight) / ParallaxConstants.MinConfirmations);
                result.Add(block);

                messageBus.NotifyBlockConfirmationProgress(poolConfig.Id, block, coin);

                // is it block mined by us?
                if(string.Equals(blockInfo.Miner, poolConfig.Address, StringComparison.OrdinalIgnoreCase))
                {
                    // mature? (the on-chain lockbox credits the coinbase only after MinConfirmations blocks)
                    if(latestBlockHeight - block.BlockHeight >= ParallaxConstants.MinConfirmations)
                    {
                        // Parallax has no uncles. If the pool recorded multiple candidate blocks at the
                        // same height (e.g. after a chain reorg), only the newest record can correspond
                        // to the canonical chain block - older duplicates are orphans.
                        var totalDuplicateBlock = await cf.Run(con => blockRepo.GetPoolDuplicateBlockCountByPoolHeightNoTypeAndStatusAsync(con, poolConfig.Id, Convert.ToInt64(block.BlockHeight), new[]
                        {
                            block.Status
                        }));

                        uint totalDuplicateBlockAfter = 0;

                        if(totalDuplicateBlock > 1)
                        {
                            totalDuplicateBlockAfter = await cf.Run(con => blockRepo.GetPoolDuplicateBlockAfterCountByPoolHeightNoTypeAndStatusAsync(con, poolConfig.Id, Convert.ToInt64(block.BlockHeight), new[]
                            {
                                block.Status
                            }, block.Created));
                        }

                        if(totalDuplicateBlock > 1 && totalDuplicateBlockAfter > 0)
                        {
                            logger.Info(() => $"[{LogCategory}] Got {totalDuplicateBlock} `{block.Status}` blocks with the same blockHeight: {block.BlockHeight}. Orphaning the older duplicate");

                            block.Hash = "0x0";
                            block.Status = BlockStatus.Orphaned;
                            block.Reward = 0;
                            block.ConfirmationProgress = 1;

                            messageBus.NotifyBlockUnlocked(poolConfig.Id, block, coin);
                        }

                        else
                        {
                            // re-fetch the block to double-check it is still ours
                            var blockHashResponse = await rpcClient.ExecuteAsync<DaemonResponses.Block>(logger, coin.RpcMethodPrefix + EC.GetBlockByNumber, ct,
                                new[] { (object) block.BlockHeight.ToStringHexWithPrefix(), true });

                            var blockMiner = blockHashResponse.Response.Miner;

                            if(string.Equals(blockMiner, poolConfig.Address, StringComparison.OrdinalIgnoreCase))
                            {
                                block.Hash = blockHashResponse.Response.Hash;
                                block.Status = BlockStatus.Confirmed;
                                block.ConfirmationProgress = 1;
                                block.BlockHeight = (ulong) blockInfo.Height;
                                block.Reward = GetBaseBlockReward(block.BlockHeight);
                                block.Type = ParallaxConstants.BlockTypeBlock;

                                if(extraConfig?.KeepTransactionFees == false && blockInfo.Transactions?.Length > 0)
                                    block.Reward += await GetTxRewardAsync(blockInfo, ct);

                                logger.Info(() => $"[{LogCategory}] Unlocked block {block.BlockHeight} worth {FormatAmount(block.Reward)}");

                                messageBus.NotifyBlockUnlocked(poolConfig.Id, block, coin);
                            }
                        }
                    }

                    continue;
                }

                // block is not ours - no uncles on this chain, so once enough
                // confirmations have passed it is definitely lost
                if(block.Status == BlockStatus.Pending && block.ConfirmationProgress > 0.75)
                {
                    // we've lost this one
                    block.Hash = "0x0";
                    block.Status = BlockStatus.Orphaned;
                    block.Reward = 0;

                    messageBus.NotifyBlockUnlocked(poolConfig.Id, block, coin);
                }
            }
        }

        return result.ToArray();
    }

    public override async Task<decimal> UpdateBlockRewardBalancesAsync(IDbConnection con, IDbTransaction tx, IMiningPool pool, Block block, CancellationToken ct)
    {
        var blockRewardRemaining = await base.UpdateBlockRewardBalancesAsync(con, tx, pool, block, ct);

        // Deduct static reserve for tx fees
        blockRewardRemaining -= ParallaxConstants.StaticTransactionFeeReserve;

        return blockRewardRemaining;
    }

    public async Task PayoutAsync(IMiningPool pool, Balance[] balances, CancellationToken ct)
    {
        // ensure we have enough peers
        var enoughPeers = await EnsureDaemonsSynchedAsync(ct);
        if(!enoughPeers)
            return;

        var txHashes = new List<string>();

        foreach(var balance in balances)
        {
            try
            {
                var txHash = await PayoutAsync(balance, ct);
                txHashes.Add(txHash);
            }

            catch(Exception ex)
            {
                logger.Error(ex);

                NotifyPayoutFailure(poolConfig.Id, new[] { balance }, ex.Message, null);
            }
        }

        if(txHashes.Any())
            NotifyPayoutSuccess(poolConfig.Id, balances, txHashes.ToArray(), null);
    }

    public double AdjustBlockEffort(double effort)
    {
        return effort;
    }

    #endregion // IPayoutHandler

    private async Task<bool> EnsureDaemonsSynchedAsync(CancellationToken ct)
    {
        var infoResponse = await rpcClient.ExecuteAsync<string>(logger, EC.GetPeerCount, ct);

        if(infoResponse.Error != null || string.IsNullOrEmpty(infoResponse.Response) ||
           infoResponse.Response.IntegralFromHex<int>() < ParallaxConstants.MinPayoutPeerCount)
        {
            logger.Warn(() => $"[{LogCategory}] Payout aborted. Not enough peer(s) ({ParallaxConstants.MinPayoutPeerCount} required)");
            return false;
        }

        return true;
    }

    private async Task<DaemonResponses.Block[]> FetchBlocks(Dictionary<long, DaemonResponses.Block> blockCache, CancellationToken ct, params long[] blockHeights)
    {
        var cacheMisses = blockHeights.Where(x => !blockCache.ContainsKey(x)).ToArray();

        if(cacheMisses.Any())
        {
            var blockBatch = cacheMisses.Select(height => new RpcRequest(coin.RpcMethodPrefix + EC.GetBlockByNumber,
                new[]
                {
                    (object) height.ToStringHexWithPrefix(),
                    true
                })).ToArray();

            var tmp = await rpcClient.ExecuteBatchAsync(logger, ct, blockBatch);

            var transformed = tmp
                .Where(x => x.Error == null && x.Response != null)
                .Select(x => x.Response?.ToObject<DaemonResponses.Block>())
                .Where(x => x != null)
                .ToArray();

            foreach(var block in transformed)
                blockCache[(long) block.Height.Value] = block;
        }

        return blockHeights.Select(x => blockCache[x]).ToArray();
    }

    // 50 LAX halved every 210,000 blocks (kernel/xhash/consensus.go calcBlockReward)
    internal static decimal GetBaseBlockReward(ulong height)
    {
        if(height == 0)
            return 0;

        var halvings = height / ParallaxConstants.HalvingIntervalBlocks;
        if(halvings > 63)
            return 0;

        return (decimal) (ParallaxConstants.BaseRewardInitialWei / BigInteger.Pow(2, (int) halvings)) / ParallaxConstants.Wei;
    }

    private async Task<decimal> GetTxRewardAsync(DaemonResponses.Block blockInfo, CancellationToken ct)
    {
        // fetch all tx receipts in a single RPC batch request
        var batch = blockInfo.Transactions.Select(tx => new RpcRequest(coin.RpcMethodPrefix + EC.GetTxReceipt, new[] { tx.Hash }))
            .ToArray();

        var results = await rpcClient.ExecuteBatchAsync(logger, ct, batch);

        if(results.Any(x => x.Error != null))
            throw new Exception($"Error fetching tx receipts: {string.Join(", ", results.Where(x => x.Error != null).Select(y => y.Error.Message))}");

        // create lookup table
        var gasUsed = results.Select(x => x.Response.ToObject<TransactionReceipt>())
            .ToDictionary(x => x.TransactionHash, x => x.GasUsed);

        // accumulate
        var result = blockInfo.Transactions.Sum(x => (ulong) gasUsed[x.Hash] * ((decimal) x.GasPrice / ParallaxConstants.Wei));

        return result;
    }

    private async Task<string> PayoutAsync(Balance balance, CancellationToken ct)
    {
        // send transaction
        logger.Info(() => $"[{LogCategory}] Sending {FormatAmount(balance.Amount)} to {balance.Address}");

        var amount = (BigInteger) Math.Floor(balance.Amount * ParallaxConstants.Wei);

        // legacy transaction - Parallax has no EIP-1559; the node estimates gas
        // and fills in the suggested gas price
        var request = new SendTransactionRequest
        {
            From = poolConfig.Address,
            To = balance.Address,
            Value = amount.ToString("x").TrimStart('0'),
        };

        var response = await rpcClient.ExecuteAsync<string>(logger, coin.RpcMethodPrefix + EC.SendTx, ct, new[] { request });

        if(response.Error != null)
            throw new Exception($"{coin.RpcMethodPrefix}{EC.SendTx} returned error: {response.Error.Message} code {response.Error.Code}");

        if(string.IsNullOrEmpty(response.Response) || ParallaxConstants.ZeroHashPattern.IsMatch(response.Response))
            throw new Exception($"{coin.RpcMethodPrefix}{EC.SendTx} did not return a valid transaction hash");

        var txHash = response.Response;
        logger.Info(() => $"[{LogCategory}] Payment transaction id: {txHash}");

        // update db
        await PersistPaymentsAsync(new[] { balance }, txHash);

        // done
        return txHash;
    }
}
