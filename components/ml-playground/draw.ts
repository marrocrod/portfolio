// Canvas rendering for the playground. World coordinates are [-1, 1]^2, y pointing up.

import { covarianceEllipse } from "@/lib/ml/clustering";
import type { LabeledPoint } from "@/lib/ml/data";
import type { PlotData } from "./compute";

// Okabe-Ito: a categorical palette that stays distinguishable with color vision deficiency.
export const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#7A5195"];
const PAPER = [251, 252, 253];
const INK = "#17203a";
const NOISE = "#9aa3b2";

export const colorOf = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const PALETTE_RGB = PALETTE.map(rgb);

export const toPx = (v: number, size: number) => ((v + 1) / 2) * size;
export const toPy = (v: number, size: number) => ((1 - v) / 2) * size;

let regionCanvas: HTMLCanvasElement | null = null;

function drawRegion(ctx: CanvasRenderingContext2D, data: PlotData, size: number) {
  if (!data.region) return;
  regionCanvas ??= document.createElement("canvas");
  const G = data.region.size;
  regionCanvas.width = G;
  regionCanvas.height = G;
  const rctx = regionCanvas.getContext("2d");
  if (!rctx) return;

  const img = rctx.createImageData(G, G);
  const { labels, strength } = data.region;
  for (let i = 0; i < labels.length; i++) {
    const [r, g, b] = PALETTE_RGB[labels[i] % PALETTE_RGB.length];
    // Blend toward paper: confident cells are more saturated.
    const a = 0.08 + 0.22 * strength[i];
    img.data[i * 4] = PAPER[0] + (r - PAPER[0]) * a;
    img.data[i * 4 + 1] = PAPER[1] + (g - PAPER[1]) * a;
    img.data[i * 4 + 2] = PAPER[2] + (b - PAPER[2]) * a;
    img.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(regionCanvas, 0, 0, size, size);
}

export function drawPlot(ctx: CanvasRenderingContext2D, size: number, points: LabeledPoint[], data: PlotData) {
  ctx.fillStyle = `rgb(${PAPER.join(",")})`;
  ctx.fillRect(0, 0, size, size);
  drawRegion(ctx, data, size);

  // Faint axes through the origin for orientation.
  ctx.strokeStyle = "rgba(23, 32, 58, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // DBSCAN neighbourhoods around core points, filled as one union per cluster
  // so overlapping discs don't stack into darker patches.
  if (data.radius) {
    const r = (data.radius.r / 2) * size;
    const byCluster = new Map<number, number[]>();
    for (const i of data.radius.points) {
      const c = data.colors[i];
      if (c === undefined || c < 0) continue;
      byCluster.set(c, [...(byCluster.get(c) ?? []), i]);
    }
    byCluster.forEach((idx, c) => {
      ctx.beginPath();
      for (const i of idx) {
        const x = toPx(points[i].x, size);
        const y = toPy(points[i].y, size);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = `${colorOf(c)}2e`;
      ctx.fill("nonzero");
    });
  }

  // Gaussian components: 1 and 2 standard deviation ellipses.
  data.gaussians?.forEach((g, j) => {
    const { rx, ry, angle } = covarianceEllipse(g.cov);
    for (const [k, alpha] of [
      [1, "cc"],
      [2, "66"],
    ] as const) {
      ctx.beginPath();
      // World y points up, canvas y points down, so the rotation flips sign.
      ctx.ellipse(toPx(g.mean[0], size), toPy(g.mean[1], size), ((k * rx) / 2) * size, ((k * ry) / 2) * size, -angle, 0, Math.PI * 2);
      ctx.strokeStyle = `${colorOf(j)}${alpha}`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // Support vectors get a ring underneath the point.
  data.highlighted?.forEach((i) => {
    const p = points[i];
    if (!p) return;
    ctx.beginPath();
    ctx.arc(toPx(p.x, size), toPy(p.y, size), 8, 0, Math.PI * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  });

  // Points.
  points.forEach((p, i) => {
    // Fall back to the true label while a recompute is pending after an edit.
    const c = data.colors[i] ?? p.label;
    const x = toPx(p.x, size);
    const y = toPy(p.y, size);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    if (c === -1) {
      ctx.fillStyle = "#fbfcfd";
      ctx.fill();
      ctx.strokeStyle = NOISE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = colorOf(c);
      ctx.fill();
      ctx.strokeStyle = "#fbfcfd";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  });

  // k-means centres: ink crosses with a paper halo.
  data.centres?.forEach(([cx, cy]) => {
    const x = toPx(cx, size);
    const y = toPy(cy, size);
    for (const [w, color] of [
      [5, "#fbfcfd"],
      [2, INK],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 7);
      ctx.lineTo(x + 7, y + 7);
      ctx.moveTo(x + 7, y - 7);
      ctx.lineTo(x - 7, y + 7);
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  });
}
