using System.Net;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Miningcore.Api.Middlewares;
using Xunit;

namespace Miningcore.Tests.Api;

public class IPAccessWhitelistMiddlewareTests
{
    private static async Task<(int Status, bool Passed)> RequestAsync(string path, IPAddress from)
    {
        var passed = false;

        var middleware = new IPAccessWhitelistMiddleware(_ =>
        {
            passed = true;
            return Task.CompletedTask;
        }, new[] { "/api/admin", "/metrics" }, new[] { IPAddress.Loopback }, false);

        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.Connection.RemoteIpAddress = from;

        await middleware.Invoke(context);

        return (context.Response.StatusCode, passed);
    }

    [Theory]
    [InlineData("/api/admin/payment/processing/disable")]
    [InlineData("/Api/admin/payment/processing/disable")]
    [InlineData("/API/ADMIN/payment/processing/disable")]
    [InlineData("/api/Admin")]
    [InlineData("/metrics")]
    [InlineData("/METRICS")]
    [InlineData("/Metrics/")]
    public async Task Protected_Paths_Are_Refused_From_Other_Addresses_In_Any_Case(string path)
    {
        var (status, passed) = await RequestAsync(path, IPAddress.Parse("203.0.113.7"));

        Assert.Equal((int) HttpStatusCode.Forbidden, status);
        Assert.False(passed);
    }

    [Theory]
    [InlineData("/Api/admin/payment/processing/disable")]
    [InlineData("/METRICS")]
    public async Task Protected_Paths_Are_Served_To_Whitelisted_Addresses(string path)
    {
        var (_, passed) = await RequestAsync(path, IPAddress.Loopback);

        Assert.True(passed);
    }

    [Theory]
    [InlineData("/api/pools")]
    [InlineData("/api/administrators")]
    [InlineData("/")]
    public async Task Other_Paths_Are_Open(string path)
    {
        var (_, passed) = await RequestAsync(path, IPAddress.Parse("203.0.113.7"));

        Assert.True(passed);
    }
}
