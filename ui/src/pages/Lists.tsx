import { useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { BlocksTable, ROW, TABLE, TABLE_WRAP, TD, TH } from "../components/BlocksTable";
import { BUTTON, ErrorNotice, Notice, PageHeading, Plate } from "../components/ui";
import type { Block, Paged, Payment, PoolInfo } from "../lib/api";
import { formatAgo, formatDateTime, formatLax, shortAddress } from "../lib/format";
import { useApi, useNow } from "../lib/hooks";
import { SPRING } from "../lib/motion";
import { Link } from "../lib/router";

const PAGE_SIZE = 25;

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if(pageCount <= 1)
    return null;

  return (
    <nav aria-label="Pages" className="flex items-center gap-3 text-[13px] text-muted">
      <button type="button" className={BUTTON.small} disabled={page === 0} onClick={() => onPage(page - 1)}>Newer</button>
      <span className="tabular-nums">Page {page + 1} of {pageCount}</span>
      <button type="button" className={BUTTON.small} disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Older</button>
    </nav>
  );
}

export function BlocksPage({ pool }: { pool: PoolInfo }) {
  const [page, setPage] = useState(0);
  const { data, error } = useApi<Paged<Block>>(`/api/v2/pools/${pool.id}/blocks?page=${page}&pageSize=${PAGE_SIZE}`, 30000);

  return (
    <section aria-labelledby="title" className="flex flex-col gap-8">
      <PageHeading eyebrow="Blocks" title="Every block this pool found">
        A block's reward unlocks after 100 more blocks, about 17 hours. Until then it can still be orphaned if the chain reorganizes.
      </PageHeading>
      {error && !data ? <ErrorNotice error={error} what="blocks" /> : (
        <div className="flex flex-col gap-5">
          <Plate className="pt-1 pb-2">
            <BlocksTable blocks={data?.result ?? []} tip={pool.networkStats.blockHeight - 1}
              empty={data ? "This pool hasn't found a block yet." : "Loading…"} />
          </Plate>
          <Pager page={page} pageCount={Math.ceil((data?.itemCount ?? 0) / PAGE_SIZE)} onPage={setPage} />
        </div>
      )}
    </section>
  );
}

export function PaymentsTable({ payments }: { payments: Payment[] }) {
  const now = useNow(30000);

  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <thead><tr><th className={TH}>Sent</th><th className={TH}>To</th><th className={`${TH} text-right`}>Amount</th><th className={TH}>Transaction</th></tr></thead>
        <tbody>
          <AnimatePresence initial={false}>
            {payments.map(p => (
              <m.tr key={`${p.transactionConfirmationData}-${p.address}-${p.created}`} layout="position" transition={SPRING}
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`${ROW} tabular-nums`}>
                <td className={`${TD} text-muted`} title={formatDateTime(p.created)}>{formatAgo(p.created, now)}</td>
                <td className={`${TD} font-mono text-[13px]`}><Link href={`/miners/${p.address}`} className="no-underline hover:underline">{shortAddress(p.address)}</Link></td>
                <td className={`${TD} text-right font-medium`}>{formatLax(p.amount)}</td>
                <td className={`${TD} font-mono text-[13px]`}>
                  {p.status === "sending"
                    ? <span className="font-sans text-muted">Sending…</span>
                    : p.transactionInfoLink
                      ? <a href={p.transactionInfoLink} target="_blank" rel="noreferrer" className="no-underline hover:underline">{shortAddress(p.transactionConfirmationData)}</a>
                      : shortAddress(p.transactionConfirmationData)}
                  {p.status === "pending" && <span className="ml-2 font-sans text-xs text-muted" title="Sent, waiting for confirmations">unconfirmed</span>}
                </td>
              </m.tr>
            ))}
          </AnimatePresence>
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
    <section aria-labelledby="title" className="flex flex-col gap-8">
      <PageHeading eyebrow="Payments" title="Payouts sent by this pool">
        {direct ? undefined : `Balances are paid once they reach ${formatLax(pool.paymentProcessing.minimumPayment)}.`}
      </PageHeading>
      {direct ? (
        <Notice title="This pool doesn't send payments.">
          Block rewards go directly to <a href={pool.addressInfoLink} target="_blank" rel="noreferrer" className="font-mono text-foreground underline">{shortAddress(pool.address)}</a> and unlock there after 100 blocks.
        </Notice>
      ) : error && !data ? <ErrorNotice error={error} what="payments" /> : data && data.result.length === 0 ? (
        <Notice>No payments yet. The first ones go out once a block has unlocked and a balance reaches the minimum.</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          <Plate className="pt-1 pb-2">
            <PaymentsTable payments={data?.result ?? []} />
          </Plate>
          <Pager page={page} pageCount={Math.ceil((data?.itemCount ?? 0) / PAGE_SIZE)} onPage={setPage} />
        </div>
      )}
    </section>
  );
}
