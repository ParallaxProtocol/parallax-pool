using System.Runtime.InteropServices;

// ReSharper disable InconsistentNaming

namespace Miningcore.Native;

public static unsafe class XHash
{
    [StructLayout(LayoutKind.Sequential)]
    public struct xhash_h256_t
    {
        [MarshalAs(UnmanagedType.ByValArray, ArraySubType = UnmanagedType.U8, SizeConst = 32)] public byte[] value;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct xhash_return_value
    {
        public xhash_h256_t result;
        public xhash_h256_t mix_hash;

        [MarshalAs(UnmanagedType.U1)] public bool success;
    }

    /// <summary>
    /// Allocate and initialize a new xhash light-cache epoch context for the given block number
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_light_new_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr xhash_light_new(ulong block_number);

    /// <summary>
    /// Frees a previously allocated light-cache epoch context
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_light_delete_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern void xhash_light_delete(IntPtr handle);

    /// <summary>
    /// Compute the xhash result for the given header-hash and nonce using the light cache
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_light_compute_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern void xhash_light_compute(IntPtr handle, byte* header_hash, ulong nonce, ref xhash_return_value result);

    /// <summary>
    /// Allocate and initialize a new xhash full-dataset epoch context for the given block number.
    /// The dataset lives in memory and its items are generated lazily on first access.
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_full_new_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr xhash_full_new(ulong block_number);

    /// <summary>
    /// Frees a previously allocated full-dataset epoch context
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_full_delete_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern void xhash_full_delete(IntPtr handle);

    /// <summary>
    /// Compute the xhash result for the given header-hash and nonce using the full dataset
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_full_compute_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern void xhash_full_compute(IntPtr handle, byte* header_hash, ulong nonce, ref xhash_return_value result);

    /// <summary>
    /// Calculate the seedhash for the epoch of the given block number
    /// </summary>
    [DllImport("libxhash", EntryPoint = "xhash_get_seedhash_export", CallingConvention = CallingConvention.Cdecl)]
    public static extern void xhash_get_seedhash(ulong block_number, byte* seed_out);
}
