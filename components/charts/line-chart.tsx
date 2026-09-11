"use client";

import { useId, useMemo, useRef, useState } from "react";

export interface Series {
  name: string;
  color: string;
  points: [number, number][];
  dash?: string;
  width?: number;
  /** Draw only dots (for sparse or discrete data). */
  dots?: boolean;
  /** Draw the line and also mark every point. */
  markers?: boolean;
}

interface Props {
  series: Series[];
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Horizontal reference lines, e.g. a threshold. */
  hLines?: { y: number; label: string }[];
  /** Vertical marker, e.g. the selected geometry. */
  vLine?: number | null;
  onPickX?: (x: number) => void;
  formatX?: (x: number) => string;
  formatY?: (y: number) => string;
  height?: number;
  ariaLabel: string;
}

// A narrower viewBox keeps labels legible once the SVG is scaled to its column.
const W = 520;
const PAD = { l: 60, r: 12, t: 14, b: 42 };

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

export default function LineChart({
  series,
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  hLines = [],
  vLine = null,
  onPickX,
  formatX = (x) => x.toFixed(2),
  formatY = (y) => y.toFixed(3),
  height = 300,
  ariaLabel,
}: Props) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const [x0, x1] = useMemo<[number, number]>(() => {
    if (xDomain) return xDomain;
    const xs = series.flatMap((s) => s.points.map((p) => p[0]));
    return [Math.min(...xs), Math.max(...xs)];
  }, [series, xDomain]);

  const [y0, y1] = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    const ys = series.flatMap((s) => s.points.map((p) => p[1])).concat(hLines.map((h) => h.y));
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = (hi - lo || 1) * 0.06;
    return [lo - pad, hi + pad];
  }, [series, yDomain, hLines]);

  const H = height;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);

  const toDataX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const px = ((clientX - rect.left) / rect.width) * W;
    const x = x0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0);
    return Math.min(x1, Math.max(x0, x));
  };

  // Nearest point of each series to the hovered x, for the readout.
  const readout =
    hoverX === null
      ? null
      : series
          .filter((s) => s.points.length)
          .map((s) => {
            const p = s.points.reduce((best, q) => (Math.abs(q[0] - hoverX) < Math.abs(best[0] - hoverX) ? q : best));
            return { name: s.name, color: s.color, p };
          });

  const xTicks = niceTicks(x0, x1, 6);
  const yTicks = niceTicks(y0, y1, 5);

  return (
    <figure className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={`w-full select-none ${onPickX ? "cursor-crosshair" : ""}`}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => setHoverX(toDataX(e.clientX))}
        onMouseLeave={() => setHoverX(null)}
        onClick={(e) => {
          const x = toDataX(e.clientX);
          if (x !== null) onPickX?.(x);
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
          </clipPath>
        </defs>

        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="rgba(23,32,58,0.08)" />
            <text x={PAD.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="central" fontSize={13} fill="#56607a">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - PAD.b + 18} textAnchor="middle" fontSize={13} fill="#56607a">
            {formatX(t)}
          </text>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#cfd5de" />
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize={13} fill="#56607a">
          {xLabel}
        </text>
        <text
          x={14}
          y={(PAD.t + H - PAD.b) / 2}
          textAnchor="middle"
          fontSize={13}
          fill="#56607a"
          transform={`rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})`}
        >
          {yLabel}
        </text>

        <g clipPath={`url(#${clipId})`}>
          {hLines.map((h) => (
            <g key={h.label}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(h.y)} y2={sy(h.y)} stroke="#56607a" strokeDasharray="4 4" />
              {/* Put the label under the line when it would run off the top of the plot. */}
              <text
                x={W - PAD.r - 4}
                y={sy(h.y) - 6 < PAD.t + 12 ? sy(h.y) + 16 : sy(h.y) - 6}
                textAnchor="end"
                fontSize={13}
                fill="#56607a"
              >
                {h.label}
              </text>
            </g>
          ))}
          {vLine !== null && (
            <line x1={sx(vLine)} x2={sx(vLine)} y1={PAD.t} y2={H - PAD.b} stroke="#2c6690" strokeWidth={1.25} />
          )}
          {series.map((s) =>
            s.points.length > 1 && !s.dots ? (
              <path
                key={s.name}
                d={s.points.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
              />
            ) : null,
          )}
          {series.map((s) =>
            s.dots || s.markers
              ? s.points.map(([x, y], i) => (
                  <circle key={`${s.name}${i}`} cx={sx(x)} cy={sy(y)} r={3.2} fill={s.color} stroke="#fbfcfd" strokeWidth={1} />
                ))
              : null,
          )}
          {hoverX !== null && (
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(23,32,58,0.25)" strokeDasharray="3 3" />
          )}
        </g>
      </svg>
      <figcaption className="mt-1 flex min-h-[1.5rem] flex-wrap gap-x-5 gap-y-1 text-[14px] text-ink-muted" aria-hidden>
        {readout
          ? readout.map((r) => (
              <span key={r.name} className="flex items-center gap-1.5 tabular-nums">
                <span className="h-0.5 w-4" style={{ background: r.color }} />
                {r.name}: {formatY(r.p[1])} at {formatX(r.p[0])}
              </span>
            ))
          : series.map((s) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
      </figcaption>
    </figure>
  );
}
