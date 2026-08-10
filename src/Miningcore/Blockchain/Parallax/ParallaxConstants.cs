using System.Numerics;
using Miningcore.Blockchain.Ethereum;

namespace Miningcore.Blockchain.Parallax;

// Parallax (LAX) - https://github.com/ParallaxProtocol/parallax
// XHash PoW (ethash-derived, 720-block epochs), Bitcoin-style halving reward
// schedule (kernel/xhash/consensus.go calcBlockReward), no uncles, coinbase
// rewards are only credited 100 blocks after the block height (lockbox maturity).
public class ParallaxConstants
{
    public const ulong EpochLength = 720;
    public const ulong HalvingIntervalBlocks = 210000;
    public static readonly BigInteger BaseRewardInitialWei = 50 * EthereumConstants.WeiBig;

    // CoinbaseMaturityBlocks (kernel/chainparams/config.go)
    public const int MinConfirmations = 100;

    public const int MainnetChainId = 2110;
    public const int TestnetChainId = 2111;
}
