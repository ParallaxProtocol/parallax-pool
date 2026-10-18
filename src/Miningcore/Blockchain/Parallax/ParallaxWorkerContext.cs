using System.Collections.Generic;
using System.Reactive;
using System.Reactive.Linq;
using Miningcore.Mining;

namespace Miningcore.Blockchain.Parallax;

public class ParallaxWorkerContext : WorkerContextBase
{
    /// <summary>
    /// Usually a wallet address
    /// </summary>
    public override string Miner { get; set; }

    /// <summary>
    /// Arbitrary worker identififer for miners using multiple rigs
    /// </summary>
    public override string Worker { get; set; }

    /// <summary>
    /// Stratum protocol version
    /// </summary>
    public int ProtocolVersion { get; set; }

    /// <summary>
    /// Unique value assigned per worker
    /// </summary>
    public string ExtraNonce1 { get; set; }

    /// <summary>
    /// Current N job(s) assigned to this worker
    /// </summary>
    public Queue<ParallaxJob> validJobs { get; private set; } = new();

    public virtual void AddJob(ParallaxJob job, int maxActiveJobs)
    {
        if(!validJobs.Contains(job))
            validJobs.Enqueue(job);

        while(validJobs.Count > maxActiveJobs)
            validJobs.Dequeue();
    }

    public ParallaxJob GetJob(string jobId)
    {
        return validJobs.ToArray().FirstOrDefault(x => x.Id == jobId);
    }
}
