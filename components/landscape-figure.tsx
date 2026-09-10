"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ascentPath,
  BETA_MAX,
  cutFraction,
  GAMMA_MAX,
  OPTIMUM,
  viridis,
} from "@/lib/landscape";

type Point = [number, number];

const F_MIN = 1 - OPTIMUM; // landscape is symmetric around 1/2
const F_MAX = OPTIMUM;
const CONTOUR_STEP = 0.03;
const INITIAL_START: Point = [1.35, 0.15];
const KEY_STEP = 0.05;

function fmt(x: number, digits = 2) {
  return x.toFixed(digits);
}

export default function LandscapeFigure() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);

  const [size, setSize] = useState<{ w: number; h: number; dpr: number } | null>(null);
  const [path, setPath] = useState<Point[]>([]);
  const [shown, setShown] = useState(0); // number of path points revealed so far
  const [probe, setProbe] = useState<Point | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Track the rendered size of the plot area.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height), dpr: Math.min(window.devicePixelRatio || 1, 2) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Paint the scalar field with contour lines. Only re-runs on resize.
  useEffect(() => {
    const canvas = fieldRef.current;
    if (!canvas || !size) return;
    const W = Math.max(1, Math.round(size.w * size.dpr));
    const H = Math.max(1, Math.round(size.h * size.dpr));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Evaluate the field once per pixel, then derive colors and contour bands.
    const values = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const beta = BETA_MAX * (1 - (y + 0.5) / H);
      for (let x = 0; x < W; x++) {
        const gamma = GAMMA_MAX * ((x + 0.5) / W);
        values[y * W + x] = cutFraction(gamma, beta);
      }
    }

    const img = ctx.createImageData(W, H);
    const band = (v: number) => Math.floor(v / CONTOUR_STEP);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = values[i];
        let [r, g, b] = viridis((v - F_MIN) / (F_MAX - F_MIN));
        const b0 = band(v);
        const edge =
          (x + 1 < W && band(values[i + 1]) !== b0) || (y + 1 < H && band(values[i + W]) !== b0);
        if (edge) {
          // Blend contour pixels toward white.
          r += (255 - r) * 0.32;
          g += (255 - g) * 0.32;
          b += (255 - b) * 0.32;
        }
        const o = i * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [size]);

  const toPixel = useCallback(
    ([gamma, beta]: Point): [number, number] => {
      if (!size) return [0, 0];
      return [(gamma / GAMMA_MAX) * size.w, (1 - beta / BETA_MAX) * size.h];
    },
    [size],
  );

  // Start gradient ascent from a point, animated unless reduced motion is requested.
  const runFrom = useCallback((start: Point) => {
    const p = ascentPath(start);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    setPath(p);
    const end = p[p.length - 1];
    const message = `Gradient ascent stopped after ${p.length - 1} steps at γ ${fmt(end[0])}, β ${fmt(end[1])}, cut fraction ${fmt(cutFraction(end[0], end[1]), 3)}.`;
    if (reduce) {
      setShown(p.length);
      setAnnouncement(message);
      return;
    }
    setShown(1);
    const startTime = performance.now();
    const msPerStep = 28;
    const tick = (now: number) => {
      const n = Math.min(p.length, 1 + Math.floor((now - startTime) / msPerStep));
      setShown(n);
      if (n < p.length) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setAnnouncement(message);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  // The one orchestrated moment on page load.
  useEffect(() => {
    // Deferred to the next frame so state updates happen outside the effect body.
    const id = requestAnimationFrame(() => runFrom(INITIAL_START));
    return () => {
      cancelAnimationFrame(id);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [runFrom]);

  // Draw path, markers and probe on the overlay canvas.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !size) return;
    canvas.width = Math.round(size.w * size.dpr);
    canvas.height = Math.round(size.h * size.dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const visible = path.slice(0, shown);
    if (visible.length > 0) {
      const pts = visible.map(toPixel);
      // Dark casing first, then the light stroke on top, so the path reads on any color.
      for (const [width, color] of [
        [4, "rgba(23, 32, 58, 0.55)"],
        [1.75, "#fdfdfb"],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
      const [sx, sy] = pts[0];
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fdfdfb";
      ctx.fill();
      const [ex, ey] = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(ex, ey, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fde725";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#17203a";
      ctx.stroke();
    }

    if (probe) {
      const [px, py] = toPixel(probe);
      ctx.strokeStyle = "rgba(253, 253, 251, 0.8)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.h);
      ctx.moveTo(0, py);
      ctx.lineTo(size.w, py);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [path, shown, probe, size, toPixel]);

  const pointFromEvent = (e: { clientX: number; clientY: number }): Point | null => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const gx = ((e.clientX - rect.left) / rect.width) * GAMMA_MAX;
    const by = (1 - (e.clientY - rect.top) / rect.height) * BETA_MAX;
    return [Math.min(GAMMA_MAX, Math.max(0, gx)), Math.min(BETA_MAX, Math.max(0, by))];
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current: Point = probe ?? [GAMMA_MAX / 2, BETA_MAX / 2];
    let [g, b] = current;
    switch (e.key) {
      case "ArrowLeft":
        g -= KEY_STEP * GAMMA_MAX;
        break;
      case "ArrowRight":
        g += KEY_STEP * GAMMA_MAX;
        break;
      case "ArrowUp":
        b += KEY_STEP * BETA_MAX;
        break;
      case "ArrowDown":
        b -= KEY_STEP * BETA_MAX;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        runFrom(current);
        return;
      default:
        return;
    }
    e.preventDefault();
    setProbe([Math.min(GAMMA_MAX, Math.max(0, g)), Math.min(BETA_MAX, Math.max(0, b))]);
  };

  // Readout shows the probe if there is one, otherwise the end of the current path.
  const readoutPoint: Point | null = probe ?? (shown > 0 ? path[shown - 1] : null);
  const readoutValue = readoutPoint ? cutFraction(readoutPoint[0], readoutPoint[1]) : null;

  return (
    <figure className="w-full">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        {/* β axis */}
        <div className="flex flex-col items-end justify-between py-0 text-[13px] leading-none text-ink-muted font-serif">
          <span>π/2</span>
          <span className="italic text-[15px] text-ink">β</span>
          <span>0</span>
        </div>

        <div
          ref={wrapRef}
          role="img"
          aria-label="Heat map of the expected cut fraction of p equals 1 QAOA over the angles gamma and beta. A white path shows gradient ascent climbing to a maximum."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerMove={(e) => setProbe(pointFromEvent(e))}
          onPointerLeave={() => setProbe(null)}
          onBlur={() => setProbe(null)}
          onClick={(e) => {
            const p = pointFromEvent(e);
            if (p) runFrom(p);
          }}
          className="relative aspect-[5/4] w-full cursor-crosshair overflow-hidden rounded-[3px] bg-[#443a83] outline-none ring-offset-4 ring-offset-paper focus-visible:ring-2 focus-visible:ring-accent touch-none"
        >
          <canvas ref={fieldRef} className="absolute inset-0 h-full w-full" />
          <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
        </div>

        {/* γ axis */}
        <div />
        <div className="flex items-start justify-between text-[13px] leading-none text-ink-muted font-serif">
          <span>0</span>
          <span className="italic text-[15px] text-ink">γ</span>
          <span>π</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr] gap-x-3">
        <div aria-hidden className="invisible text-[13px] font-serif">π/2</div>
        <div>
          <p className="flex flex-wrap gap-x-6 gap-y-1 font-sans text-[15px] tabular-nums text-ink" aria-hidden>
            <span>
              <span className="font-serif italic">γ</span> {readoutPoint ? fmt(readoutPoint[0]) : "–"}
            </span>
            <span>
              <span className="font-serif italic">β</span> {readoutPoint ? fmt(readoutPoint[1]) : "–"}
            </span>
            <span>Cut fraction {readoutValue !== null ? fmt(readoutValue, 3) : "–"}</span>
          </p>
          <figcaption className="mt-3 max-w-[52ch] font-serif text-[15px] leading-[1.55] text-ink-muted">
            <span className="text-ink">Fig. 1.</span> Expected cut fraction of depth-1 QAOA for MaxCut on
            a 3-regular, triangle-free graph. The best value any angles can reach is{" "}
            {fmt(OPTIMUM, 4)}. Click anywhere on the map, or focus it and press Enter, to run gradient
            ascent from that point.
          </figcaption>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
    </figure>
  );
}
