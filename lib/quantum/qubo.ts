// QUBO problems: minimize E(x) = sum_{i<=j} Q_ij x_i x_j + offset over x in {0,1}^n.
// Q is stored upper-triangular (row-major n x n); bit i of a basis index is x_i.

import { rng } from "@/lib/ml/data";
import { applyDiagonalPhase, applyRx, plusState, probabilities } from "./statevector";

export interface Qubo {
  n: number;
  /** Upper-triangular coefficients, Q[i * n + j] for i <= j. */
  Q: Float64Array;
  offset: number;
  kind: ProblemKind;
  /** Human-readable description of what the variables mean. */
  description: string;
  /** Problem data needed to explain a solution in plain terms. */
  meta?: { numbers?: number[]; edges?: [number, number][] };
}

export type ProblemKind = "partition" | "independent-set" | "random" | "custom";

export const MAX_VARS = 12;

/** Energy of every bitstring: the diagonal of the problem Hamiltonian. */
export function energies(q: Qubo): Float64Array {
  const { n, Q } = q;
  const size = 1 << n;
  const out = new Float64Array(size);
  for (let z = 0; z < size; z++) {
    let e = q.offset;
    for (let i = 0; i < n; i++) {
      if (!((z >> i) & 1)) continue;
      for (let j = i; j < n; j++) if ((z >> j) & 1) e += Q[i * n + j];
    }
    out[z] = e;
  }
  return out;
}

export function optimum(diag: Float64Array): { value: number; states: number[] } {
  let value = Infinity;
  for (const e of diag) value = Math.min(value, e);
  const states: number[] = [];
  diag.forEach((e, z) => Math.abs(e - value) < 1e-9 && states.push(z));
  return { value, states };
}

// ---------------------------------------------------------------- problem families

/** Split numbers into two groups with sums as equal as possible. E = (difference of sums)^2. */
export function numberPartition(n: number, seed: number): Qubo {
  const rand = rng(seed);
  const a = Array.from({ length: n }, () => 1 + Math.floor(rand() * 20));
  const A = a.reduce((s, v) => s + v, 0);
  const Q = new Float64Array(n * n);
  // (2 sum a_i x_i - A)^2 = 4 (sum a_i x_i)^2 - 4 A sum a_i x_i + A^2
  for (let i = 0; i < n; i++) {
    Q[i * n + i] = 4 * a[i] * a[i] - 4 * A * a[i];
    for (let j = i + 1; j < n; j++) Q[i * n + j] = 8 * a[i] * a[j];
  }
  return {
    n,
    Q,
    offset: A * A,
    kind: "partition",
    meta: { numbers: a },
    description: `Split the numbers ${a.join(", ")} into two groups with sums as equal as possible. Variable i says which group number i goes to; the energy is the squared difference between the two sums.`,
  };
}

/** Largest set of nodes with no edge inside it. E = -|set| + 2 * (edges inside the set). */
export function independentSet(n: number, seed: number, edgeProb = 0.35): Qubo {
  const rand = rng(seed);
  const Q = new Float64Array(n * n);
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    Q[i * n + i] = -1;
    for (let j = i + 1; j < n; j++) {
      if (rand() < edgeProb) {
        Q[i * n + j] = 2; // penalty larger than the reward, so violating an edge never pays
        edges.push([i, j]);
      }
    }
  }
  return {
    n,
    Q,
    offset: 0,
    kind: "independent-set",
    meta: { edges },
    description: `Pick as many nodes as possible from a random graph with ${edges.length} edges, without picking both ends of any edge. Each picked node lowers the energy by 1; each violated edge costs 2.`,
  };
}

export function randomQubo(n: number, seed: number): Qubo {
  const rand = rng(seed);
  const Q = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) Q[i * n + j] = Math.round((rand() * 2 - 1) * 10) / 10;
  return {
    n,
    Q,
    offset: 0,
    kind: "random",
    description: "Random coefficients between −1 and 1. No structure to exploit, and many near-degenerate low-energy states.",
  };
}

/** Parses a full square matrix (rows on lines, numbers separated by spaces or commas) as E = x^T M x. */
export function parseMatrix(text: string): Qubo | string {
  const rows = text
    .trim()
    .split(/\n+/)
    .map((line) => line.trim().split(/[\s,;]+/).filter(Boolean).map(Number));
  const n = rows.length;
  if (n < 2) return "Enter at least two rows.";
  if (n > MAX_VARS) return `At most ${MAX_VARS} variables can be simulated in the browser.`;
  if (rows.some((r) => r.length !== n)) return "The matrix must be square: every row needs as many numbers as there are rows.";
  if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) return "Every entry must be a number.";
  const Q = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    Q[i * n + i] = rows[i][i];
    for (let j = i + 1; j < n; j++) Q[i * n + j] = rows[i][j] + rows[j][i];
  }
  return { n, Q, offset: 0, kind: "custom", description: "Your own matrix M, with energy xᵀMx." };
}

