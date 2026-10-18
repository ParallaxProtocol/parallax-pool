import { LOCKBOX_BLOCKS, type Block } from "../lib/api";
import { blockReward, formatAgo, formatDateTime, formatDuration, formatInteger, formatLax, formatPercent, shortAddress } from "../lib/format";
import { useNow } from "../lib/hooks";
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

export function BlocksTable({ blocks, tip, empty, expected, showFinder = true }: Props) {
  const now = useNow(30000);

  if(blocks.length === 0) {
    return (
      <div className="notice">
        <span>{empty}</span>
        {expected != null && isFinite(expected) && <strong>About {formatDuration(expected)}</strong>}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Block</th>
            <th>Status</th>
            <th>Maturity</th>
            <th className="right">Reward</th>
            <th className="right">Effort</th>
            {showFinder && <th>Found by</th>}
            <th>Found</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map(block => {
            const confirmations = Math.max(0, tip - block.blockHeight);

            return (
              <tr key={`${block.blockHeight}-${block.created}`}>
                <td className="num">
                  {block.infoLink && block.status !== "orphaned"
                    ? <a href={block.infoLink} target="_blank" rel="noreferrer">{formatInteger(block.blockHeight)}</a>
                    : formatInteger(block.blockHeight)}
                </td>
                <td><Status status={block.status} /></td>
                <td>
                  {block.status === "pending" ? (
                    <span className="maturity" title={`Unlocks in about ${formatDuration(Math.max(0, LOCKBOX_BLOCKS - confirmations) * 600)}`}>
                      <span className="maturity-bar"><span style={{ width: `${Math.min(100, confirmations)}%` }} /></span>
                      {Math.min(confirmations, LOCKBOX_BLOCKS)} / {LOCKBOX_BLOCKS}
                    </span>
                  ) : block.status === "confirmed" ? <span className="muted">Unlocked</span> : <span className="muted">–</span>}
                </td>
                <td className="right num">
                  {block.reward > 0 ? formatLax(block.reward)
                    : block.status === "pending" ? <span className="muted" title="Expected reward, final once the block unlocks">{formatLax(blockReward(block.blockHeight))}</span>
                    : <span className="muted">–</span>}
                </td>
                <td className="right num">{block.effort != null ? formatPercent(block.effort, 0) : <span className="muted">–</span>}</td>
                {showFinder && <td><Link href={`/miners/${block.miner}`}>{shortAddress(block.miner)}</Link></td>}
                <td title={formatDateTime(block.created)}>{formatAgo(block.created, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
