import { useRef } from "react";
import { BlocksTable } from "../components/BlocksTable";
import { HashrateChart } from "../components/HashrateChart";
import { BlockClock, LockboxGrid } from "../components/LockboxGrid";
import { BUTTON, ErrorNotice, Label, Plate, Rolling, SectionHeading } from "../components/ui";
import { DIFF1, type Block, type PerformanceSample, type PoolInfo } from "../lib/api";
import { blockReward, formatAgo, formatCompact, formatDuration, formatHashrate, formatInteger, formatLax, formatPercent, formatShareDifficulty, hashrateParts, shortAddress } from "../lib/format";
import { useApi, useNow } from "../lib/hooks";
import { Link } from "../lib/router";

function summary(pool: PoolInfo) {
  const pp = pool.paymentProcessing;

  if(pp.directRewards)
    return <>Solo mining to <span className="font-mono text-[15px] text-foreground">{shortAddress(pool.address)}</span>: every reward goes straight to that address.</>;

  const fee = pool.poolFeePercent ? `${pool.poolFeePercent}% fee` : "no fee";
  return <>A shared pool: block rewards are split with {pp.payoutScheme}, {fee}, paid out from {formatLax(pp.minimumPayment)}.</>;
}

export interface Fact {
  label: string;
  value: string;
  note?: string;
}

