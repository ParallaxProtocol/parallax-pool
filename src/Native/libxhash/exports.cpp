/* libxhash exports for Miningcore
 *
 * Thin C ABI over the XHash reference implementation
 * (https://github.com/ParallaxProtocol/xhash), mirroring the export surface
 * of libethhash so the managed side can drive it the same way.
 *
 * "light" handles wrap a light-cache epoch context (~16 MiB, shares verified
 * via calculate_dataset_item on the fly). "full" handles wrap an in-memory
 * full-dataset context (~1 GiB+, items generated lazily on first access).
 */

#include <xhash/xhash.h>
#include <xhash/xhash.hpp>

#include <cstdint>
#include <cstring>

extern "C" {

struct xhash_return_value
{
    uint8_t result[32];
    uint8_t mix_hash[32];
    bool success;
};

#ifdef _WIN32
#define MODULE_API __declspec(dllexport)
#else
#define MODULE_API
#endif

MODULE_API void* xhash_light_new_export(uint64_t block_number)
{
    return xhash_create_epoch_context(static_cast<int>(block_number / XHASH_EPOCH_LENGTH));
}

MODULE_API void xhash_light_delete_export(void* handle)
{
    xhash_destroy_epoch_context(static_cast<xhash_epoch_context*>(handle));
}

MODULE_API void xhash_light_compute_export(
    void* handle, const uint8_t* header_hash, uint64_t nonce, xhash_return_value* ret)
{
    if(ret == nullptr)
        return;

    ret->success = false;

    if(handle == nullptr || header_hash == nullptr)
        return;

    const auto* context = static_cast<const xhash_epoch_context*>(handle);
    const xhash::hash256 h = xhash::hash256_from_bytes(header_hash);
    const xhash_result r = xhash_hash(context, &h, nonce);

    std::memcpy(ret->result, r.final_hash.bytes, sizeof(ret->result));
    std::memcpy(ret->mix_hash, r.mix_hash.bytes, sizeof(ret->mix_hash));
    ret->success = true;
}

MODULE_API void* xhash_full_new_export(uint64_t block_number)
{
    return xhash_create_epoch_context_full(static_cast<int>(block_number / XHASH_EPOCH_LENGTH));
}

MODULE_API void xhash_full_delete_export(void* handle)
{
    xhash_destroy_epoch_context_full(static_cast<xhash_epoch_context_full*>(handle));
}

MODULE_API void xhash_full_compute_export(
    void* handle, const uint8_t* header_hash, uint64_t nonce, xhash_return_value* ret)
{
    if(ret == nullptr)
        return;

    ret->success = false;

    if(handle == nullptr || header_hash == nullptr)
        return;

    auto* context = static_cast<xhash::epoch_context_full*>(handle);
    const xhash::hash256 h = xhash::hash256_from_bytes(header_hash);
    const xhash::result r = xhash::hash(*context, h, nonce);

    std::memcpy(ret->result, r.final_hash.bytes, sizeof(ret->result));
    std::memcpy(ret->mix_hash, r.mix_hash.bytes, sizeof(ret->mix_hash));
    ret->success = true;
}

MODULE_API void xhash_get_seedhash_export(uint64_t block_number, uint8_t* seed_out)
{
    if(seed_out == nullptr)
        return;

    const xhash_hash256 seed =
        xhash_calculate_epoch_seed(static_cast<int>(block_number / XHASH_EPOCH_LENGTH));

    std::memcpy(seed_out, seed.bytes, 32);
}

} // extern "C"
