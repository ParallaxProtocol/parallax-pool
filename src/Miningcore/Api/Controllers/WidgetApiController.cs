using System.Collections.Concurrent;
using Autofac;
using Microsoft.AspNetCore.Mvc;
using Miningcore.Extensions;
using Miningcore.Mining;
using Miningcore.Persistence.Repositories;

namespace Miningcore.Api.Controllers;

/// <summary>
/// Home-screen widgets (umbrelOS "four-stats" format)
/// </summary>
[Route("api/widgets")]
[ApiController]
public class WidgetApiController : ApiControllerBase
{
    public WidgetApiController(IComponentContext ctx) : base(ctx)
    {
        pools = ctx.Resolve<ConcurrentDictionary<string, IMiningPool>>();
        blocksRepo = ctx.Resolve<IBlockRepository>();
    }

    private readonly ConcurrentDictionary<string, IMiningPool> pools;
    private readonly IBlockRepository blocksRepo;

    public record WidgetItem(string Title, string Text, string Subtext = null);
    public record Widget(string Type, string Refresh, string Link, WidgetItem[] Items);

    [HttpGet("summary")]
    public async Task<Widget> GetSummaryAsync(CancellationToken ct)
    {
        var config = clusterConfig.Pools.FirstOrDefault(x => x.Enabled);

        if(config == null || !pools.TryGetValue(config.Id, out var pool))
        {
            return new Widget("four-stats", "30s", "", new[]
            {
                new WidgetItem("Status", "Setup"),
                new WidgetItem("Hashrate", "–"),
                new WidgetItem("Blocks found", "–"),
                new WidgetItem("Block height", "–"),
            });
        }

        var hashrate = FormatHashrate(pool.PoolStats?.PoolHashrate ?? 0);
        var blocks = await cf.Run(con => blocksRepo.GetPoolBlockCountAsync(con, config.Id, ct));
        var syncing = pool.NetworkStats?.SyncProgress;

        var status = pool.IsOnline ? new WidgetItem("Status", "Mining") :
            syncing.HasValue ? new WidgetItem("Status", "Syncing", $"{syncing.Value:P0}") :
            new WidgetItem("Status", "Starting");

        return new Widget("four-stats", "30s", "", new[]
        {
            status,
            new WidgetItem("Hashrate", hashrate.Value, hashrate.Unit),
            new WidgetItem("Blocks found", blocks.ToString()),
            new WidgetItem("Block height", pool.NetworkStats?.BlockHeight > 0 ? (pool.NetworkStats.BlockHeight - 1).ToString("N0") : "–"),
        });
    }

    private static (string Value, string Unit) FormatHashrate(double hashrate)
    {
        var units = new[] { "H/s", "kH/s", "MH/s", "GH/s", "TH/s" };
        var unit = 0;

        while(hashrate >= 1000 && unit < units.Length - 1)
        {
            hashrate /= 1000;
            unit++;
        }

        return (hashrate >= 100 ? hashrate.ToString("0") : hashrate.ToString("0.##"), units[unit]);
    }
}