/** A row of figures under a hairline, each a mono label over a rolling value */
export function Facts({ items }: { items: Fact[] }) {
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-4 border-t border-border">
      {items.map(item => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1 pt-4">
          <dt className="font-mono text-[11px] tracking-[0.12em] text-muted uppercase">{item.label}</dt>
          <dd className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.02em] tabular-nums"><Rolling value={item.value} /></dd>
          {item.note && <dd className="m-0 text-xs text-muted">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** The big figure: a number whose digits roll, and its unit in a smaller, muted size */
export function Figure({ value, unit, label, id }: { value: string; unit: string; label: string; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <h1 id={id} className="font-sans text-[64px] leading-[0.95] font-semibold tracking-[-0.045em] tabular-nums sm:text-[92px]">
        <span className="sr-only">{label}: </span>
        <Rolling value={value} />
        <span className="ml-2.5 text-[24px] font-medium tracking-[-0.01em] text-muted sm:text-[32px]">{unit}</span>
      </h1>
    </div>
  );
}

export function Overview({ pool }: { pool: PoolInfo }) {
  const now = useNow(10000);
  const blocks = useApi<Block[]>(`/api/pools/${pool.id}/blocks?pageSize=100`, 30000);
  const performance = useApi<{ stats: PerformanceSample[] }>(`/api/pools/${pool.id}/performance`, 300000);

  // the hero's border glows when the pool finds a block while the page is open
  const firstBlockTime = useRef(pool.lastPoolBlockTime);
  const flash = pool.lastPoolBlockTime !== firstBlockTime.current ? pool.lastPoolBlockTime : null;

  const { poolStats, networkStats } = pool;
  const [value, unit] = hashrateParts(poolStats.poolHashrate);
  const expectedSeconds = poolStats.poolHashrate > 0 ? networkStats.networkDifficulty / poolStats.poolHashrate : Infinity;
  const share = networkStats.networkHashrate > 0 ? poolStats.poolHashrate / networkStats.networkHashrate : 0;

  const points = (performance.data?.stats ?? []).map(s => ({ time: new Date(s.created).getTime(), value: s.poolHashrate }));

  const network = [
    ["Chain", `Parallax ${networkStats.networkType}`],
    ["Block height", formatInteger(networkStats.blockHeight - 1)],
    ["Network hashrate", formatHashrate(networkStats.networkHashrate)],
    ["Difficulty", formatCompact(networkStats.networkDifficulty), `${formatShareDifficulty(networkStats.networkDifficulty / DIFF1)} in share units`],
    ["Block reward", formatLax(blockReward(networkStats.blockHeight))],
    ["Node", `${networkStats.connectedPeers} ${networkStats.connectedPeers === 1 ? "peer" : "peers"}`, networkStats.nodeVersion.split("/").slice(0, 2).join(" ")],
  ];

  return (
    <>
      <section aria-labelledby="hero-title" className="flex flex-wrap items-stretch gap-6">
        <Plate lit flash={flash} className="flex min-w-0 flex-[1_1_560px] flex-col gap-7 p-6 sm:p-8">
          <Figure id="hero-title" label="Pool hashrate" value={value} unit={unit} />
          <p className="max-w-[52ch] text-[17px] text-muted">
            {poolStats.poolHashrate > 0
              ? <>At this hashrate the pool finds a block about every <strong className="font-semibold text-foreground">{formatDuration(expectedSeconds)}</strong>, on average. </>
              : <>No miners are connected yet. <Link href="/connect" className="text-foreground underline">Connect a miner</Link> to start. </>}
            {summary(pool)}
          </p>
          <BlockClock nextHeight={networkStats.blockHeight} lastBlockTime={networkStats.lastNetworkBlockTime} />
          <div className="flex-1" />
          <Facts items={[
            { label: "Miners online", value: formatInteger(poolStats.connectedMiners) },
            { label: "Network share", value: formatPercent(share, share < 0.01 ? 2 : 1), note: `of ${formatHashrate(networkStats.networkHashrate)}` },
            { label: "Current round", value: formatPercent(pool.poolEffort, 0), note: "of expected work" },
            { label: "Blocks found", value: formatInteger(pool.totalBlocks), note: pool.lastPoolBlockTime ? `last ${formatAgo(pool.lastPoolBlockTime, now)}` : "none yet" },
          ]} />
        </Plate>

        {blocks.error && !blocks.data
          ? <ErrorNotice error={blocks.error} what="blocks" className="flex-[1_1_400px]" />
          : <LockboxGrid nextHeight={networkStats.blockHeight} blocks={blocks.data ?? []} />}
      </section>

      <section aria-labelledby="hashrate-title" className="flex flex-col gap-5">
        <SectionHeading id="hashrate-title" index="01" title="Hashrate" action={<span className="hidden text-[13px] text-muted sm:inline">Hourly averages, last 24 h</span>} />
        <Plate className="p-5 sm:p-6">
          {performance.error && !performance.data
            ? <ErrorNotice error={performance.error} what="the hashrate history" />
            : <HashrateChart points={points} label="Pool hashrate"
                empty={performance.loading ? "Loading…" : "The chart fills in once the pool has been running for a couple of hours."} />}
        </Plate>
      </section>

      <section aria-labelledby="blocks-title" className="flex flex-col gap-5">
        <SectionHeading id="blocks-title" index="02" title="Blocks"
          action={<Link href="/blocks" className={`${BUTTON.small} no-underline`}>All blocks</Link>} />
        <div className="flex flex-wrap items-start gap-6">
          <Plate className="min-w-0 flex-[3_1_640px] pt-1 pb-2">
            <BlocksTable blocks={(blocks.data ?? []).slice(0, 8)} tip={networkStats.blockHeight - 1}
              empty={isFinite(expectedSeconds)
                ? "No blocks yet. Each block is a lottery ticket: at the current hashrate, expect the first one in about this long."
                : "No blocks yet. Once miners are connected, this shows how long the first one should take."}
              expected={expectedSeconds} />
          </Plate>

          <Plate as="section" aria-labelledby="network-title" className="flex min-w-0 flex-[1_1_280px] flex-col gap-3 p-6">
            <Label as="h3" id="network-title">Network</Label>
            <dl className="m-0 flex flex-col">
              {network.map(([label, value, note]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="m-0 flex flex-col items-end text-right font-medium tabular-nums">
                    {value}
                    {note && <small className="text-xs font-normal text-muted">{note}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </Plate>
        </div>
      </section>
    </>
  );
}
