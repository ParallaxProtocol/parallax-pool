using System.Numerics;
using System.Text.RegularExpressions;

namespace Miningcore.Blockchain.Parallax;

// Parallax (LAX) - https://github.com/ParallaxProtocol/parallax
// XHash PoW (ethash-derived, 720-block epochs), Bitcoin-style halving reward
// schedule (kernel/xhash/consensus.go calcBlockReward), no uncles, coinbase
// rewards are only credited 100 blocks after the block height (lockbox maturity).
public class ParallaxConstants
{
    public const ulong EpochLength = 720;
    public const ulong HalvingIntervalBlocks = 210000;
    public static readonly BigInteger WeiBig = new(1000000000000000000);
    public static readonly BigInteger BaseRewardInitialWei = 50 * WeiBig;

    // CoinbaseMaturityBlocks (kernel/chainparams/config.go)
    public const int MinConfirmations = 100;

    public const int MainnetChainId = 2110;
    public const int TestnetChainId = 2111;

    public static BigInteger BigMaxValue = BigInteger.Pow(2, 256);
    public static double Pow2x32 = Math.Pow(2, 32);
    public const decimal Wei = 1000000000000000000;
    public const string EthereumStratumVersion = "EthereumStratum/1.0.0";
    public const decimal StaticTransactionFeeReserve = 0.0025m; // in LAX
    public const string BlockTypeBlock = "block";
    public const int MinPayoutPeerCount = 1;

    public static readonly Regex ValidAddressPattern = new("^0x[0-9a-fA-F]{40}$", RegexOptions.Compiled);
    public static readonly Regex ZeroHashPattern = new("^0?x?0+$", RegexOptions.Compiled);

    public const string RpcRequestWorkerPropertyName = "worker";
}

public static class EthCommands
{
    public const string GetWork = "_getWork";
    public const string SubmitWork = "_submitWork";
    public const string GetNetVersion = "net_version";
    public const string GetClientVersion = "web3_clientVersion";
    public const string GetCoinbase = "_coinbase";
    public const string GetAccounts = "_accounts";
    public const string GetPeerCount = "net_peerCount";
    public const string GetSyncState = "_syncing";
    public const string GetBlockByNumber = "_getBlockByNumber";
    public const string GetTxReceipt = "_getTransactionReceipt";
    public const string SendTx = "_sendTransaction";
    public const string Subscribe = "_subscribe";
}
