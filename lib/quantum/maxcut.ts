// MaxCut utilities: graphs, the cost diagonal, exact solutions and QAOA.

import { applyDiagonalPhase, applyRx, expectDiagonal, plusState, probabilities, type State } from "./statevector";

export type Edge = [number, number];

export interface Graph {
  n: number;
  edges: Edge[];
}

export const MAX_NODES = 12;

export function edgeKey([a, b]: Edge): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Number of cut edges for every bitstring: the diagonal of the cost operator C. */
export function cutDiagonal(g: Graph): Float64Array {
  const size = 1 << g.n;
  const diag = new Float64Array(size);
  for (let z = 0; z < size; z++) {
    let cut = 0;
    for (const [u, v] of g.edges) cut += ((z >> u) ^ (z >> v)) & 1;
    diag[z] = cut;
  }
  return diag;
}

export function maxCut(diag: Float64Array): { value: number; states: number[] } {
  let value = 0;
  for (const c of diag) value = Math.max(value, c);
  const states: number[] = [];
  diag.forEach((c, z) => c === value && states.push(z));
  return { value, states };
}

/** QAOA state: layers of exp(-i gamma C) followed by exp(-i beta sum X), starting from |+>^n. */
export function qaoaState(g: Graph, diag: Float64Array, gammas: number[], betas: number[]): State {
  const s = plusState(g.n);
  for (let k = 0; k < gammas.length; k++) {
    applyDiagonalPhase(s, diag, gammas[k]);
    // exp(-i beta X) = RX(2 beta)
    for (let q = 0; q < g.n; q++) applyRx(s, q, 2 * betas[k]);
  }
  return s;
}

export function qaoaExpectation(g: Graph, diag: Float64Array, gammas: number[], betas: number[]): number {
  return expectDiagonal(qaoaState(g, diag, gammas, betas), diag);
}

export function qaoaProbabilities(g: Graph, diag: Float64Array, gammas: number[], betas: number[]) {
  return probabilities(qaoaState(g, diag, gammas, betas));
}

/**
 * Exact depth-1 expectation, summed over edges (Wang, Hadfield, Jiang, Rieffel, PRA 97, 022304).
 * For edge (u, v): d = deg(u) - 1, e = deg(v) - 1, f = triangles containing the edge.
 */
export function p1Expectation(g: Graph, gamma: number, beta: number, stats = edgeStats(g)): number {
  const cg = Math.cos(gamma);
  const c2g = Math.cos(2 * gamma);
  const s4b = Math.sin(4 * beta);
  const s2b2 = Math.sin(2 * beta) ** 2;
  const sg = Math.sin(gamma);
  let total = 0;
  for (const { d, e, f } of stats) {
    total +=
      0.5 +
      0.25 * s4b * sg * (cg ** d + cg ** e) -
      0.25 * s2b2 * cg ** (d + e - 2 * f) * (1 - c2g ** f);
  }
  return total;
}

export function edgeStats(g: Graph) {
  const adj = Array.from({ length: g.n }, () => new Set<number>());
  for (const [u, v] of g.edges) {
    adj[u].add(v);
    adj[v].add(u);
  }
  return g.edges.map(([u, v]) => {
    let f = 0;
    for (const w of adj[u]) if (adj[v].has(w)) f++;
    return { d: adj[u].size - 1, e: adj[v].size - 1, f };
  });
}

// ---------------------------------------------------------------- initial parameters

/** Annealing-inspired start: gamma ramps up while beta ramps down. */
export function linearRamp(p: number, delta = 0.75): { gammas: number[]; betas: number[] } {
  const gammas = Array.from({ length: p }, (_, i) => ((i + 0.5) / p) * delta);
  const betas = Array.from({ length: p }, (_, i) => (1 - (i + 0.5) / p) * delta);
  return { gammas, betas };
}

/**
 * INTERP (Zhou, Wang, Choi, Pichler, Lukin, PRX 10, 021067): linearly interpolates optimized
 * depth-p parameters into a starting point for depth p + 1.
 */
export function interp(params: number[]): number[] {
  const p = params.length;
  const padded = [0, ...params, 0];
  return Array.from({ length: p + 1 }, (_, i) => {
    const j = i + 1; // 1-based index into the new vector
    return ((j - 1) / p) * padded[j - 1] + ((p - j + 1) / p) * padded[j];
  });
}

// ---------------------------------------------------------------- graph presets

export function ring(n: number): Graph {
  return { n, edges: Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as Edge) };
}

export function complete(n: number): Graph {
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([i, j]);
  return { n, edges };
}

/** The 3-cube: 3-regular and triangle-free on 8 nodes. */
export function cube(): Graph {
  const edges: Edge[] = [];
  for (let i = 0; i < 8; i++) for (let b = 0; b < 3; b++) if (!(i & (1 << b))) edges.push([i, i | (1 << b)]);
  return { n: 8, edges };
}

export function random(n: number, prob: number, rand: () => number): Graph {
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < prob) edges.push([i, j]);
  // Make sure no node is isolated, so the instance stays interesting.
  for (let i = 0; i < n; i++) {
    if (!edges.some(([a, b]) => a === i || b === i)) edges.push([i, (i + 1 + Math.floor(rand() * (n - 1))) % n]);
  }
  const seen = new Set<string>();
  return { n, edges: edges.filter((e) => !seen.has(edgeKey(e)) && seen.add(edgeKey(e))) };
}
