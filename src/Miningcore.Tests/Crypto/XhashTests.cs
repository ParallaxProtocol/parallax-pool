using System;
using System.Threading;
using System.Threading.Tasks;
using Miningcore.Extensions;
using NLog;
using Xunit;

namespace Miningcore.Tests.Crypto;

// Test vectors generated from the Parallax reference implementation
// (github.com/ParallaxProtocol/parallax kernel/xhash: seedHash, generateCache, hashimotoLight)
public class XhashTests : TestBase
{
    private static readonly ILogger logger = LogManager.GetCurrentClassLogger();

    [Fact]
    public unsafe void Xhash_SeedHash()
    {
        var seed = new byte[32];

        fixed(byte* ptr = seed)
        {
            Miningcore.Native.XHash.xhash_get_seedhash(0, ptr);
        }

        Assert.Equal("0000000000000000000000000000000000000000000000000000000000000000", seed.ToHexString());

        fixed(byte* ptr = seed)
        {
            Miningcore.Native.XHash.xhash_get_seedhash(720, ptr);
        }

        Assert.Equal("98ad90833060d50f880b5eb465849d897ccfaebc9416082f97900ddd539a7e53", seed.ToHexString());

        fixed(byte* ptr = seed)
        {
            Miningcore.Native.XHash.xhash_get_seedhash(171 * 720, ptr);
        }

        Assert.Equal("b16823d6fe8aa7e87a22f25763227e8d1e8dfd064f668d6f5027d5b2e3d7a4e0", seed.ToHexString());
    }

    [Theory]
    [InlineData(0ul, "2a8de2adf89af77358250bf908bf04ba94a6e8c3ba87775564a41d269a05e4ce", 0x4242424242424242ul,
        "761b72420f69ac3ee622e35f6a6aeb5caff5fe3c41b0a002cc1504107dcfec24",
        "4c95f631745bdf9f26299d9f49749e8fd2e420edcc36cfcb2b6eb0d2ccfbceca")]
    [InlineData(2ul, "100cbec5e5ef82991290d0d93d758f19082e71f234cf479192a8b94df6da6bfe", 0x307692cf71b12f6dul,
        "2d12a4555976e410f9989672f6d7b38d2f20733d8d2d8b36a1863fc51568a0b3",
        "7913bb30f11bbf36a162338dbee4ccc51894d43792d9234a1336e3dee9ca803e")]
    public async Task Xhash_Compute_Light(ulong height, string headerHex, ulong nonce, string mixExpected, string finalExpected)
    {
        var light = new Miningcore.Crypto.Hashing.Xhash.XhashLight();
        light.Setup(1);

        var cache = await light.GetCacheAsync(logger, height, CancellationToken.None);

        Assert.True(cache.Compute(logger, headerHex.HexToByteArray(), nonce, out var mixDigest, out var result));
        Assert.Equal(mixExpected, mixDigest.ToHexString());
        Assert.Equal(finalExpected, result.ToHexString());

        light.Dispose();
    }
}
