import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { m } from "motion/react";
import { formatDateTime, formatHashrate } from "../lib/format";
import { REVEAL, SPRING } from "../lib/motion";
import { Tooltip, type TooltipState } from "./ui";

export interface Point {
  time: number; // ms
  value: number; // H/s
}

interface Props {
  points: Point[];
  label: string;
  empty: string;
}

const HEIGHT = 260;
const PAD = { top: 12, right: 8, bottom: 28, left: 72 };

/** a "nice" upper bound and step for the y-axis: 1, 2 or 5 times a power of ten */
function niceScale(max: number, ticks = 4) {
  if(max <= 0)
    return { top: 1, step: 0.25 };

  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw)!;

  return { top: Math.ceil(max / step) * step, step };
}

/**
 * Single-series hashrate area chart: a line in the logo's gradient over a fading wash, drawn in once when it
 * first appears, with a crosshair that springs between samples, a tooltip, arrow-key reading and a table view.
 * Curves bend only between samples (horizontal tangents at each), so they never overshoot the data.
 */
export function HashrateChart({ points, label, empty }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const id = useId();

  useEffect(() => {
    // the frame is always rendered (also around the empty state), so it can be measured from the start
    const el = frame.current;

    if(!el)
      return;

    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    if(points.length < 2)
      return null;

    const t0 = points[0].time;
    const t1 = points[points.length - 1].time;
    const { top, step } = niceScale(Math.max(...points.map(p => p.value)));
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

    let line = `M${x(t0).toFixed(1)},${y(points[0].value).toFixed(1)}`;

    for(let i = 1; i < points.length; i++) {
      const [x0, y0, x1, y1] = [x(points[i - 1].time), y(points[i - 1].value), x(points[i].time), y(points[i].value)];
      const mx = ((x0 + x1) / 2).toFixed(1);
      line += `C${mx},${y0.toFixed(1)} ${mx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }

    const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    const yTicks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

    // x ticks on whole hours/days, about one per 120px
    const span = t1 - t0;
    const hour = 3600_000;
    const every = [1, 2, 3, 6, 12, 24, 48, 24 * 7].map(h => h * hour).find(s => span / s <= plotW / 120) ?? 24 * 7 * hour;
    const xTicks: number[] = [];

    for(let t = Math.ceil(t0 / every) * every; t <= t1; t += every)
      xTicks.push(t);

    return { x, y, line, area, yTicks, xTicks, span };
  }, [points, width]);

  if(!geometry) {
    return (
      <div ref={frame}>
        <div className="grid h-52 place-items-center border border-dashed border-border p-4 text-center text-sm text-muted">{empty}</div>
      </div>
    );
  }

  const { x, y, line, area, yTicks, xTicks, span } = geometry;
  const daily = span > 2 * 86400_000;
  const tickLabel = (t: number) => new Date(t).toLocaleString(undefined, daily ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });

  const nearest = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const px = clientX - box.left;
    let best = 0;

    points.forEach((p, i) => {
      if(Math.abs(x(p.time) - px) < Math.abs(x(points[best].time) - px))
        best = i;
    });

    return best;
  };

  const showAt = (index: number, clientX: number, clientY: number) => {
    const p = points[index];
    setActive(index);
    setTooltip({
      x: clientX, y: clientY,
      content: <><strong className="text-[15px] font-semibold tabular-nums">{formatHashrate(p.value)}</strong><span className="text-muted">{formatDateTime(new Date(p.time).toISOString())}</span></>,
    });
  };

  const onMove = (e: PointerEvent) => showAt(nearest(e.clientX), e.clientX, e.clientY);

  const onKey = (e: KeyboardEvent) => {
    if(e.key !== "ArrowLeft" && e.key !== "ArrowRight")
      return;

    e.preventDefault();
    const index = Math.min(points.length - 1, Math.max(0, (active ?? points.length - 1) + (e.key === "ArrowRight" ? 1 : -1)));
    const box = ref.current!.getBoundingClientRect();
    showAt(index, box.left + x(points[index].time), box.top + y(points[index].value));
  };

  const hide = () => { setActive(null); setTooltip(null); };
  const last = points[points.length - 1];
  const marked = points[active ?? points.length - 1];

  return (
    <div ref={frame} className="flex flex-col gap-3">
      <div ref={ref} className="relative w-full touch-pan-y select-none" tabIndex={0} role="img"
        aria-label={`${label}, latest ${formatHashrate(last.value)}. Use the arrow keys to read values.`}
        onPointerMove={onMove} onPointerLeave={hide} onKeyDown={onKey} onBlur={hide}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} height={HEIGHT} aria-hidden="true" className="block w-full overflow-visible">
          <defs>
            <linearGradient id={`${id}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--mark-from)" />
              <stop offset="1" stopColor="var(--mark-to)" />
            </linearGradient>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--mark-to)" stopOpacity="0.3" />
              <stop offset="1" stopColor="var(--mark-from)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g>
            {yTicks.map(v => (
              <line key={v} x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} shapeRendering="crispEdges"
                stroke="var(--border)" />
            ))}
          </g>
          <g className="fill-muted font-mono text-[11px] tabular-nums">
            {yTicks.map(v => <text key={v} x={PAD.left - 12} y={y(v) + 4} textAnchor="end">{formatHashrate(v)}</text>)}
            {xTicks.map(t => <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle">{tickLabel(t)}</text>)}
          </g>
          <m.path d={area} fill={`url(#${id}-fill)`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={REVEAL} />
          <m.path d={line} fill="none" stroke={`url(#${id}-line)`} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={REVEAL} />
          {active != null && (
            <m.line y1={PAD.top} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" shapeRendering="crispEdges"
              initial={false} animate={{ x1: x(marked.time), x2: x(marked.time) }} transition={SPRING} />
          )}
          <m.circle r={5} fill="var(--mark-to)" stroke="var(--plate)" strokeWidth={3}
            initial={false} animate={{ cx: x(marked.time), cy: y(marked.value) }} transition={SPRING}
            />
        </svg>
        <Tooltip state={tooltip} />
      </div>

      <details className="group/table">
        <summary className="w-max cursor-pointer text-[13px] text-muted hover:text-foreground">Show as table</summary>
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="text-left text-[13px] text-muted"><th className="py-2 font-normal">Time</th><th className="py-2 text-right font-normal">{label}</th></tr></thead>
            <tbody>
              {[...points].reverse().map(p => (
                <tr key={p.time} className="border-t border-border">
                  <td className="py-2">{formatDateTime(new Date(p.time).toISOString())}</td>
                  <td className="py-2 text-right tabular-nums">{formatHashrate(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
