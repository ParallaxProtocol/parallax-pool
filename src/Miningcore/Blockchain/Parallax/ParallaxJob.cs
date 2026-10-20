using System.Globalization;
using System.Numerics;
using Miningcore.Crypto.Hashing.Xhash;
using Miningcore.Extensions;
using Miningcore.Stratum;
using NLog;

namespace Miningcore.Blockchain.Parallax;

public class ParallaxJob
{
    public ParallaxJob(string id, ParallaxBlockTemplate blockTemplate, ILogger logger, XhashLight xhash)
    {
        Id = id;
        BlockTemplate = blockTemplate;
        this.logger = logger;
        this.xhash = xhash;

        blockTarget = new BigInteger(blockTemplate.Target.HexToReverseByteArray(), true);
    }

    protected Dictionary<string, HashSet<ulong>> workerNonces = new();

    public string Id { get; }
    public ParallaxBlockTemplate BlockTemplate { get; }
    protected BigInteger blockTarget;
    protected ILogger logger;
    protected XhashLight xhash;

    public record SubmitResult(Share Share, string FullNonceHex = null, string HeaderHash = null, string MixHash = null);

    protected void RegisterNonce(StratumConnection worker, ulong nonce)
    {
        if(!workerNonces.TryGetValue(worker.ConnectionId, out var nonces))
        {
            nonces = new HashSet<ulong>();
            workerNonces[worker.ConnectionId] = nonces;
        }

        if(!nonces.Add(nonce))
            throw new StratumException(StratumError.MinusOne, "duplicate share");
    }

    /// <summary>
    /// Parses a nonce of exactly 16 hex digits. Anything looser (whitespace, padding, a prefix)
    /// would let the same nonce be spelled differently and get past the duplicate check
    /// </summary>
    internal static bool TryParseNonce(string hex, out ulong nonce)
    {
        nonce = 0;

        return hex?.Length == 16 && hex.All(Uri.IsHexDigit) &&
            ulong.TryParse(hex, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out nonce);
    }

    public virtual async Task<SubmitResult> ProcessShareAsync(StratumConnection worker,
        string workerName, string fullNonceHex, string solution, CancellationToken ct)
    {
        if(!TryParseNonce(fullNonceHex, out var fullNonce))
            throw new StratumException(StratumError.MinusOne, "bad nonce " + fullNonceHex);

        // dupe check
        lock(workerNonces)
        {
            RegisterNonce(worker, fullNonce);
        }

        var context = worker.ContextAs<ParallaxWorkerContext>();

        // get dag/light cache for block
        var cache = await xhash.GetCacheAsync(logger, BlockTemplate.Height, ct);

        // compute
        if(!cache.Compute(logger, BlockTemplate.Header.HexToByteArray(), fullNonce, out var mixDigest, out var resultBytes))
            throw new StratumException(StratumError.MinusOne, "bad hash");

        // test if share meets at least workers current difficulty
        resultBytes.ReverseInPlace();
        var resultValue = resultBytes.AsSpan().ToBigInteger();
        var shareDiff = (double) BigInteger.Divide(ParallaxConstants.BigMaxValue, resultValue) / ParallaxConstants.Pow2x32;
        var stratumDifficulty = context.Difficulty;
        var ratio = shareDiff / stratumDifficulty;
        var isBlockCandidate = resultValue <= blockTarget;

        if(!isBlockCandidate && ratio < 0.99)
        {
            // check if share matched the previous difficulty from before a vardiff retarget
            if(context.VarDiff?.LastUpdate != null && context.PreviousDifficulty.HasValue)
            {
                ratio = shareDiff / context.PreviousDifficulty.Value;

                if(ratio < 0.99)
                    throw new StratumException(StratumError.LowDifficultyShare, $"low difficulty share ({shareDiff})");

                // use previous difficulty
                stratumDifficulty = context.PreviousDifficulty.Value;
            }

            else
                throw new StratumException(StratumError.LowDifficultyShare, $"low difficulty share ({shareDiff})");
        }

        var share = new Share
        {
            BlockHeight = (long) BlockTemplate.Height,
            IpAddress = worker.RemoteEndpoint?.Address?.ToString(),
            Miner = context.Miner,
            Worker = workerName,
            UserAgent = context.UserAgent,
            IsBlockCandidate = isBlockCandidate,
            Difficulty = stratumDifficulty * ParallaxConstants.Pow2x32
        };

        if(share.IsBlockCandidate)
        {
            fullNonceHex = "0x" + fullNonce.ToString("x16");
            var headerHash = BlockTemplate.Header;
            var mixHash = mixDigest.ToHexString(true);

            // the nonce tells this block apart from another solution at the same height,
            // see ParallaxPayoutHandler.ClassifyBlocksAsync
            share.TransactionConfirmationData = fullNonceHex;

            return new SubmitResult(share, fullNonceHex, headerHash, mixHash);
        }

        return new SubmitResult(share);
    }

    public virtual object[] GetJobParamsForStratum()
    {
        return new object[]
        {
            Id,
            BlockTemplate.Seed.StripHexPrefix(),
            BlockTemplate.Header.StripHexPrefix(),
            true
        };
    }

    public virtual object[] GetWorkParamsForStratum(ParallaxWorkerContext context)
    {
        // https://github.com/edsonayllon/Stratum-Implementation-For-Pantheon
        var workerTarget = BigInteger.Divide(ParallaxConstants.BigMaxValue, new BigInteger(context.Difficulty * ParallaxConstants.Pow2x32));
        var workerTargetString = workerTarget.ToByteArray(false, true).ToHexString(true);

        return new object[]
        {
            BlockTemplate.Header,
            BlockTemplate.Seed,
            workerTargetString,
        };
    }
}
