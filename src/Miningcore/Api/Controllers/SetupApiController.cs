using System.Net;
using Autofac;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;
using Miningcore.Configuration;
using NLog;

namespace Miningcore.Api.Controllers;

/// <summary>
/// First-run setup from the web UI. Only active when a settings directory is configured
/// (SETTINGS_DIR). It sets the address once; changing it later also needs AllowSettingsChanges
/// (SETTINGS_ALLOW_CHANGES), which deployments should only turn on where the UI is protected,
/// e.g. behind an authenticating reverse proxy.
/// </summary>
[Route("api/setup")]
[ApiController]
public class SetupApiController : ApiControllerBase
{
    public SetupApiController(IComponentContext ctx) : base(ctx)
    {
        lifetime = ctx.Resolve<IHostApplicationLifetime>();
    }

    private readonly IHostApplicationLifetime lifetime;
    private static readonly ILogger logger = LogManager.GetCurrentClassLogger();

    /// <summary>
    /// Exit code asking the container runtime to restart the pool so it picks up new settings
    /// </summary>
    public const int RestartExitCode = 3;

    public record SetupStatus(bool Enabled, bool Configured, bool CanChange, string Address, string[] PreviousAddresses);

    public record SetupRequest(string Address);

    [HttpGet]
    public SetupStatus Get()
    {
        if(string.IsNullOrEmpty(clusterConfig.SettingsDirectory))
            return new SetupStatus(false, clusterConfig.Pools.Any(x => x.Enabled), false, null, Array.Empty<string>());

        var settings = PoolSettings.Load(clusterConfig.SettingsDirectory);
        return Status(settings);
    }

    /// <summary>
    /// Saves the pool address and restarts the pool to apply it (the node follows the new address on its own)
    /// </summary>
    [HttpPost]
    public SetupStatus Post([FromBody] SetupRequest request)
    {
        if(string.IsNullOrEmpty(clusterConfig.SettingsDirectory))
            throw new ApiException("Setup is not enabled on this pool", HttpStatusCode.NotFound);

        var address = request?.Address?.Trim();

        if(string.IsNullOrEmpty(address) || !PoolSettings.AddressPattern.IsMatch(address))
            throw new ApiException("Enter a LAX address: 0x followed by 40 hex characters", HttpStatusCode.BadRequest);

        var current = PoolSettings.Load(clusterConfig.SettingsDirectory);

        // anyone who can reach the API can do the first-run setup, so once there is an address
        // only a deployment that protects the UI may let it be changed
        if(IsConfigured(current) && !clusterConfig.AllowSettingsChanges)
            throw new ApiException("Changing the pool address from the web UI is turned off on this pool", HttpStatusCode.Forbidden);

        var updated = current.WithAddress(address);

        if(!ReferenceEquals(updated, current))
        {
            updated.Save(clusterConfig.SettingsDirectory);
            logger.Info(() => $"Pool address set to {address}, restarting to apply it");

            // answer first, then exit with the restart code
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(1));
                Environment.ExitCode = RestartExitCode;
                lifetime.StopApplication();
            });
        }

        return Status(updated);
    }

    // an address set with POOL_ADDRESS counts too: the pool is already mining to it
    private bool IsConfigured(PoolSettings settings) =>
        !string.IsNullOrEmpty(settings.Address) || clusterConfig.Pools.Any(x => x.Enabled);

    private SetupStatus Status(PoolSettings settings)
    {
        var configured = IsConfigured(settings);
        var address = settings.Address ?? clusterConfig.Pools.FirstOrDefault(x => x.Enabled)?.Address;

        return new SetupStatus(true, configured, !configured || clusterConfig.AllowSettingsChanges, address, settings.PreviousAddresses);
    }
}
