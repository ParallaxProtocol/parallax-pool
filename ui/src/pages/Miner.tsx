import { useEffect } from "react";
import { BlocksTable } from "../components/BlocksTable";
import { HashrateChart } from "../components/HashrateChart";
import { ErrorNotice } from "../components/ui";
import { ADDRESS_PATTERN, formatAgo, formatDuration, formatHashrate, formatInteger, formatLax, formatPercent, hashrateParts, shortAddress } from "../lib/format";
import type { Block, MinerStats, Payment, PoolInfo, WorkerPerformanceContainer } from "../lib/api";
import { useApi, useNow, useStoredState } from "../lib/hooks";
import { Link } from "../lib/router";
import { ADDRESS_KEY } from "./Connect";
import { PaymentsTable } from "./Lists";

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
      <section className="section">
        <h1>That isn't a LAX address</h1>
        <p className="muted">Addresses start with 0x followed by 40 hex characters. Check what you pasted, or <Link href="/connect">connect a miner</Link> first.</p>
      </section>
    );
  }

  if(stats.error && stats.data === undefined)
    return <ErrorNotice error={stats.error} what="this miner" />;

  if(stats.data === undefined)
    return <p className="muted">Loading…</p>;

  const data = stats.data;
  const workers = Object.entries(data?.performance?.workers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const hashrate = workers.reduce((sum, [, w]) => sum + w.hashrate, 0);
  const [value, unit] = hashrateParts(hashrate);
  const expected = hashrate > 0 ? pool.networkStats.networkDifficulty / hashrate : Infinity;

  const points = (performance.data ?? []).map(sample => ({
    time: new Date(sample.created).getTime(),
    value: Object.values(sample.workers ?? {}).reduce((sum, w) => sum + w.hashrate, 0),
  }));

  return (
    <>
      <section className="section" aria-labelledby="title">
        <div className="section-head">
          <h1 id="title" title={address}>Miner {shortAddress(address)}</h1>
          {pool.addressInfoLink && <a href={pool.addressInfoLink.replace(pool.address, address)} target="_blank" rel="noreferrer">View on the explorer</a>}
        </div>

        {!data ? (
          <div className="notice">
            <strong>No shares from this address yet.</strong>
            <span>Once a rig mines with it, its hashrate shows up here within a few minutes. <Link href="/connect">How to connect</Link></span>
          </div>
        ) : (
          <div className="hero">
            <div className="hero-text">
              <div className="hero-figure">
                <span className="muted">Current hashrate</span>
                <span className="value">{value}<span className="unit">{unit}</span></span>
              </div>
              <p className="hero-lede">
                {hashrate > 0
                  ? <>On its own, this hashrate would find a block about every <strong>{formatDuration(expected)}</strong>.</>
                  : <>No rigs have submitted shares in the last few minutes.</>}
              </p>
            </div>
            <dl className="facts">
              <div><dt>Workers online</dt><dd>{workers.length}</dd></div>
              <div><dt>Current round</dt><dd>{formatPercent(data.minerEffort, 0)} <small>of a block's expected work</small></dd></div>
              <div><dt>Blocks found</dt><dd>{formatInteger(data.totalConfirmedBlocks + data.totalPendingBlocks)} <small>{data.totalPendingBlocks} maturing</small></dd></div>
              {direct ? (
                <div><dt>Rewards</dt><dd><small>Go straight to the pool address, {shortAddress(pool.address)}</small></dd></div>
              ) : (
                <>
                  <div><dt>Unpaid balance</dt><dd>{formatLax(data.pendingBalance)}</dd></div>
                  <div><dt>Paid in total</dt><dd>{formatLax(data.totalPaid)} <small>{data.lastPayment ? `last ${formatAgo(data.lastPayment, now)}` : "no payments yet"}</small></dd></div>
                </>
              )}
            </dl>
          </div>
        )}
      </section>

      {data && (
        <>
          <section className="section" aria-labelledby="workers-title">
            <h2 id="workers-title">Workers</h2>
            {workers.length === 0 ? <div className="notice">No active workers.</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Worker</th><th className="right">Hashrate</th><th className="right">Shares per minute</th></tr></thead>
                  <tbody>
                    {workers.map(([name, w]) => (
                      <tr key={name}>
                        <td>{name || "default"}</td>
                        <td className="right num">{formatHashrate(w.hashrate)}</td>
                        <td className="right num">{(w.sharesPerSecond * 60).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="chart-title">
            <div className="section-head">
              <h2 id="chart-title">Hashrate, last 24 hours</h2>
              <span className="muted">Hourly averages</span>
            </div>
            <HashrateChart points={points} label="Miner hashrate" refreshing={performance.loading && !!performance.data}
              empty="The chart fills in after the first full hour of mining." />
          </section>

          <section className="section" aria-labelledby="blocks-title">
            <h2 id="blocks-title">Blocks found</h2>
            <BlocksTable blocks={blocks.data ?? []} tip={pool.networkStats.blockHeight - 1} showFinder={false}
              empty={blocks.data ? "None yet." : "Loading…"} />
          </section>

          {!direct && (
            <section className="section" aria-labelledby="payments-title">
              <h2 id="payments-title">Payments</h2>
              {payments.data && payments.data.length > 0
                ? <PaymentsTable payments={payments.data} />
                : <div className="notice">{payments.data ? `No payments yet. Balances are paid from ${formatLax(pool.paymentProcessing.minimumPayment)}.` : "Loading…"}</div>}
            </section>
          )}
        </>
      )}
    </>
  );
}
