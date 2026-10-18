import { useState } from "react";
import { BlocksTable } from "../components/BlocksTable";
import { ErrorNotice } from "../components/ui";
import type { Block, Paged, Payment, PoolInfo } from "../lib/api";
import { formatAgo, formatDateTime, formatLax, shortAddress } from "../lib/format";
import { useApi, useNow } from "../lib/hooks";
import { Link } from "../lib/router";

const PAGE_SIZE = 25;

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if(pageCount <= 1)
    return null;

  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="button" disabled={page === 0} onClick={() => onPage(page - 1)}>Newer</button>
      <span>Page {page + 1} of {pageCount}</span>
      <button type="button" className="button" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Older</button>
    </nav>
  );
}

export function BlocksPage({ pool }: { pool: PoolInfo }) {
  const [page, setPage] = useState(0);
  const { data, error } = useApi<Paged<Block>>(`/api/v2/pools/${pool.id}/blocks?page=${page}&pageSize=${PAGE_SIZE}`, 30000);

  return (
    <section className="section" aria-labelledby="title">
      <div className="section-head">
        <h1 id="title">Blocks</h1>
        <p className="muted">
          A block's reward unlocks after 100 more blocks, about 17 hours. Until then it can still be orphaned if the chain reorganizes.
        </p>
      </div>
      {error && !data ? <ErrorNotice error={error} what="blocks" /> : (
        <>
          <BlocksTable blocks={data?.result ?? []} tip={pool.networkStats.blockHeight - 1}
            empty={data ? "This pool hasn't found a block yet." : "Loading…"} />
          <Pager page={page} pageCount={Math.ceil((data?.itemCount ?? 0) / PAGE_SIZE)} onPage={setPage} />
        </>
      )}
    </section>
  );
}

export function PaymentsTable({ payments }: { payments: Payment[] }) {
  const now = useNow(30000);

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Sent</th><th>To</th><th className="right">Amount</th><th>Transaction</th></tr></thead>
        <tbody>
          {payments.map(p => (
            <tr key={`${p.transactionConfirmationData}-${p.address}`}>
              <td title={formatDateTime(p.created)}>{formatAgo(p.created, now)}</td>
              <td><Link href={`/miners/${p.address}`}>{shortAddress(p.address)}</Link></td>
              <td className="right num">{formatLax(p.amount)}</td>
              <td>
                {p.transactionInfoLink
                  ? <a href={p.transactionInfoLink} target="_blank" rel="noreferrer">{shortAddress(p.transactionConfirmationData)}</a>
                  : shortAddress(p.transactionConfirmationData)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentsPage({ pool }: { pool: PoolInfo }) {
  const [page, setPage] = useState(0);
  const direct = pool.paymentProcessing.directRewards;
  const { data, error } = useApi<Paged<Payment>>(direct ? null : `/api/v2/pools/${pool.id}/payments?page=${page}&pageSize=${PAGE_SIZE}`, 60000);

  return (
    <section className="section" aria-labelledby="title">
      <div className="section-head">
        <h1 id="title">Payments</h1>
        {!direct && <p className="muted">Balances are paid once they reach {formatLax(pool.paymentProcessing.minimumPayment)}.</p>}
      </div>
      {direct ? (
        <div className="notice">
          <strong>This pool doesn't send payments.</strong>
          <span>Block rewards go directly to <a href={pool.addressInfoLink} target="_blank" rel="noreferrer">{shortAddress(pool.address)}</a> and unlock there after 100 blocks.</span>
        </div>
      ) : error && !data ? <ErrorNotice error={error} what="payments" /> : data && data.result.length === 0 ? (
        <div className="notice">No payments yet. The first ones go out once a block has unlocked and a balance reaches the minimum.</div>
      ) : (
        <>
          <PaymentsTable payments={data?.result ?? []} />
          <Pager page={page} pageCount={Math.ceil((data?.itemCount ?? 0) / PAGE_SIZE)} onPage={setPage} />
        </>
      )}
    </section>
  );
}
