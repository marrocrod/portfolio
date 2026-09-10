// Analytic p = 1 QAOA landscape for MaxCut on a 3-regular, triangle-free graph.
//
// For an edge (u, v) with d = deg - 1 = 2 on both endpoints and no common
// neighbours, the p = 1 expectation (Wang, Hadfield et al., PRA 97, 022304)
// reduces to:
//
//   <C_uv>(γ, β) = 1/2 + 1/2 · sin(4β) · sin(γ) · cos²(γ)
//
// Every edge is equivalent, so this is also the expected cut fraction <C>/|E|.
// Its maximum, 0.6924, is reached at sin(γ) = 1/√3 and β = π/8.

export const GAMMA_MAX = Math.PI;
export const BETA_MAX = Math.PI / 2;
export const OPTIMUM = 0.5 + 0.5 * (1 / Math.sqrt(3)) * (2 / 3);

export function cutFraction(gamma: number, beta: number): number {
  const c = Math.cos(gamma);
  return 0.5 + 0.5 * Math.sin(4 * beta) * Math.sin(gamma) * c * c;
}

export function gradient(gamma: number, beta: number): [number, number] {
  const s = Math.sin(gamma);
  const c = Math.cos(gamma);
  const s4b = Math.sin(4 * beta);
  const dGamma = 0.5 * s4b * c * (c * c - 2 * s * s);
  const dBeta = 2 * Math.cos(4 * beta) * s * c * c;
  return [dGamma, dBeta];
}

/** Plain gradient ascent, clipped to the plotted domain. */
export function ascentPath(
  start: [number, number],
  { lr = 0.35, maxSteps = 120, tol = 1e-4 } = {},
): [number, number][] {
  const path: [number, number][] = [start];
  let [g, b] = start;
  for (let i = 0; i < maxSteps; i++) {
    const [dg, db] = gradient(g, b);
    if (Math.hypot(dg, db) < tol) break;
    g = Math.min(GAMMA_MAX, Math.max(0, g + lr * dg));
    b = Math.min(BETA_MAX, Math.max(0, b + lr * db));
    path.push([g, b]);
  }
  return path;
}

// Viridis sampled at 9 evenly spaced stops; linear interpolation in between.
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [71, 44, 122],
  [59, 81, 139],
  [44, 113, 142],
  [33, 144, 141],
  [39, 173, 129],
  [92, 200, 99],
  [170, 220, 50],
  [253, 231, 37],
];

export function viridis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
