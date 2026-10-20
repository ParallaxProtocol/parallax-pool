import { useMemo, useState, type FocusEvent, type PointerEvent } from "react";
import { BLOCK_TIME, LOCKBOX_BLOCKS, type Block } from "../lib/api";
import { formatAgo, formatClock, formatDuration, formatInteger, formatLax, shortAddress } from "../lib/format";
import { useNow } from "../lib/hooks";
import { Indicator } from "./Indicator";
import { Label, Plate, Tooltip, type TooltipState } from "./ui";

interface Props {
  /** height the pool is currently mining (the chain tip + 1) */
  nextHeight: number;
  /** recent blocks found by this pool */
  blocks: Block[];
}

/** the pool's newest block carries a "just found" ring while it is this recent */
const FRESH_MS = 30 * 60_000;

/**
 * The last 100 blocks of the chain, laid out 10 by 10, oldest first. A coinbase reward stays locked until 100
 * more blocks have been mined, so every block in this grid is still locked: the pool's own blocks light up and
 * move through the grid until they leave it, unlocked.
 *
 * Deliberately light: plain elements with CSS only (a hover scale, and a short fade-in for the newest block).
 * The cells are memoized and the tooltip follows one delegated pointer handler, so hovering re-renders the
 * tooltip alone, not the hundred cells.
 */
export function LockboxGrid({ nextHeight, blocks }: Props) {
  const tip = nextHeight - 1;
  const first = Math.max(1, tip - LOCKBOX_BLOCKS + 1);
  const now = useNow(60_000);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const byHeight = useMemo(() => {
    const map = new Map<number, Block>();

    for(const block of blocks) {
      if(block.blockHeight < first || block.blockHeight > tip)
        continue;

      // the pool can hold several records for one height (a reorg); the surviving one wins
      const existing = map.get(block.blockHeight);

      if(!existing || existing.status === "orphaned")
        map.set(block.blockHeight, block);
    }

    return map;
  }, [blocks, first, tip]);

  const heights = Array.from({ length: Math.max(0, tip - first + 1) }, (_, i) => first + i);
  const mine = heights.filter(h => byHeight.has(h) && byHeight.get(h)!.status !== "orphaned");
  const nextUnlock = mine.length ? mine[0] + LOCKBOX_BLOCKS - tip : null;
  // the newest of the pool's blocks carries a ring while it is recent
  const last = mine.at(-1);
  const newest = last != null && now - new Date(byHeight.get(last)!.created).getTime() < FRESH_MS ? last : null;

  const cells = useMemo(() => {
    const out = [];

    for(let height = first; height <= tip; height++) {
      // each row opens with its first height
      if((height - first) % 10 === 0)
        out.push(<span key={`row-${(height - first) / 10}`} className="pr-2 text-right font-mono text-[10px] text-muted tabular-nums">{formatInteger(height)}</span>);

      const block = byHeight.get(height);
      const look = !block ? "bg-cell"
        : block.status === "orphaned" ? "shadow-[inset_0_0_0_1.5px_var(--critical)]"
        : `brand-gradient-mark ${height === newest ? "shadow-[0_0_0_2px_var(--plate),0_0_0_3px_var(--mark-from),0_0_18px_var(--mark-from)]" : ""}`;
      // keyed by height, so only a newly mined block mounts, and only it fades in
      const className = `aspect-square rounded-[2px] p-0 transition-transform duration-150 hover:scale-[1.18] ${height === tip ? "cell-enter" : ""} ${look}`;

      out.push(block
        ? <button key={height} type="button" data-height={height} className={className} aria-label={`Block ${height}, found by this pool`} />
        : <span key={height} data-height={height} className={className} />);
    }

    return out;
  }, [byHeight, first, tip, newest]);

  const show = (height: number, x: number, y: number) => {
    const block = byHeight.get(height);
    const left = height + LOCKBOX_BLOCKS - tip;

    setTooltip({
      x, y,
      content: block ? (
        <>
          <strong className="font-medium">Block {formatInteger(height)}</strong>
          <span className="text-muted">{block.status === "orphaned" ? "Found by this pool, orphaned" : `Found by ${shortAddress(block.miner)}, ${formatAgo(block.created, now)}`}</span>
          {block.status !== "orphaned" && <span>{formatLax(block.reward || 50)} unlocks in {left} {left === 1 ? "block" : "blocks"} (about {formatDuration(left * BLOCK_TIME)})</span>}
        </>
      ) : (
        <>
          <strong className="font-medium">Block {formatInteger(height)}</strong>
          <span className="text-muted">Mined by another miner</span>
        </>
      ),
    });
  };

  const heightOf = (target: EventTarget) => Number((target as HTMLElement).dataset?.height) || null;

  const onPointerMove = (e: PointerEvent) => {
    const height = heightOf(e.target);

    if(height)
      show(height, e.clientX, e.clientY);
    else
      setTooltip(null);
  };

  const onFocus = (e: FocusEvent) => {
    const height = heightOf(e.target);

    if(height) {
      const r = (e.target as HTMLElement).getBoundingClientRect();
      show(height, r.right, r.top);
    }
  };

  return (
    <Plate as="figure" className="m-0 flex min-w-0 flex-[1_1_400px] flex-col gap-4 p-6 sm:p-7">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label as="h2">Last 100 blocks</Label>
        <span className="text-[13px] text-muted">
          {nextUnlock != null
            ? <>Next reward unlocks in <strong className="font-medium text-foreground">{nextUnlock} {nextUnlock === 1 ? "block" : "blocks"}</strong>, ~{formatDuration(nextUnlock * BLOCK_TIME)}</>
            : "Rewards stay locked for 100 blocks"}
        </span>
      </figcaption>

      <p className="sr-only">
        {mine.length
          ? `This pool found ${mine.length} of the last ${heights.length} blocks: ${mine.map(formatInteger).join(", ")}.`
          : `This pool found none of the last ${heights.length} blocks.`}
      </p>

      <div className="grid grid-cols-[auto_repeat(10,minmax(0,1fr))] items-center gap-1" aria-hidden={mine.length === 0}
        onPointerMove={onPointerMove} onPointerLeave={() => setTooltip(null)} onFocus={onFocus} onBlur={() => setTooltip(null)}>
        {cells}
      </div>

      <div className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5"><i className="brand-gradient-mark size-[11px] rounded-[2px]" />Found by this pool</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-[11px] rounded-[2px] bg-cell" />Other miners</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-[11px] rounded-[2px] shadow-[inset_0_0_0_1.5px_var(--critical)]" />Orphaned</span>
      </div>

      <Tooltip state={tooltip} />
    </Plate>
  );
}

