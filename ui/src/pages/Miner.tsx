import { useEffect, useId } from "react";
import { BlocksTable, ROW, TABLE, TABLE_WRAP, TD, TH } from "../components/BlocksTable";
import { HashrateChart } from "../components/HashrateChart";
import { BUTTON, ErrorNotice, Label, LiveDot, Notice, PageHeading, Plate, SectionHeading, Skeleton } from "../components/ui";
import { ADDRESS_PATTERN, formatAgo, formatDuration, formatHashrate, formatInteger, formatLax, formatPercent, hashrateParts, shortAddress } from "../lib/format";
import type { Block, MinerStats, Payment, PoolInfo, WorkerPerformanceContainer } from "../lib/api";
import { useApi, useNow, useStoredState } from "../lib/hooks";
import { Link } from "../lib/router";
import { ADDRESS_KEY } from "./Connect";
import { PaymentsTable } from "./Lists";
import { Facts, Figure } from "./Overview";

/** A worker's last day of hashrate, as a small line in the logo's gradient */
function Sparkline({ values }: { values: number[] }) {
  const id = useId();

  if(values.length < 2)
    return <span className="text-[13px] text-muted">–</span>;

  const max = Math.max(...values) || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 96).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`).join("");

  return (
    <svg viewBox="0 0 96 24" width="96" height="24" aria-hidden className="block overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="1"><stop offset="0" stopColor="var(--mark-from)" /><stop offset="1" stopColor="var(--mark-to)" /></linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MinerPage({ pool, address }: { pool: PoolInfo; address: string }) {
  const valid = ADDRESS_PATTERN.test(address);
  const base = valid ? `/api/pools/${pool.id}/miners/${address}` : null;
  const direct = pool.paymentProcessing.directRewards;
  const now = useNow(30000);
  const [, setStored] = useStoredState(ADDRESS_KEY);

  const stats = useApi<MinerStats | null>(base, 30000);
  const performance = useApi<WorkerPerformanceContainer[]>(base && `${base}/performance`, 300000);
  const blocks = useApi<Block[]>(base && `${base}/blocks?pageSize=10`, 60000);
  const payments = useApi<Payment[]>(base && !direct ? `${base}/payments?pageSize=10` : null, 60000);

  // remember the last address looked up, for the header search and the connect page
  useEffect(() => { if(valid) setStored(address); }, [valid, address, setStored]);

  if(!valid) {
    return (
      <section aria-labelledby="title">
        <PageHeading eyebrow="Miner" title="That isn't a LAX address">
          Addresses start with 0x followed by 40 hex characters. Check what you pasted, or <Link href="/connect" className="text-foreground underline">connect a miner</Link> first.
        </PageHeading>
      </section>
    );
  }

  if(stats.error && stats.data === undefined)
    return <ErrorNotice error={stats.error} what="this miner" />;

  if(stats.data === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  const data = stats.data;
  const workers = Object.entries(data?.performance?.workers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const hashrate = workers.reduce((sum, [, w]) => sum + w.hashrate, 0);
  const [value, unit] = hashrateParts(hashrate);
  const expected = hashrate > 0 ? pool.networkStats.networkDifficulty / hashrate : Infinity;
  const samples = performance.data ?? [];

  const points = samples.map(sample => ({
    time: new Date(sample.created).getTime(),
    value: Object.values(sample.workers ?? {}).reduce((sum, w) => sum + w.hashrate, 0),
  }));

  const explorer = pool.addressInfoLink && (
    <a href={pool.addressInfoLink.replace(pool.address, address)} target="_blank" rel="noreferrer" className={`${BUTTON.small} no-underline`}>View on the explorer</a>
  );

  return (
    <>
      <section aria-labelledby="title">
        <Plate lit className="flex flex-col gap-7 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label className="inline-flex items-center gap-2">
              <LiveDot live={hashrate > 0} />
              <span className={hashrate > 0 ? "text-brand" : ""}>{hashrate > 0 ? "Mining" : "Idle"}</span>
              <span aria-hidden>·</span>
              <span title={address}>Miner <span className="normal-case">{shortAddress(address)}</span></span>
            </Label>
            {explorer}
          </div>

          {!data ? (
            <div className="flex flex-col gap-3">
              <h1 id="title" className="text-[40px] leading-[1.05] sm:text-[52px]">No shares from this address yet</h1>
              <p className="max-w-[62ch] text-[17px] text-muted">
                Once a rig mines with it, its hashrate shows up here within a few minutes. <Link href="/connect" className="text-foreground underline">How to connect</Link>
              </p>
            </div>
          ) : (
            <>
              <Figure id="title" label="Current hashrate" value={value} unit={unit} />
              <p className="max-w-[52ch] text-[17px] text-muted">
                {hashrate > 0
                  ? <>On its own, this hashrate would find a block about every <strong className="font-semibold text-foreground">{formatDuration(expected)}</strong>.</>
                  : "No rigs have submitted shares in the last few minutes."}
              </p>
              <Facts items={[
                { label: "Workers online", value: formatInteger(workers.length) },
                { label: "Current round", value: formatPercent(data.minerEffort, 0), note: "of expected work" },
                { label: "Blocks found", value: formatInteger(data.totalConfirmedBlocks + data.totalPendingBlocks), note: `${data.totalPendingBlocks} maturing` },
                ...(direct
                  ? [{ label: "Rewards", value: "Direct", note: `to ${shortAddress(pool.address)}` }]
                  : [
                      { label: "Unpaid balance", value: formatLax(data.pendingBalance) },
                      { label: "Paid in total", value: formatLax(data.totalPaid), note: data.lastPayment ? `last ${formatAgo(data.lastPayment, now)}` : "no payments yet" },
                    ]),
              ]} />
            </>
          )}
        </Plate>
      </section>

      {data && (
        <>
          <section aria-labelledby="workers-title" className="flex flex-col gap-5">
            <SectionHeading id="workers-title" index="01" title="Workers" />
            {workers.length === 0 ? <Notice>No active workers.</Notice> : (
              <Plate className="pt-1 pb-2">
                <div className={TABLE_WRAP}>
                  <table className={TABLE}>
                    <thead><tr><th className={TH}>Worker</th><th className={TH}>Last 24 hours</th><th className={`${TH} text-right`}>Hashrate</th><th className={`${TH} text-right`}>Shares per minute</th></tr></thead>
                    <tbody>
                      {workers.map(([name, w]) => (
                        <tr key={name} className={`${ROW} tabular-nums`}>
                          <td className={TD}><span className="inline-flex items-center gap-2.5 font-mono text-[13px]"><LiveDot live={w.hashrate > 0} />{name || "default"}</span></td>
                          <td className={TD}><Sparkline values={samples.map(s => s.workers?.[name]?.hashrate ?? 0)} /></td>
                          <td className={`${TD} text-right font-medium`}>{formatHashrate(w.hashrate)}</td>
                          <td className={`${TD} text-right text-muted`}>{(w.sharesPerSecond * 60).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Plate>
            )}
          </section>

          <section aria-labelledby="chart-title" className="flex flex-col gap-5">
            <SectionHeading id="chart-title" index="02" title="Hashrate" action={<span className="hidden text-[13px] text-muted sm:inline">Hourly averages, last 24 h</span>} />
            <Plate className="p-5 sm:p-6">
              <HashrateChart points={points} label="Miner hashrate" empty="The chart fills in after the first full hour of mining." />
            </Plate>
          </section>

          <section aria-labelledby="blocks-title" className="flex flex-col gap-5">
            <SectionHeading id="blocks-title" index="03" title="Blocks found" />
            <Plate className="pt-1 pb-2">
              <BlocksTable blocks={blocks.data ?? []} tip={pool.networkStats.blockHeight - 1} showFinder={false}
                empty={blocks.data ? "None yet." : "Loading…"} />
            </Plate>
          </section>

          {!direct && (
            <section aria-labelledby="payments-title" className="flex flex-col gap-5">
              <SectionHeading id="payments-title" index="04" title="Payments" />
              {payments.data && payments.data.length > 0
                ? <Plate className="pt-1 pb-2"><PaymentsTable payments={payments.data} /></Plate>
                : <Notice>{payments.data ? `No payments yet. Balances are paid from ${formatLax(pool.paymentProcessing.minimumPayment)}.` : "Loading…"}</Notice>}
            </section>
          )}
        </>
      )}
    </>
  );
}
