import { HashrateChart } from "../components/HashrateChart";
import { LockboxGrid } from "../components/LockboxGrid";
import { BlocksTable } from "../components/BlocksTable";
import { ErrorNotice } from "../components/ui";
import { DIFF1, type Block, type PerformanceSample, type PoolInfo } from "../lib/api";
import { blockReward, formatAgo, formatCompact, formatDuration, formatHashrate, formatInteger, formatLax, formatPercent, formatShareDifficulty, hashrateParts, shortAddress } from "../lib/format";
import { useApi, useNow } from "../lib/hooks";
import { Link } from "../lib/router";

function summary(pool: PoolInfo): string {
  const pp = pool.paymentProcessing;

  if(pp.directRewards)
    return `Solo mining to ${shortAddress(pool.address)}. Every block reward this pool finds goes straight to that address.`;

  const fee = pool.poolFeePercent ? `${pool.poolFeePercent}% fee` : "no fee";
  return `A shared pool: block rewards are split with ${pp.payoutScheme}, ${fee}, paid out from ${formatLax(pp.minimumPayment)}.`;
}

export function Overview({ pool }: { pool: PoolInfo }) {
  const now = useNow(10000);
  const blocks = useApi<Block[]>(`/api/pools/${pool.id}/blocks?pageSize=100`, 30000);
  const performance = useApi<{ stats: PerformanceSample[] }>(`/api/pools/${pool.id}/performance`, 300000);

  const { poolStats, networkStats } = pool;
  const [value, unit] = hashrateParts(poolStats.poolHashrate);
  const expectedSeconds = poolStats.poolHashrate > 0 ? networkStats.networkDifficulty / poolStats.poolHashrate : Infinity;
  const share = networkStats.networkHashrate > 0 ? poolStats.poolHashrate / networkStats.networkHashrate : 0;

  const points = (performance.data?.stats ?? []).map(s => ({ time: new Date(s.created).getTime(), value: s.poolHashrate }));

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-text">
          <div className="hero-figure">
            <h1 id="hero-title" className="visually-hidden">Pool hashrate</h1>
            <span className="muted">Pool hashrate</span>
            <span className="value">{value}<span className="unit">{unit}</span></span>
          </div>

          <p className="hero-lede">
            {poolStats.poolHashrate > 0
              ? <>At this hashrate the pool finds a block about every <strong>{formatDuration(expectedSeconds)}</strong>, on average.</>
              : <>No miners are connected yet. <Link href="/connect">Connect a miner</Link> to start.</>}
            {" "}{summary(pool)}
          </p>

          <dl className="facts facts-2">
            <div><dt>Miners online</dt><dd>{formatInteger(poolStats.connectedMiners)}</dd></div>
            <div><dt>Share of the network</dt><dd>{formatPercent(share, share < 0.01 ? 2 : 1)}</dd></div>
            <div><dt>Current round</dt><dd>{formatPercent(pool.poolEffort, 0)} <small>of a block's expected work</small></dd></div>
            <div><dt>Blocks found</dt><dd>{formatInteger(pool.totalBlocks)} <small>{pool.lastPoolBlockTime ? `last ${formatAgo(pool.lastPoolBlockTime, now)}` : "none yet"}</small></dd></div>
          </dl>
        </div>

        {blocks.error && !blocks.data
          ? <ErrorNotice error={blocks.error} what="blocks" />
          : <LockboxGrid nextHeight={networkStats.blockHeight} lastBlockTime={networkStats.lastNetworkBlockTime} blocks={blocks.data ?? []} />}
      </section>

      <section className="section" aria-labelledby="hashrate-title">
        <div className="section-head">
          <h2 id="hashrate-title">Pool hashrate, last 24 hours</h2>
          <span className="muted">Hourly averages</span>
        </div>
        {performance.error && !performance.data
          ? <ErrorNotice error={performance.error} what="the hashrate history" />
          : <HashrateChart points={points} label="Pool hashrate" refreshing={performance.loading && !!performance.data}
              empty={performance.loading ? "Loading…" : "The chart fills in once the pool has been running for a couple of hours."} />}
      </section>

      <section className="section" aria-labelledby="blocks-title">
        <div className="section-head">
          <h2 id="blocks-title">Recent blocks</h2>
          <Link href="/blocks">All blocks</Link>
        </div>
        <BlocksTable blocks={(blocks.data ?? []).slice(0, 8)} tip={networkStats.blockHeight - 1}
          empty={isFinite(expectedSeconds)
            ? "No blocks yet. Each block is a lottery ticket: at the current hashrate, expect the first one in about this long."
            : "No blocks yet. Once miners are connected, this shows how long the first one should take."}
          expected={expectedSeconds} />
      </section>

      <section className="section" aria-labelledby="network-title">
        <h2 id="network-title">Network</h2>
        <dl className="facts">
          <div><dt>Chain</dt><dd>Parallax {networkStats.networkType}</dd></div>
          <div><dt>Block height</dt><dd>{formatInteger(networkStats.blockHeight - 1)}</dd></div>
          <div><dt>Network hashrate</dt><dd>{formatHashrate(networkStats.networkHashrate)}</dd></div>
          <div><dt>Difficulty</dt><dd>{formatCompact(networkStats.networkDifficulty)} <small>{formatShareDifficulty(networkStats.networkDifficulty / DIFF1)} in share units</small></dd></div>
          <div><dt>Block reward</dt><dd>{formatLax(blockReward(networkStats.blockHeight))}</dd></div>
          <div><dt>Node</dt><dd>{networkStats.connectedPeers} peers <small>{networkStats.nodeVersion.split("/").slice(0, 2).join(" ")}</small></dd></div>
        </dl>
      </section>
    </>
  );
}
