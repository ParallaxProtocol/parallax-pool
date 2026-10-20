using System;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Miningcore.Tests.Blockchain.Parallax;

/// <summary>
/// A JSON-RPC endpoint on localhost that answers with whatever the test hands it
/// </summary>
public sealed class FakeNode : IDisposable
{
    public FakeNode(Func<string, JArray, JToken> handler)
    {
        this.handler = handler;

        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        Port = ((IPEndPoint) probe.LocalEndpoint).Port;
        probe.Stop();

        listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        listener.Start();

        _ = Task.Run(ServeAsync);
    }

    /// <summary>
    /// Thrown by a handler to answer with a JSON-RPC error
    /// </summary>
    public class RpcError : Exception
    {
        public RpcError(int code, string message) : base(message)
        {
            Code = code;
        }

        public int Code { get; }
    }

    /// <summary>
    /// Thrown by a handler to drop the connection without an answer
    /// </summary>
    public class NoAnswer : Exception
    {
    }

    private readonly HttpListener listener = new();
    private readonly Func<string, JArray, JToken> handler;

    public int Port { get; }

    /// <summary>
    /// Methods called, in order
    /// </summary>
    public ConcurrentQueue<string> Calls { get; } = new();

    private async Task ServeAsync()
    {
        while(listener.IsListening)
        {
            HttpListenerContext context;

            try
            {
                context = await listener.GetContextAsync();
            }

            catch(Exception)
            {
                return;
            }

            try
            {
                using var reader = new StreamReader(context.Request.InputStream);
                var request = JToken.Parse(await reader.ReadToEndAsync());

                var response = request is JArray batch
                    ? new JArray(batch.Select(x => Answer((JObject) x)))
                    : (JToken) Answer((JObject) request);

                var body = Encoding.UTF8.GetBytes(response.ToString());
                context.Response.ContentType = "application/json";
                await context.Response.OutputStream.WriteAsync(body);
                context.Response.Close();
            }

            catch(NoAnswer)
            {
                context.Response.Abort();
            }
        }
    }

    private JObject Answer(JObject request)
    {
        var method = request["method"]!.Value<string>();
        Calls.Enqueue(method);

        try
        {
            var result = handler(method, request["params"] as JArray ?? new JArray());
            return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result ?? JValue.CreateNull() };
        }

        catch(RpcError ex)
        {
            return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["error"] = new JObject { ["code"] = ex.Code, ["message"] = ex.Message } };
        }
    }

    public void Dispose()
    {
        listener.Close();
    }
}
