// Shared types, a seeded RNG and 2D toy dataset generators.
// All coordinates live in the square [-1, 1] x [-1, 1].

export interface LabeledPoint {
  x: number;
  y: number;
  /** Class index, used by classifiers. Ignored by clustering algorithms. */
  label: number;
}

export type Vec2 = [number, number];

/** Mulberry32: small, fast, deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box-Muller. */
export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (v: number) => Math.max(-0.98, Math.min(0.98, v));

function point(x: number, y: number, label: number): LabeledPoint {
  return { x: clamp(x), y: clamp(y), label };
}

export type PresetId = "blobs" | "moons" | "circles" | "spiral";

export const presets: { id: PresetId; label: string }[] = [
  { id: "blobs", label: "Blobs" },
  { id: "moons", label: "Moons" },
  { id: "circles", label: "Circles" },
  { id: "spiral", label: "Spiral" },
];

export function generate(id: PresetId, seed: number, n = 180): LabeledPoint[] {
  const rand = rng(seed);
  const pts: LabeledPoint[] = [];

  switch (id) {
    case "blobs": {
      // Three clusters with random centres, kept apart by rejection sampling.
      const centres: Vec2[] = [];
      while (centres.length < 3) {
        const c: Vec2 = [(rand() * 2 - 1) * 0.6, (rand() * 2 - 1) * 0.6];
        if (centres.every(([x, y]) => Math.hypot(x - c[0], y - c[1]) > 0.55)) centres.push(c);
      }
      for (let i = 0; i < n; i++) {
        const k = i % 3;
        pts.push(point(centres[k][0] + gaussian(rand) * 0.13, centres[k][1] + gaussian(rand) * 0.13, k));
      }
      break;
    }
    case "moons": {
      for (let i = 0; i < n; i++) {
        const k = i % 2;
        const t = rand() * Math.PI;
        const x = k === 0 ? Math.cos(t) : 1 - Math.cos(t);
        const y = k === 0 ? Math.sin(t) : 0.5 - Math.sin(t);
        pts.push(point((x - 0.5) * 0.55 + gaussian(rand) * 0.045, (y - 0.25) * 0.55 + gaussian(rand) * 0.045, k));
      }
      break;
    }
    case "circles": {
      for (let i = 0; i < n; i++) {
        const k = i % 2;
        const r = k === 0 ? 0.3 : 0.75;
        const t = rand() * 2 * Math.PI;
        pts.push(point(r * Math.cos(t) + gaussian(rand) * 0.05, r * Math.sin(t) + gaussian(rand) * 0.05, k));
      }
      break;
    }
    case "spiral": {
      for (let i = 0; i < n; i++) {
        const k = i % 3;
        const t = rand();
        const r = 0.08 + t * 0.85;
        const angle = t * 1.6 * Math.PI + (k * 2 * Math.PI) / 3;
        pts.push(point(r * Math.cos(angle) + gaussian(rand) * 0.035, r * Math.sin(angle) + gaussian(rand) * 0.035, k));
      }
      break;
    }
  }
  return pts;
}

export function sqDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
