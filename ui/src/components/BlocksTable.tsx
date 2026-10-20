import { AnimatePresence, m } from "motion/react";
import { BLOCK_TIME, LOCKBOX_BLOCKS, type Block } from "../lib/api";
import { blockReward, formatAgo, formatDateTime, formatDuration, formatInteger, formatLax, formatPercent, shortAddress } from "../lib/format";
import { useNow } from "../lib/hooks";
import { SPRING } from "../lib/motion";
import { Link } from "../lib/router";
import { Status } from "./ui";

interface Props {
  blocks: Block[];
  /** current chain tip, for the maturity column */
  tip: number;
  empty: string;
  /** expected seconds until the next block, shown in the empty state */
  expected?: number;
  showFinder?: boolean;
}

export const TABLE_WRAP = "overflow-x-auto";
export const TABLE = "w-full min-w-[640px] border-collapse text-sm";
// tables run edge to edge in their plate, so row hovers and highlights span it; the outer cells carry its padding
const EDGES = "first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
export const TH = `py-3.5 pr-4 text-left font-mono text-[10px] font-normal tracking-[0.12em] whitespace-nowrap text-muted uppercase ${EDGES}`;
export const TD = `py-3 pr-4 whitespace-nowrap ${EDGES}`;
export const ROW = "border-t border-border transition-colors duration-200 hover:bg-accent/50";

/** the newest block is marked while it is this recent */
const FRESH_MS = 30 * 60_000;

export function BlocksTable({ blocks, tip, empty, expected, showFinder = true }: Props) {
  const now = useNow(30000);

  if(blocks.length === 0) {
    // the table always sits in a panel, so its empty state is plain text in the panel
    return (
      <div className="flex max-w-[60ch] flex-col gap-1.5 px-5 py-5 sm:px-6">
        {expected != null && isFinite(expected) && <strong className="text-2xl font-medium tracking-[-0.03em]">About {formatDuration(expected)}</strong>}
        <span className="text-muted">{empty}</span>
      </div>
    );
  }

  // only the newest block found is marked, and only while it is recent
  const newest = blocks.find(b => b.status !== "orphaned");
  const marked = newest && now - new Date(newest.created).getTime() < FRESH_MS ? newest : null;

  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={TH}>Block</th>
            <th className={TH}>Status</th>
            <th className={TH}>Maturity</th>
            <th className={`${TH} text-right`}>Reward</th>
            <th className={`${TH} text-right`}>Effort</th>
            {showFinder && <th className={TH}>Found by</th>}
            <th className={TH}>Found</th>
          </tr>
        </thead>
        <tbody>
          {/* a newly found block slides in at the top; the rows below make room */}
          <AnimatePresence initial={false}>
            {blocks.map(block => {
              const confirmations = Math.min(LOCKBOX_BLOCKS, Math.max(0, tip - block.blockHeight));
              const fresh = block === marked;

              return (
                <m.tr key={`${block.blockHeight}-${block.created}`} layout="position" transition={SPRING}
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`${ROW} tabular-nums ${fresh ? "bg-brand-wash/50" : ""}`}>
                  {/* the marked row's bar sits on the plate's edge */}
                  <td className={`${TD} font-medium ${fresh ? "shadow-[inset_2px_0_0_var(--brand)]" : ""}`}>
                    {block.infoLink && block.status !== "orphaned"
                      ? <a href={block.infoLink} target="_blank" rel="noreferrer" className="no-underline hover:underline">{formatInteger(block.blockHeight)}</a>
                      : formatInteger(block.blockHeight)}
                  </td>
                  <td className={TD}><Status status={block.status} /></td>
                  <td className={TD}>
                    {block.status === "pending" ? (
                      <span className="inline-flex items-center gap-2.5 text-[13px] text-muted"
                        title={`Unlocks in about ${formatDuration((LOCKBOX_BLOCKS - confirmations) * BLOCK_TIME)}`}>
                        <span className="relative h-1 w-[72px] overflow-hidden bg-track">
                          <m.span className="brand-gradient-mark absolute inset-y-0 left-0" initial={false}
                            animate={{ width: `${(confirmations / LOCKBOX_BLOCKS) * 100}%` }} transition={SPRING} />
                        </span>
                        {confirmations} / {LOCKBOX_BLOCKS}
                      </span>
                    ) : <span className="text-[13px] text-muted">{block.status === "confirmed" ? "Unlocked" : "–"}</span>}
                  </td>
                  <td className={`${TD} text-right`}>
                    {block.reward > 0 ? formatLax(block.reward)
                      : block.status === "pending" ? <span className="text-muted" title="Expected reward, final once the block unlocks">{formatLax(blockReward(block.blockHeight))}</span>
                      : <span className="text-muted">–</span>}
                  </td>
                  <td className={`${TD} text-right text-muted`}>{block.effort != null ? formatPercent(block.effort, 0) : "–"}</td>
                  {showFinder && <td className={`${TD} font-mono text-[13px]`}><Link href={`/miners/${block.miner}`} className="no-underline hover:underline">{shortAddress(block.miner)}</Link></td>}
                  <td className={`${TD} text-muted`} title={formatDateTime(block.created)}>{formatAgo(block.created, now)}</td>
                </m.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}