/** the clock's track spans this many target intervals */
const SPAN = 3;

const TICKS = ["0", "10 min target", "20 min", "30 min"];

/** How a wait this long reads; intervals are exponential, so a long one is rare but not a fault */
function verdict(elapsed: number): { tone: "good" | "warning" | "critical"; label: string } {
  if(elapsed < 1.5 * BLOCK_TIME)
    return { tone: "good", label: "On schedule" };

  return elapsed < 3 * BLOCK_TIME ? { tone: "warning", label: "Running long" } : { tone: "critical", label: "Unusually long" };
}

/**
 * The block being mined and how long the chain has waited for it, against the 10 minute target, as on
 * parallax-stats' block clock. It ticks on its own, so the page around it does not re-render every second.
 */
export function BlockClock({ nextHeight, lastBlockTime }: { nextHeight: number; lastBlockTime?: string | null }) {
  const now = useNow(1000);
  const elapsed = lastBlockTime ? Math.max(0, (now - new Date(lastBlockTime).getTime()) / 1000) : 0;
  const fill = Math.min(1, elapsed / (SPAN * BLOCK_TIME));
  const { tone, label } = verdict(elapsed);
  // how often a wait runs at least this long, capped below 100 once any time has passed
  const longer = Math.min(99, Math.round(Math.exp(-elapsed / BLOCK_TIME) * 100));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span>
          Mining block <strong className="font-semibold tabular-nums">{formatInteger(nextHeight)}</strong>
          {lastBlockTime && <> · last one <strong className="font-semibold tabular-nums">{formatClock(elapsed)}</strong> ago</>}
        </span>
        {lastBlockTime ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-muted">
            <Indicator tone={tone} />
            <span>{label}{elapsed > 0 && <span className="hidden tabular-nums sm:inline">. {longer < 1 ? "Fewer than 1%" : `${longer}%`} of blocks take longer</span>}</span>
          </span>
        ) : <span className="text-[13px] text-muted">Waiting for the node</span>}
      </div>
      <div role="meter" aria-label="Time since the last block" aria-valuemin={0} aria-valuemax={SPAN * BLOCK_TIME}
        aria-valuenow={Math.round(Math.min(elapsed, SPAN * BLOCK_TIME))} aria-valuetext={`${formatClock(elapsed)} since the last block; the target is 10 minutes`}
        className="relative h-1.5 bg-track">
        {/* keyed by the block, so a new one starts the fill afresh rather than draining it back */}
        <div key={lastBlockTime ?? ""} className="brand-gradient-mark absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear"
          style={{ width: `${fill * 100}%` }} />
        {[1, 2].map(i => <div key={i} className="absolute -inset-y-1 w-px bg-muted/60" style={{ left: `${(i / SPAN) * 100}%` }} />)}
      </div>
      <div className="relative h-4 font-mono text-[11px] text-muted">
        {TICKS.map((tick, i) => (
          <span key={tick} className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full" style={{ left: `${(i / SPAN) * 100}%` }}>
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
