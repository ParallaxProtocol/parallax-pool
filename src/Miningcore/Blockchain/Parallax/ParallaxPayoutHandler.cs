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
using Newtonsoft.Json.Linq;
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
    private string[] previousAddresses = Array.Empty<string>();
    private ParallaxCoinTemplate coin;

    protected override string LogCategory => "Parallax Payout Handler";

    #region IPayoutHandler

    public Task ConfigureAsync(ClusterConfig cc, PoolConfig pc, CancellationToken ct)
    {
        poolConfig = pc;
        clusterConfig = cc;
        extraConfig = pc.PaymentProcessing.Extra.SafeExtensionDataAs<ParallaxPaymentProcessingConfigExtra>();

        coin = poolConfig.Template.As<ParallaxCoinTemplate>();
        previousAddresses = pc.Extra.SafeExtensionDataAs<ParallaxPoolConfigExtra>()?.PreviousAddresses ?? Array.Empty<string>();

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
                if(IsPoolCoinbase(blockInfo.Miner))
                {
                    // mature? (the on-chain lockbox credits the coinbase only after MinConfirmations blocks)
                    if(latestBlockHeight - block.BlockHeight >= ParallaxConstants.MinConfirmations)
                    {
                        // Parallax has no uncles: when the pool found more than one block at this height
                        // (two miners solving the same job), only one of them is on the chain.
                        // Blocks record their nonce, so the one on the chain is known for certain;
                        // older records without a nonce fall back to keeping the newest duplicate.
                        var onChain = IsBlockOnChain(block, blockInfo);

                        if(onChain == null)
                        {
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

                            onChain = !(totalDuplicateBlock > 1 && totalDuplicateBlockAfter > 0);
                        }

                        if(onChain == false)
                        {
                            logger.Info(() => $"[{LogCategory}] Block {block.BlockHeight} found by {block.Miner} lost to another solution at the same height");

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

                            if(IsPoolCoinbase(blockMiner) && IsBlockOnChain(block, blockHashResponse.Response) != false)
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

    /// <summary>
    /// Whether a block's coinbase is this pool: its address, or one it used before (see PoolSettings)
    /// </summary>
    private bool IsPoolCoinbase(string miner)
    {
        return string.Equals(miner, poolConfig.Address, StringComparison.OrdinalIgnoreCase) ||
            previousAddresses.Any(x => string.Equals(miner, x, StringComparison.OrdinalIgnoreCase));
    }

    public enum PaymentCheck
    {
        Waiting,
        Confirmed,
        Failed
    }

    // a payment not mined after this long is worth a warning in the log
    private static readonly TimeSpan PaymentOverdue = TimeSpan.FromHours(1);

    /// <summary>
    /// What a payment transaction's receipt (null if not mined yet) says, once it has enough confirmations
    /// </summary>
    internal static PaymentCheck CheckPayment(TransactionReceipt receipt, ulong latestBlockHeight)
    {
        // not mined, or not deep enough yet to be safe from a reorg
        if(receipt == null || latestBlockHeight < receipt.BlockNumber + ParallaxConstants.PaymentConfirmations)
            return PaymentCheck.Waiting;

        return receipt.Status switch
        {
            "0x1" => PaymentCheck.Confirmed,
            "0x0" => PaymentCheck.Failed,
            _ => PaymentCheck.Waiting
        };
    }

    /// <summary>
    /// Whether the pool's record of a block is the block on the chain at its height, by nonce.
    /// Null for records that predate storing the nonce.
    /// </summary>
    internal static bool? IsBlockOnChain(Block block, DaemonResponses.Block chainBlock)
    {
        var nonce = block.TransactionConfirmationData;

        if(string.IsNullOrEmpty(nonce) || !nonce.StartsWith("0x"))
            return null;

        return string.Equals(nonce, chainBlock.Nonce, StringComparison.OrdinalIgnoreCase);
    }

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
        // take the amount off the balance first: if anything below fails half-way, a miner can
        // end up waiting for a payment, but is never paid twice
        var payment = await ReservePaymentAsync(balance);

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

        // the node turned it down, so nothing was sent
        if(response.Error != null && response.Error.Code != RpcClient.NoResponseErrorCode)
        {
            await RefundPaymentAsync(payment, $"Refund of payment {payment.Id}, not sent: {response.Error.Message}");

            throw new Exception($"{coin.RpcMethodPrefix}{EC.SendTx} returned error: {response.Error.Message} code {response.Error.Code}");
        }

        // no usable answer: the transaction may or may not be out there, so the payment stays
        // "sending" for the operator to check rather than risk sending it again
        if(response.Error != null || string.IsNullOrEmpty(response.Response) || ParallaxConstants.ZeroHashPattern.IsMatch(response.Response))
        {
            var error = response.Error?.Message ?? $"no transaction hash ({response.Response})";

            throw new Exception($"Payment {payment.Id} of {FormatAmount(balance.Amount)} to {balance.Address} may or may not have been sent " +
                $"({coin.RpcMethodPrefix}{EC.SendTx}: {error}). It stays 'sending' until checked by hand");
        }

        var txHash = response.Response;
        logger.Info(() => $"[{LogCategory}] Payment transaction id: {txHash}");

        try
        {
            await UpdatePaymentStatusAsync(payment, PaymentStatus.Pending, txHash);
        }

        catch(Exception ex)
        {
            throw new Exception($"Payment {payment.Id} was sent in transaction {txHash} but could not be recorded: {ex.Message}", ex);
        }

        return txHash;
    }

    public async Task ConfirmPaymentsAsync(IMiningPool pool, CancellationToken ct)
    {
        var payments = await cf.Run(con => paymentRepo.GetPaymentsByStatusAsync(con, poolConfig.Id, PaymentStatus.Sending, PaymentStatus.Pending));

        foreach(var payment in payments.Where(x => x.Status == PaymentStatus.Sending))
        {
            logger.Warn(() => $"[{LogCategory}] Payment {payment.Id} of {FormatAmount(payment.Amount)} to {payment.Address} from {payment.Created:u} " +
                "may or may not have been sent. Look for it on the node and resolve it by hand (see the README)");
        }

        var pending = payments.Where(x => x.Status == PaymentStatus.Pending).ToArray();

        if(pending.Length == 0)
            return;

        var latestBlockResponse = await rpcClient.ExecuteAsync<DaemonResponses.Block>(logger, coin.RpcMethodPrefix + EC.GetBlockByNumber, ct, new[] { (object) "latest", true });

        if(latestBlockResponse.Error != null || latestBlockResponse.Response?.Height == null)
        {
            logger.Warn(() => $"[{LogCategory}] Unable to check payments: {latestBlockResponse.Error?.Message ?? "no latest block"}");
            return;
        }

        var latestBlockHeight = latestBlockResponse.Response.Height.Value;

        var receipts = await rpcClient.ExecuteBatchAsync(logger, ct, pending
            .Select(x => new RpcRequest(coin.RpcMethodPrefix + EC.GetTxReceipt, new[] { x.TransactionConfirmationData }))
            .ToArray());

        for(var i = 0; i < pending.Length; i++)
        {
            var payment = pending[i];
            var txHash = payment.TransactionConfirmationData;

            if(receipts[i].Error != null)
            {
                logger.Warn(() => $"[{LogCategory}] Unable to check payment transaction {txHash}: {receipts[i].Error.Message}");
                continue;
            }

            // null until the transaction is mined
            var receipt = receipts[i].Response is { Type: not JTokenType.Null } token ? token.ToObject<TransactionReceipt>() : null;

            switch(CheckPayment(receipt, latestBlockHeight))
            {
                case PaymentCheck.Confirmed:
                    logger.Info(() => $"[{LogCategory}] Payment transaction {txHash} confirmed in block {receipt.BlockNumber}");

                    await UpdatePaymentStatusAsync(payment, PaymentStatus.Confirmed, txHash);
                    break;

                case PaymentCheck.Failed:
                    logger.Warn(() => $"[{LogCategory}] Payment transaction {txHash} failed in block {receipt.BlockNumber}");

                    await RefundPaymentAsync(payment, $"Refund of failed payment {txHash}");
                    NotifyPayoutFailure(poolConfig.Id, new[] { new Balance { PoolId = payment.PoolId, Address = payment.Address, Amount = payment.Amount } },
                        $"Payment transaction {txHash} failed, the amount is back on the balance", null);
                    break;

                case PaymentCheck.Waiting when receipt == null && clock.Now - payment.Created > PaymentOverdue:
                    logger.Warn(() => $"[{LogCategory}] Payment transaction {txHash} from {payment.Created:u} is still not mined");
                    break;
            }
        }
    }
}
