using System.Globalization;
using Miningcore.Mining;
using Newtonsoft.Json.Linq;

namespace Miningcore.Configuration;

/// <summary>
/// Builds a single-pool configuration from environment variables, for container setups without a
/// config file. The result is the JSON a config file would contain, so it goes through the same schema
/// validation and deserialization. Anything beyond these settings needs a config file.
/// </summary>
public static class EnvironmentConfig
{
    /// <summary>
    /// The environment is used as configuration when it names the pool address, or a settings
    /// directory where the web UI's first-run setup stores it
    /// </summary>
    public static bool IsPresent(Func<string, string> env) =>
        !string.IsNullOrWhiteSpace(env("POOL_ADDRESS")) || !string.IsNullOrWhiteSpace(env("SETTINGS_DIR"));

    public static JObject Build(Func<string, string> env)
    {
        string Str(string name, string defaultValue = null)
        {
            var value = env(name)?.Trim();
            return string.IsNullOrEmpty(value) ? defaultValue : value;
        }

        string Required(string name) => Str(name) ?? throw new PoolStartupException($"Environment variable {name} is required");

        T Parse<T>(string name, T defaultValue, Func<string, (bool, T)> parse)
        {
            var value = Str(name);

            if(value == null)
                return defaultValue;

            var (ok, result) = parse(value);

            if(!ok)
                throw new PoolStartupException($"Environment variable {name} has an invalid value '{value}'");

            return result;
        }

        int Int(string name, int defaultValue) => Parse(name, defaultValue,
            v => (int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var r), r));

