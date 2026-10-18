using System.Diagnostics;
using Miningcore.Blockchain.Parallax;
using Miningcore.Contracts;
using Miningcore.Extensions;
using Miningcore.Messaging;
using Miningcore.Notifications.Messages;
using NLog;

namespace Miningcore.Crypto.Hashing.Xhash;

public class XhashCache : IDisposable
{
    public XhashCache(ulong epoch, string dagDir = null)
    {
        Epoch = epoch;
        this.dagDir = dagDir;
        LastUsed = DateTime.Now;
    }

    private IntPtr handle = IntPtr.Zero;
    private bool isGenerated = false;
    private readonly object genLock = new();
    internal static IMessageBus messageBus;
    public ulong Epoch { get; }
    private string dagDir;
    public DateTime LastUsed { get; set; }

    public void Dispose()
    {
        if(handle != IntPtr.Zero)
        {
            // Full dataset
            if(!string.IsNullOrEmpty(dagDir))
            {
                Native.XHash.xhash_full_delete(handle);
            }
            // Light Cache
            else
            {
                Native.XHash.xhash_light_delete(handle);
            }

            handle = IntPtr.Zero;
        }
    }

    public async Task GenerateAsync(ILogger logger, CancellationToken ct)
    {
        if(handle == IntPtr.Zero)
        {
            await Task.Run(() =>
            {
                lock(genLock)
                {
                    if(!isGenerated)
                    {
                        // re-check after obtaining lock
                        if(handle != IntPtr.Zero)
                            return;

                        var started = DateTime.Now;
                        var block = Epoch * ParallaxConstants.EpochLength;

                        // Full dataset. Unlike ethash there is no memory-mapped DAG file:
                        // configuring dagDir switches to an in-memory full dataset whose
                        // items are generated lazily on first access.
                        if(!string.IsNullOrEmpty(dagDir))
                        {
                            logger.Debug(() => $"Allocating in-memory full dataset for epoch {Epoch}");

                            handle = Native.XHash.xhash_full_new(block);

                            if(handle == IntPtr.Zero)
                                throw new OutOfMemoryException("xhash_full_new memory error");

                            logger.Info(() => $"Done allocating full dataset for epoch {Epoch} after {DateTime.Now - started}");
                        }
                        // Light Cache
                        else
                        {
                            logger.Debug(() => $"Generating cache for epoch {Epoch}");

                            handle = Native.XHash.xhash_light_new(block);

                            if(handle == IntPtr.Zero)
                                throw new OutOfMemoryException("xhash_light_new memory error");

                            logger.Debug(() => $"Done generating cache for epoch {Epoch} after {DateTime.Now - started}");
                        }

                        isGenerated = true;
                    }
                }
            }, ct);
        }
    }

    public unsafe bool Compute(ILogger logger, byte[] hash, ulong nonce, out byte[] mixDigest, out byte[] result)
    {
        Contract.RequiresNonNull(hash);

        var sw = Stopwatch.StartNew();

        mixDigest = null;
        result = null;

        var value = new Native.XHash.xhash_return_value();

        // Full dataset
        if(!string.IsNullOrEmpty(dagDir))
        {
            fixed(byte* input = hash)
            {
                Native.XHash.xhash_full_compute(handle, input, nonce, ref value);
            }
        }
        // Light Cache
        else
        {
            fixed(byte* input = hash)
            {
                Native.XHash.xhash_light_compute(handle, input, nonce, ref value);
            }
        }

        if(value.success)
        {
            mixDigest = value.mix_hash.value;
            result = value.result.value;
        }

        messageBus?.SendTelemetry("Xhash", TelemetryCategory.Hash, sw.Elapsed, value.success);

        return value.success;
    }
}
