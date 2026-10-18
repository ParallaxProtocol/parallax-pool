using Miningcore.Api.Responses;
using Miningcore.Blockchain;
using Miningcore.Configuration;
using Miningcore.Extensions;
using Miningcore.Mining;

namespace Miningcore.Api.Extensions;

public static class MiningPoolExtensions
{
    public static PoolInfo ToPoolInfo(this PoolConfig poolConfig, Persistence.Model.PoolStats stats, IMiningPool pool)
    {
        var poolInfo = poolConfig.ToApi();

        poolInfo.PoolStats = stats.ToMiningPoolStats();
        poolInfo.NetworkStats = pool?.NetworkStats ?? stats.ToBlockchainStats();

        // pool wallet link
        var addressInfobaseUrl = poolConfig.Template.ExplorerAccountLink;
        if(!string.IsNullOrEmpty(addressInfobaseUrl))
            poolInfo.AddressInfoLink = string.Format(addressInfobaseUrl, poolInfo.Address);

        // pool fees
        poolInfo.PoolFeePercent = poolConfig.RewardRecipients != null ? (float) poolConfig.RewardRecipients.Sum(x => x.Percentage) : 0;

        // payout scheme parameters (optional in the config, e.g. SOLO has none)
        if(poolInfo.PaymentProcessing != null)
        {
            var payoutSchemeConfig = poolConfig.PaymentProcessing.PayoutSchemeConfig?.ToObject<ApiPoolPayoutSchemeConfig>() ?? new ApiPoolPayoutSchemeConfig();

            var scheme = poolConfig.PaymentProcessing.PayoutScheme;

            // only show the parameters the configured scheme actually uses
            if(scheme is not (PayoutScheme.PPLNS or PayoutScheme.PPLNSBF))
                payoutSchemeConfig.Factor = null;

            if(scheme != PayoutScheme.PPLNSBF)
                payoutSchemeConfig.BlockFinderPercentage = null;

            poolInfo.PaymentProcessing.PayoutSchemeConfig = payoutSchemeConfig;
        }

        // strip security critical stuff
        if(poolInfo.Ports != null)
        {
            foreach(var port in poolInfo.Ports.Keys)
            {
                var portInfo = poolInfo.Ports[port];

                portInfo.TlsPfxFile = null;
                portInfo.TlsPfxPassword = null;
            }
        }
        return poolInfo;
    }
}
