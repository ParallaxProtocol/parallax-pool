import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDateTime, formatHashrate } from "../lib/format";
import { Tooltip, type TooltipState } from "./ui";

export interface Point {
  time: number; // ms
  value: number; // H/s
}

interface Props {
  points: Point[];
  label: string;
  refreshing?: boolean;
  empty: string;
}

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 64 };

/** a "nice" upper bound and step for the y-axis: 1, 2 or 5 times a power of ten */
function niceScale(max: number, ticks = 4) {
  if(max <= 0)
    return { top: 1, step: 0.25 };

  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw)!;

  return { top: Math.ceil(max / step) * step, step };
}

/** Single-series hashrate area chart with a crosshair tooltip and a table view */
export function HashrateChart({ points, label, refreshing, empty }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

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

    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
    const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;

    const yTicks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

    // x ticks on whole hours/days, about one per 120px
    const span = t1 - t0;
    const hour = 3600_000;
    const every = [1, 2, 3, 6, 12, 24, 48, 24 * 7].map(h => h * hour).find(s => span / s <= plotW / 120) ?? 24 * 7 * hour;
    const xTicks: number[] = [];

    for(let t = Math.ceil(t0 / every) * every; t <= t1; t += every)
      xTicks.push(t);

    return { x, y, line, area, yTicks, xTicks, plotW, span };
  }, [points, width]);

  if(!geometry) {
    return <div ref={frame} className="section"><div className="chart-empty">{empty}</div></div>;
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
      content: <><strong>{formatHashrate(p.value)}</strong><span className="muted">{formatDateTime(new Date(p.time).toISOString())}</span></>,
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

  return (
    <div ref={frame} className="section">
      <div ref={ref} className="chart" data-refreshing={refreshing}
        tabIndex={0} role="img" aria-label={`${label}, latest ${formatHashrate(last.value)}. Use the arrow keys to read values.`}
        onPointerMove={onMove} onPointerLeave={hide} onKeyDown={onKey} onBlur={hide}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} height={HEIGHT} aria-hidden="true">
          <g className="grid">
            {yTicks.map(v => <line key={v} x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />)}
          </g>
          <g className="axis">
            {yTicks.map(v => <text key={v} x={PAD.left - 10} y={y(v) + 4} textAnchor="end">{formatHashrate(v)}</text>)}
            {xTicks.map(t => <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle">{tickLabel(t)}</text>)}
          </g>
          <path className="area" d={area} />
          <path className="line" d={line} />
          {active != null && (
            <>
              <line className="crosshair" x1={x(points[active].time)} x2={x(points[active].time)} y1={PAD.top} y2={y(0)} />
              <circle className="dot" cx={x(points[active].time)} cy={y(points[active].value)} r={4} />
            </>
          )}
          {active == null && <circle className="dot" cx={x(last.time)} cy={y(last.value)} r={4} />}
        </svg>
        <Tooltip state={tooltip} />
      </div>

      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th className="right">{label}</th></tr></thead>
            <tbody>
              {[...points].reverse().map(p => (
                <tr key={p.time}><td>{formatDateTime(new Date(p.time).toISOString())}</td><td className="right num">{formatHashrate(p.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
