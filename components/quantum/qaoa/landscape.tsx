"use client";

import { useEffect, useRef, useState } from "react";
import { viridis } from "@/lib/landscape";
import { edgeStats, type Graph, p1Expectation } from "@/lib/quantum/maxcut";

const GAMMA_MAX = Math.PI;
const BETA_MAX = Math.PI / 2;
const RES = 160; // field resolution; the canvas scales it up smoothly

interface Props {
  graph: Graph;
  maxCutValue: number;
  /** Optimizer trajectory in (gamma, beta), drawn when depth is 1. */
  path: [number, number][] | null;
  onPick: ((gamma: number, beta: number) => void) | null;
}

/** Maps any (gamma, beta) into the plotted fundamental domain using the landscape's symmetries. */
function fold(gamma: number, beta: number): [number, number] {
  let g = ((gamma % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let b = ((beta % BETA_MAX) + BETA_MAX) % BETA_MAX;
  // Time reversal: (gamma, beta) and (2pi - gamma, pi/2 - beta) give the same expectation.
  if (g > Math.PI) {
    g = 2 * Math.PI - g;
    b = BETA_MAX - b;
  }
  return [g, b];
}

export default function Landscape({ graph, maxCutValue, path, onPick }: Props) {
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 1]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Exact depth-1 landscape from the closed-form expectation.
  useEffect(() => {
    const canvas = fieldRef.current;
    if (!canvas) return;
    const W = RES;
    const H = RES / 2;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stats = edgeStats(graph);
    const values = new Float64Array(W * H);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < H; y++) {
      const beta = BETA_MAX * (1 - (y + 0.5) / H);
      for (let x = 0; x < W; x++) {
        const v = p1Expectation(graph, GAMMA_MAX * ((x + 0.5) / W), beta, stats);
        values[y * W + x] = v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < values.length; i++) {
      const [r, g, b] = viridis(hi > lo ? (values[i] - lo) / (hi - lo) : 0.5);
      img.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const denom = maxCutValue || 1;
    // Deferred so the state update happens outside the effect body.
    const id = requestAnimationFrame(() => setRange([lo / denom, hi / denom]));
    return () => cancelAnimationFrame(id);
  }, [graph, maxCutValue]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !width) return;
    const H = width / 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    const px = ([g, b]: [number, number]) => [(g / GAMMA_MAX) * width, (1 - b / BETA_MAX) * H] as const;

    if (path && path.length) {
      const pts = path.map(([g, b]) => px(fold(g, b)));
      for (const [w, color] of [
        [4, "rgba(23, 32, 58, 0.55)"],
        [1.75, "#fdfdfb"],
      ] as const) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          // Break the line where folding makes the trajectory jump across the domain.
          const [px0, py0] = pts[i - 1] ?? [x, y];
          if (i === 0 || Math.hypot(x - px0, y - py0) > width * 0.3) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
      const [ex, ey] = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#fde725";
      ctx.fill();
      ctx.strokeStyle = "#17203a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (hover && onPick) {
      const [x, y] = px(hover);
      ctx.strokeStyle = "rgba(253, 253, 251, 0.8)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [path, width, hover, onPick]);

  const toAngles = (e: React.MouseEvent<HTMLDivElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * GAMMA_MAX,
      (1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))) * BETA_MAX,
    ];
  };

  const hoverValue = hover && maxCutValue ? p1Expectation(graph, hover[0], hover[1]) / maxCutValue : null;

  return (
    <figure>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        <div className="flex flex-col items-end justify-between font-serif text-[13px] leading-none text-ink-muted">
          <span>π/2</span>
          <span className="text-[15px] italic text-ink">β</span>
          <span>0</span>
        </div>
        <div
          ref={wrapRef}
          className={`relative aspect-[2/1] w-full overflow-hidden rounded-[3px] ${onPick ? "cursor-crosshair" : ""}`}
          onMouseMove={(e) => onPick && setHover(toAngles(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => onPick?.(...toAngles(e))}
          role="img"
          aria-label="Heat map of the depth-1 QAOA expectation over gamma and beta"
        >
          <canvas ref={fieldRef} className="absolute inset-0 h-full w-full" style={{ imageRendering: "auto" }} />
          <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
        </div>
        <div />
        <div className="flex justify-between font-serif text-[13px] leading-none text-ink-muted">
          <span>0</span>
          <span className="text-[15px] italic text-ink">γ</span>
          <span>π</span>
        </div>
      </div>
      <figcaption className="mt-3 text-[14px] leading-[1.5] text-ink-muted">
        {hoverValue !== null ? (
          <>
            <span className="font-serif italic">γ</span> {hover![0].toFixed(2)}, <span className="font-serif italic">β</span>{" "}
            {hover![1].toFixed(2)}: approximation ratio {hoverValue.toFixed(3)}
          </>
        ) : (
          <>
            Exact depth-1 landscape for this graph, from ratio {range[0].toFixed(2)} (dark) to {range[1].toFixed(2)} (yellow).
            {onPick ? " Click to choose where the optimizer starts." : ""}
          </>
        )}
      </figcaption>
    </figure>
  );
}
