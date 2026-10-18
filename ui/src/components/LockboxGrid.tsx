import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { BLOCK_TIME, LOCKBOX_BLOCKS, type Block } from "../lib/api";
import { formatAgo, formatDuration, formatInteger, formatLax, shortAddress } from "../lib/format";
import { useNow } from "../lib/hooks";
import { Tooltip, type TooltipState } from "./ui";

interface Props {
  /** height the pool is currently mining (the chain tip + 1) */
  nextHeight: number;
  /** when the current tip was mined */
  lastBlockTime?: string | null;
  /** recent blocks found by this pool */
  blocks: Block[];
}

const COLUMNS = 10;

/**
 * The last 100 blocks of the chain, laid out 10 by 10, oldest first. A coinbase reward stays
 * locked until 100 more blocks have been mined, so every block in this grid is still locked:
 * the pool's own blocks light up and move through the grid until they leave it, unlocked.
 */
export function LockboxGrid({ nextHeight, lastBlockTime, blocks }: Props) {
  const tip = nextHeight - 1;
  const first = Math.max(1, tip - LOCKBOX_BLOCKS + 1);
  const now = useNow(1000);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // one short shift animation when a new block arrives
  const [shift, setShift] = useState(false);
  const lastTip = useRef(tip);

  useEffect(() => {
    if(lastTip.current !== tip && lastTip.current > 0) {
      setShift(true);
      const timer = setTimeout(() => setShift(false), 450);
      lastTip.current = tip;
      return () => clearTimeout(timer);
    }

    lastTip.current = tip;
  }, [tip]);

  const byHeight = new Map<number, Block>();

  for(const block of blocks) {
    if(block.blockHeight < first || block.blockHeight > tip)
      continue;

    // the pool can hold several records for one height (a reorg); the surviving one wins
    const existing = byHeight.get(block.blockHeight);

    if(!existing || existing.status === "orphaned")
      byHeight.set(block.blockHeight, block);
  }

  const heights = Array.from({ length: tip - first + 1 }, (_, i) => first + i);
  const rows: number[][] = [];

  for(let i = 0; i < heights.length; i += COLUMNS)
    rows.push(heights.slice(i, i + COLUMNS));

  const mine = heights.filter(h => byHeight.get(h)?.status !== "orphaned" && byHeight.has(h));
  const nextUnlock = mine.length ? mine[0] + LOCKBOX_BLOCKS - tip : null;
  const elapsed = lastBlockTime ? Math.max(0, (now - new Date(lastBlockTime).getTime()) / 1000) : 0;

  const show = (height: number, x: number, y: number) => {
    const block = byHeight.get(height);
    const left = height + LOCKBOX_BLOCKS - tip;

    setTooltip({
      x, y,
      content: block ? (
        <>
          <strong>Block {formatInteger(height)}</strong>
          <span>{block.status === "orphaned" ? "Found by this pool, orphaned" : `Found by ${shortAddress(block.miner)}, ${formatAgo(block.created, now)}`}</span>
          {block.status !== "orphaned" && <span>{formatLax(block.reward || 50)} unlocks in {left} {left === 1 ? "block" : "blocks"} (about {formatDuration(left * BLOCK_TIME)})</span>}
        </>
      ) : (
        <>
          <strong>Block {formatInteger(height)}</strong>
          <span className="muted">Mined by another miner</span>
        </>
      ),
    });
  };

  const onPointer = (height: number) => (e: PointerEvent) => show(height, e.clientX, e.clientY);
  const onFocus = (height: number) => (e: FocusEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    show(height, r.right, r.top);
  };

  return (
    <figure className="lockbox" style={{ margin: 0 }}>
      <figcaption className="section-head">
        <h2>The last 100 blocks</h2>
        <span className="muted">
          {nextUnlock != null
            ? `Next reward unlocks in ${nextUnlock} ${nextUnlock === 1 ? "block" : "blocks"}, about ${formatDuration(nextUnlock * BLOCK_TIME)}`
            : "Rewards stay locked for 100 blocks"}
        </span>
      </figcaption>

      <p className="visually-hidden">
        {mine.length
          ? `This pool found ${mine.length} of the last ${heights.length} blocks: ${mine.map(formatInteger).join(", ")}.`
          : `This pool found none of the last ${heights.length} blocks.`}
      </p>

      <div className="lockbox-grid" data-shift={shift} aria-hidden={mine.length === 0} onPointerLeave={() => setTooltip(null)}>
        {rows.map(row => [
          <span key={`l${row[0]}`} className="lockbox-row-label">{formatInteger(row[0])}</span>,
          ...row.map(height => {
            const block = byHeight.get(height);
            const kind = block ? (block.status === "orphaned" ? "orphaned" : "mine") : "other";

            return block ? (
              <button key={height} type="button" className="cell" data-kind={kind}
                aria-label={`Block ${height}, found by this pool`}
                onPointerMove={onPointer(height)} onFocus={onFocus(height)} onBlur={() => setTooltip(null)} />
            ) : (
              <span key={height} className="cell" data-kind={kind} onPointerMove={onPointer(height)} />
            );
          }),
        ])}
      </div>

      <div className="legend">
        <span><i data-kind="mine" />Found by this pool</span>
        <span><i />Other miners</span>
        <span>
          Mining block {formatInteger(nextHeight)}, {lastBlockTime ? `${formatDuration(elapsed)} since the last one` : "waiting for the node"}
        </span>
      </div>

      <Tooltip state={tooltip} />
    </figure>
  );
}
