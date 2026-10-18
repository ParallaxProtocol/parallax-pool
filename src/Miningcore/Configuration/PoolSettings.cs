using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace Miningcore.Configuration;

/// <summary>
/// Settings chosen in the web UI's first-run setup, stored in a settings directory (SETTINGS_DIR):
/// settings.json for the pool and a plain "coinbase" file with the address, for the node's
/// startup script to pass to parallaxd --miner.coinbase.
/// </summary>
public record PoolSettings
{
    public string Address { get; init; }

    /// <summary>
    /// Addresses used before the current one. Blocks mined to them while they were in use still
    /// belong to this pool, so they keep maturing after the address is changed.
    /// </summary>
    public string[] PreviousAddresses { get; init; } = Array.Empty<string>();

    public static readonly Regex AddressPattern = new("^0x[0-9a-fA-F]{40}$", RegexOptions.Compiled);

    private const string SettingsFile = "settings.json";
    private const string CoinbaseFile = "coinbase";

    public static PoolSettings Load(string directory)
    {
        var path = Path.Combine(directory, SettingsFile);

        if(!File.Exists(path))
            return new PoolSettings();

        return JsonConvert.DeserializeObject<PoolSettings>(File.ReadAllText(path)) ?? new PoolSettings();
    }

    /// <summary>
    /// Switches to a new address, keeping the old one in PreviousAddresses
    /// </summary>
    public PoolSettings WithAddress(string address)
    {
        if(string.Equals(address, Address, StringComparison.OrdinalIgnoreCase))
            return this;

        var previous = string.IsNullOrEmpty(Address) ? PreviousAddresses : PreviousAddresses.Append(Address);

        return new PoolSettings
        {
            Address = address,
            PreviousAddresses = previous
                .Where(x => !string.Equals(x, address, StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray()
        };
    }

    public void Save(string directory)
    {
        Directory.CreateDirectory(directory);

        WriteAtomic(Path.Combine(directory, SettingsFile), JsonConvert.SerializeObject(this, Formatting.Indented));
        WriteAtomic(Path.Combine(directory, CoinbaseFile), Address + "\n");
    }

    private static void WriteAtomic(string path, string content)
    {
        var temp = path + ".tmp";
        File.WriteAllText(temp, content);
        File.Move(temp, path, true);
    }
}