export function matrixText(q: Qubo): string {
  const lines: string[] = [];
  for (let i = 0; i < q.n; i++) {
    const row: string[] = [];
    for (let j = 0; j < q.n; j++) row.push(j < i ? "0" : String(Number(q.Q[i * q.n + j].toFixed(3))));
    lines.push(row.join(" "));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- simulated annealing

export interface AnnealResult {
  /** Energy of the random starting state, then after each sweep. */
  trace: number[];
  /** Lowest energy seen so far, aligned with trace. */
  bestTrace: number[];
  temperatures: number[];
  best: number;
  bestState: number;
  final: number;
}

/** Temperature range from the size of typical single-flip energy changes. */
export function temperatureRange(q: Qubo): [number, number] {
  const { n, Q } = q;
  let total = 0;
  for (let i = 0; i < n; i++) {
    let s = Math.abs(Q[i * n + i]);
    for (let j = 0; j < n; j++) if (j !== i) s += Math.abs(Q[Math.min(i, j) * n + Math.max(i, j)]) / 2;
    total += s;
  }
  const scale = total / n || 1;
  return [scale, scale / 200];
}

/** Metropolis single-flip annealing with a geometric cooling schedule. One sweep = n flip attempts. */
export function anneal(q: Qubo, sweeps: number, seed: number): AnnealResult {
  const { n, Q } = q;
  const rand = rng(seed);
  const [t0, t1] = temperatureRange(q);
  const x: number[] = Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0));
  const coef = (i: number, j: number) => Q[Math.min(i, j) * n + Math.max(i, j)];
  let e = q.offset;
  for (let i = 0; i < n; i++) if (x[i]) for (let j = i; j < n; j++) if (x[j]) e += Q[i * n + j];

  const stateOf = () => x.reduce((z, b, i) => z | (b << i), 0);
  let best = e;
  let bestState = stateOf();
  const trace: number[] = [e];
  const bestTrace: number[] = [e];
  const temperatures: number[] = [t0];
  for (let s = 0; s < sweeps; s++) {
    const T = sweeps > 1 ? t0 * (t1 / t0) ** (s / (sweeps - 1)) : t1;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rand() * n);
      // Energy change of flipping x_i: (1 - 2 x_i) * (Q_ii + sum_j Q_ij x_j)
      let field = Q[i * n + i];
      for (let j = 0; j < n; j++) if (j !== i && x[j]) field += coef(i, j);
      const dE = (1 - 2 * x[i]) * field;
      if (dE <= 0 || rand() < Math.exp(-dE / T)) {
        x[i] ^= 1;
        e += dE;
        if (e < best - 1e-12) {
          best = e;
          bestState = stateOf();
        }
      }
    }
    trace.push(e);
    bestTrace.push(best);
    temperatures.push(T);
  }
  return { trace, bestTrace, temperatures, best, bestState, final: e };
}

// ---------------------------------------------------------------- QAOA on a QUBO

/** Standardized diagonal (zero mean, unit spread) so the same angle ranges suit every instance. */
export function standardized(diag: Float64Array): Float64Array {
  const mean = diag.reduce((a, b) => a + b, 0) / diag.length;
  const sd = Math.sqrt(diag.reduce((a, b) => a + (b - mean) ** 2, 0) / diag.length) || 1;
  return diag.map((e) => (e - mean) / sd);
}

export function qaoaProbs(n: number, cost: Float64Array, gammas: number[], betas: number[]): Float64Array {
  const s = plusState(n);
  for (let k = 0; k < gammas.length; k++) {
    applyDiagonalPhase(s, cost, gammas[k]);
    for (let q = 0; q < n; q++) applyRx(s, q, 2 * betas[k]);
  }
  return probabilities(s);
}

export function expectationOf(probs: Float64Array, values: Float64Array): number {
  let e = 0;
  for (let z = 0; z < probs.length; z++) e += probs[z] * values[z];
  return e;
}

/** Plain-language reading of a solution. */
export function explain(q: Qubo, z: number): string {
  const on = Array.from({ length: q.n }, (_, i) => (z >> i) & 1);
  if (q.kind === "partition" && q.meta?.numbers) {
    const a = q.meta.numbers;
    const g1 = a.filter((_, i) => on[i]);
    const g0 = a.filter((_, i) => !on[i]);
    const sum = (g: number[]) => g.reduce((s, v) => s + v, 0);
    return `Groups {${g1.join(", ")}} and {${g0.join(", ")}}, with sums ${sum(g1)} and ${sum(g0)}.`;
  }
  if (q.kind === "independent-set" && q.meta?.edges) {
    const picked = on.flatMap((b, i) => (b ? [i] : []));
    const clashes = q.meta.edges.filter(([i, j]) => on[i] && on[j]).length;
    return `Nodes {${picked.join(", ")}}: ${picked.length} picked, ${clashes} edge${clashes === 1 ? "" : "s"} violated.`;
  }
  return `x = ${on.join("")}`;
}

/** Repetitions needed to see an event of probability p at least once with 95% confidence. */
export function repetitionsFor95(p: number): number {
  if (p >= 1) return 1;
  if (p <= 0) return Infinity;
  return Math.ceil(Math.log(0.05) / Math.log(1 - p));
}
