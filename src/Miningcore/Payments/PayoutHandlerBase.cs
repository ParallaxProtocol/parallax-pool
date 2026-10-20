using System.Data;
using System.Data.Common;
using Miningcore.Configuration;
using Miningcore.Extensions;
using Miningcore.Messaging;
using Miningcore.Mining;
using Miningcore.Notifications.Messages;
using Miningcore.Persistence;
using Miningcore.Persistence.Model;
using Miningcore.Persistence.Repositories;
using Miningcore.Time;
using NLog;
using Polly;
using Contract = Miningcore.Contracts.Contract;

namespace Miningcore.Payments;

public abstract class PayoutHandlerBase
{
    protected PayoutHandlerBase(
        IConnectionFactory cf,
        IShareRepository shareRepo,
        IBlockRepository blockRepo,
        IBalanceRepository balanceRepo,
        IPaymentRepository paymentRepo,
        IMasterClock clock,
        IMessageBus messageBus)
    {
        Contract.RequiresNonNull(cf);
        Contract.RequiresNonNull(shareRepo);
        Contract.RequiresNonNull(blockRepo);
        Contract.RequiresNonNull(balanceRepo);
        Contract.RequiresNonNull(paymentRepo);
        Contract.RequiresNonNull(clock);
        Contract.RequiresNonNull(messageBus);

        this.cf = cf;
        this.clock = clock;
        this.shareRepo = shareRepo;
        this.blockRepo = blockRepo;
        this.balanceRepo = balanceRepo;
        this.paymentRepo = paymentRepo;
        this.messageBus = messageBus;

        BuildFaultHandlingPolicy();
    }

    protected readonly IBalanceRepository balanceRepo;
    protected readonly IBlockRepository blockRepo;
    protected readonly IConnectionFactory cf;
    protected readonly IPaymentRepository paymentRepo;
    protected readonly IShareRepository shareRepo;
    protected readonly IMasterClock clock;
    protected readonly IMessageBus messageBus;
    protected ClusterConfig clusterConfig;
    private IAsyncPolicy faultPolicy;

    protected ILogger logger;
    protected PoolConfig poolConfig;
    private const int RetryCount = 8;

    protected abstract string LogCategory { get; }

    protected void BuildFaultHandlingPolicy()
    {
        var retry = Policy
            .Handle<DbException>()
            .Or<TimeoutException>()
            .WaitAndRetryAsync(RetryCount, retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)), OnRetry);

        faultPolicy = retry;
    }

    protected virtual void OnRetry(Exception ex, TimeSpan timeSpan, int retry, object context)
    {
        logger.Warn(() => $"[{LogCategory}] Retry {1} in {timeSpan} due to: {ex}");
    }

    public virtual async Task<decimal> UpdateBlockRewardBalancesAsync(IDbConnection con, IDbTransaction tx, IMiningPool pool, Block block, CancellationToken ct)
    {
        var blockRewardRemaining = block.Reward;

        // Distribute funds to configured reward recipients
        foreach(var recipient in poolConfig.RewardRecipients.Where(x => x.Percentage > 0))
        {
            var amount = block.Reward * (recipient.Percentage / 100.0m);
            var address = recipient.Address;

            blockRewardRemaining -= amount;

            // skip transfers from pool wallet to pool wallet
            if(address != poolConfig.Address)
            {
                logger.Info(() => $"Crediting {address} with {FormatAmount(amount)}");
                await balanceRepo.AddAmountAsync(con, tx, poolConfig.Id, address, amount, $"Reward for block {block.BlockHeight}");
            }
        }

        return blockRewardRemaining;
    }

    /// <summary>
    /// Takes a payment off the balance and records it as being sent, before anything is sent:
    /// whatever fails after this, the balance can't be paid out twice
    /// </summary>
    protected async Task<Payment> ReservePaymentAsync(Balance balance)
    {
        var coin = poolConfig.Template.As<CoinTemplate>();

        var payment = new Payment
        {
            PoolId = poolConfig.Id,
            Coin = coin.Symbol,
            Address = balance.Address,
            Amount = balance.Amount,
            Created = clock.Now,
            TransactionConfirmationData = string.Empty,
            Status = PaymentStatus.Sending
        };

        var id = 0L;

        await faultPolicy.ExecuteAsync(() => cf.RunTx(async (con, tx) =>
        {
            id = await paymentRepo.InsertAsync(con, tx, payment);

            logger.Info(() => $"[{LogCategory}] Resetting balance of {balance.Address}");
            await balanceRepo.AddAmountAsync(con, tx, poolConfig.Id, balance.Address, -balance.Amount, "Balance reset after payment");
        }));

        return payment with { Id = id };
    }

    protected Task UpdatePaymentStatusAsync(Payment payment, PaymentStatus status, string transactionConfirmation)
    {
        return faultPolicy.ExecuteAsync(() => cf.RunTx((con, tx) =>
            paymentRepo.UpdateStatusAsync(con, tx, payment.Id, status, transactionConfirmation)));
    }

    /// <summary>
    /// Puts a payment that certainly did not reach its recipient back on the balance
    /// </summary>
    protected Task RefundPaymentAsync(Payment payment, string usage)
    {
        logger.Info(() => $"[{LogCategory}] Refunding {FormatAmount(payment.Amount)} to the balance of {payment.Address}");

        return faultPolicy.ExecuteAsync(() => cf.RunTx(async (con, tx) =>
        {
            await paymentRepo.DeleteAsync(con, tx, payment.Id);
            await balanceRepo.AddAmountAsync(con, tx, poolConfig.Id, payment.Address, payment.Amount, usage);
        }));
    }

    public virtual double AdjustShareDifficulty(double difficulty)
    {
        return difficulty;
    }

    public string FormatAmount(decimal amount)
    {
        var coin = poolConfig.Template.As<CoinTemplate>();
        return $"{amount:0.#####} {coin.Symbol}";
    }

    protected virtual void NotifyPayoutSuccess(string poolId, Balance[] balances, string[] txHashes, decimal? txFee)
    {
        var coin = poolConfig.Template.As<CoinTemplate>();

        // admin notifications
        var explorerLinks = !string.IsNullOrEmpty(coin.ExplorerTxLink) ?
            txHashes.Select(x => string.Format(coin.ExplorerTxLink, x)).ToArray() :
            Array.Empty<string>();

        messageBus.SendMessage(new PaymentNotification(poolId, null, balances.Sum(x => x.Amount), coin.Symbol, balances.Length, txHashes, explorerLinks, txFee));
    }

    protected virtual void NotifyPayoutFailure(string poolId, Balance[] balances, string error, Exception ex)
    {
        var coin = poolConfig.Template.As<CoinTemplate>();

        messageBus.SendMessage(new PaymentNotification(poolId, error ?? ex?.Message, balances.Sum(x => x.Amount), coin.Symbol));
    }
}