        double? Double(string name, double? defaultValue) => Parse(name, defaultValue,
            v => (double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var r), r));

        decimal Decimal(string name, decimal defaultValue) => Parse(name, defaultValue,
            v => (decimal.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var r), r));

        bool Bool(string name, bool defaultValue) => Parse(name, defaultValue, v => v.ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" => (true, true),
            "false" or "0" or "no" or "off" => (true, false),
            _ => (false, false)
        });

        var settingsDir = Str("SETTINGS_DIR");
        var settings = settingsDir != null ? PoolSettings.Load(settingsDir) : new PoolSettings();
        var address = Str("POOL_ADDRESS") ?? settings.Address;

        if(address == null && settingsDir == null)
            throw new PoolStartupException("Environment variable POOL_ADDRESS is required");

        var payoutMode = Str("PAYOUT_MODE", "direct").ToLowerInvariant();

        if(payoutMode is not ("direct" or "pool"))
            throw new PoolStartupException($"Environment variable PAYOUT_MODE must be 'direct' or 'pool', not '{payoutMode}'");

        var directRewards = payoutMode == "direct";

        // stratum port
        var varDiff = new JObject
        {
            ["minDiff"] = Double("VARDIFF_MIN", 0.05),
            ["maxDiff"] = Double("VARDIFF_MAX", null),
            ["targetTime"] = Double("VARDIFF_TARGET_TIME", 15),
            ["retargetTime"] = 90,
            ["variancePercent"] = 30
        };

        var port = new JObject
        {
            ["name"] = "default",
            ["listenAddress"] = Str("STRATUM_LISTEN_ADDRESS", "*"),
            ["difficulty"] = Double("STRATUM_DIFFICULTY", 0.25),
        };

        if(Bool("VARDIFF_ENABLED", true))
            port["varDiff"] = varDiff;

        // payouts
        var payoutScheme = Str("PAYOUT_SCHEME", "PPLNS").ToUpperInvariant();

        var paymentProcessing = new JObject
        {
            ["enabled"] = true,
            ["directRewards"] = directRewards,
            ["minimumPayment"] = Decimal("MINIMUM_PAYMENT", 1),
            ["payoutScheme"] = directRewards ? "SOLO" : payoutScheme,
            ["keepTransactionFees"] = Bool("KEEP_TRANSACTION_FEES", false),
        };

        if(!directRewards && payoutScheme is "PPLNS" or "PPLNSBF")
        {
            var schemeConfig = new JObject { ["factor"] = Double("PPLNS_FACTOR", 2) };

            if(payoutScheme == "PPLNSBF")
                schemeConfig["blockFinderPercentage"] = Double("BLOCK_FINDER_PERCENT", 5);

            paymentProcessing["payoutSchemeConfig"] = schemeConfig;
        }

        // pool fee (only meaningful when the pool pays out)
        var rewardRecipients = new JArray();
        var fee = Decimal("POOL_FEE_PERCENT", 0);

        if(fee > 0)
        {
            if(directRewards)
                throw new PoolStartupException("POOL_FEE_PERCENT has no effect with PAYOUT_MODE=direct: every block reward already goes to POOL_ADDRESS");

            rewardRecipients.Add(new JObject
            {
                ["type"] = "op",
                ["address"] = Str("POOL_FEE_ADDRESS", address),
                ["percentage"] = fee
            });
        }

        // node
        var daemon = new JObject
        {
            ["host"] = Str("NODE_HOST", "127.0.0.1"),
            ["port"] = Int("NODE_RPC_PORT", 8545),
            ["user"] = Str("NODE_RPC_USER", ""),
            ["password"] = Str("NODE_RPC_PASSWORD", ""),
        };

        var wsPort = Int("NODE_WS_PORT", 0);

        if(wsPort > 0)
            daemon["portWs"] = wsPort;

        var pool = new JObject
        {
            ["id"] = Str("POOL_ID", "lax1"),
            ["enabled"] = true,
            ["coin"] = "parallax",
            ["address"] = address,
            ["rewardRecipients"] = rewardRecipients,
            ["blockRefreshInterval"] = Int("BLOCK_REFRESH_INTERVAL", 500),
            ["clientConnectionTimeout"] = 600,
            ["banning"] = new JObject
            {
                ["enabled"] = Bool("BANNING_ENABLED", true),
                ["time"] = 600,
                ["invalidPercent"] = 50,
                ["checkThreshold"] = 50
            },
            ["ports"] = new JObject { [Int("STRATUM_PORT", 4073).ToString(CultureInfo.InvariantCulture)] = port },
            ["daemons"] = new JArray(daemon),
            ["paymentProcessing"] = paymentProcessing,
            ["previousAddresses"] = new JArray(settings.PreviousAddresses),
        };

        return new JObject
        {
            ["clusterName"] = Str("CLUSTER_NAME", "parallax-pool"),
            ["logging"] = new JObject
            {
                ["level"] = Str("LOG_LEVEL", "info"),
                ["enableConsoleLog"] = true,
                ["enableConsoleColors"] = Bool("LOG_COLORS", false),
            },
            ["banning"] = new JObject
            {
                ["manager"] = "Integrated",
                ["banOnJunkReceive"] = true,
                ["banOnInvalidShares"] = false
            },
            ["notifications"] = new JObject { ["enabled"] = false },
            ["persistence"] = new JObject
            {
                ["postgres"] = new JObject
                {
                    ["host"] = Str("DB_HOST", "127.0.0.1"),
                    ["port"] = Int("DB_PORT", 5432),
                    ["user"] = Str("DB_USER", "pool"),
                    ["password"] = Required("DB_PASSWORD"),
                    ["database"] = Str("DB_NAME", "pool"),
                }
            },
            ["paymentProcessing"] = new JObject
            {
                ["enabled"] = true,
                ["interval"] = Int("PAYMENT_INTERVAL", 600),
            },
            ["shareRecoveryFile"] = Str("SHARE_RECOVERY_FILE", "recovered-shares.txt"),
            ["api"] = new JObject
            {
                ["enabled"] = true,
                ["listenAddress"] = Str("API_LISTEN_ADDRESS", "*"),
                ["port"] = Int("API_PORT", 4000),
                ["rateLimiting"] = Int("API_RATE_LIMIT", 20) is var limit and > 0
                    ? new JObject { ["rules"] = new JArray(new JObject { ["endpoint"] = "*", ["period"] = "1s", ["limit"] = limit }) }
                    : new JObject { ["disabled"] = true },
            },
            ["settingsDirectory"] = settingsDir,
            ["allowSettingsChanges"] = Bool("SETTINGS_ALLOW_CHANGES", false),
            // without an address the pool waits for the web UI's first-run setup
            ["pools"] = address != null ? new JArray(pool) : new JArray(),
        };
    }
}
