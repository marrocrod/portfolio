// Unsupervised algorithms: k-means, DBSCAN and Gaussian mixture models.

import { type LabeledPoint, rng, sqDist, type Vec2 } from "./data";

/** k-means++ seeding: spread initial centres proportionally to squared distance. */
function kmeansPlusPlus(points: LabeledPoint[], k: number, rand: () => number): Vec2[] {
  const first = points[Math.floor(rand() * points.length)];
  const centres: Vec2[] = [[first.x, first.y]];
  const d2 = points.map((p) => sqDist(p.x, p.y, first.x, first.y));

  while (centres.length < k) {
    const total = d2.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < points.length - 1; idx++) {
      r -= d2[idx];
      if (r <= 0) break;
    }
    const c: Vec2 = [points[idx].x, points[idx].y];
    centres.push(c);
    points.forEach((p, i) => {
      d2[i] = Math.min(d2[i], sqDist(p.x, p.y, c[0], c[1]));
    });
  }
  return centres;
}

function nearest(x: number, y: number, centres: Vec2[]): number {
  let best = 0;
  let bestD = Infinity;
  centres.forEach(([cx, cy], j) => {
    const d = sqDist(x, y, cx, cy);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  });
  return best;
}

export interface KMeansResult {
  assignments: number[];
  centres: Vec2[];
  inertia: number;
  iterations: number;
  predict: (x: number, y: number) => number;
}

export function kmeans(points: LabeledPoint[], k: number, seed = 1, maxIter = 100): KMeansResult {
  const kk = Math.min(k, points.length);
  const centres = kmeansPlusPlus(points, kk, rng(seed));
  let assignments = new Array<number>(points.length).fill(-1);
  let iterations = 0;

  for (; iterations < maxIter; iterations++) {
    const next = points.map((p) => nearest(p.x, p.y, centres));
    const changed = next.some((a, i) => a !== assignments[i]);
    assignments = next;
    if (!changed) break;

    // Update step: move each centre to the mean of its points. Empty clusters keep their centre.
    const sums = centres.map(() => [0, 0, 0]);
    points.forEach((p, i) => {
      const s = sums[assignments[i]];
      s[0] += p.x;
      s[1] += p.y;
      s[2] += 1;
    });
    sums.forEach(([sx, sy, n], j) => {
      if (n > 0) centres[j] = [sx / n, sy / n];
    });
  }

  const inertia = points.reduce((acc, p, i) => {
    const [cx, cy] = centres[assignments[i]];
    return acc + sqDist(p.x, p.y, cx, cy);
  }, 0);

  return { assignments, centres, inertia, iterations, predict: (x, y) => nearest(x, y, centres) };
}

export interface DbscanResult {
  /** Cluster index per point, or -1 for noise. */
  assignments: number[];
  clusters: number;
  noise: number;
  /** Whether each point is a core point (has at least minPts neighbours within eps). */
  core: boolean[];
}

export function dbscan(points: LabeledPoint[], eps: number, minPts: number): DbscanResult {
  const n = points.length;
  const eps2 = eps * eps;
  const neighbours: number[][] = points.map((p) => {
    const out: number[] = [];
    points.forEach((q, j) => {
      if (sqDist(p.x, p.y, q.x, q.y) <= eps2) out.push(j);
    });
    return out;
  });
  const core = neighbours.map((nb) => nb.length >= minPts);
  const assignments = new Array<number>(n).fill(-1);
  const visited = new Array<boolean>(n).fill(false);
  let cluster = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i] || !core[i]) continue;
    // Breadth-first expansion from an unvisited core point.
    const queue = [i];
    visited[i] = true;
    while (queue.length) {
      const p = queue.shift()!;
      assignments[p] = cluster;
      if (!core[p]) continue;
      for (const q of neighbours[p]) {
        if (!visited[q]) {
          visited[q] = true;
          queue.push(q);
        } else if (assignments[q] === -1) {
          assignments[q] = cluster;
        }
      }
    }
    cluster++;
  }

  return { assignments, clusters: cluster, noise: assignments.filter((a) => a === -1).length, core };
}

export interface Gaussian2D {
  weight: number;
  mean: Vec2;
  /** Covariance as [sxx, sxy, syy]. */
  cov: [number, number, number];
}

export interface GmmResult {
  components: Gaussian2D[];
  assignments: number[];
  logLikelihood: number;
  iterations: number;
  predict: (x: number, y: number) => { label: number; confidence: number };
}

const REG = 1e-4;

function density(x: number, y: number, g: Gaussian2D): number {
  const [a, b, c] = g.cov;
  const det = a * c - b * b;
  const dx = x - g.mean[0];
  const dy = y - g.mean[1];
  // Mahalanobis distance with the analytic 2x2 inverse.
  const m = (c * dx * dx - 2 * b * dx * dy + a * dy * dy) / det;
  return Math.exp(-0.5 * m) / (2 * Math.PI * Math.sqrt(det));
}

function responsibilities(x: number, y: number, comps: Gaussian2D[]): { r: number[]; total: number } {
  const r = comps.map((g) => g.weight * density(x, y, g));
  const total = r.reduce((a, b) => a + b, 0) || 1e-300;
  return { r: r.map((v) => v / total), total };
}

export function gmm(points: LabeledPoint[], k: number, seed = 1, maxIter = 150): GmmResult {
  const kk = Math.min(k, points.length);
  const init = kmeans(points, kk, seed, 20);
  let components: Gaussian2D[] = init.centres.map((mean) => ({
    weight: 1 / kk,
    mean,
    cov: [0.05, 0, 0.05],
  }));

  let logLikelihood = -Infinity;
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    // E-step
    let ll = 0;
    const R = points.map((p) => {
      const { r, total } = responsibilities(p.x, p.y, components);
      ll += Math.log(total);
      return r;
    });

    // M-step
    components = components.map((_, j) => {
      let nj = 0;
      let mx = 0;
      let my = 0;
      points.forEach((p, i) => {
        nj += R[i][j];
        mx += R[i][j] * p.x;
        my += R[i][j] * p.y;
      });
      nj = Math.max(nj, 1e-9);
      mx /= nj;
      my /= nj;
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      points.forEach((p, i) => {
        const dx = p.x - mx;
        const dy = p.y - my;
        sxx += R[i][j] * dx * dx;
        sxy += R[i][j] * dx * dy;
        syy += R[i][j] * dy * dy;
      });
      return {
        weight: nj / points.length,
        mean: [mx, my] as Vec2,
        cov: [sxx / nj + REG, sxy / nj, syy / nj + REG] as [number, number, number],
      };
    });

    const converged = Math.abs(ll - logLikelihood) < 1e-6 * Math.abs(ll);
    logLikelihood = ll;
    if (converged) break;
  }

  const predict = (x: number, y: number) => {
    const { r } = responsibilities(x, y, components);
    let label = 0;
    r.forEach((v, j) => {
      if (v > r[label]) label = j;
    });
    return { label, confidence: r[label] };
  };

  return {
    components,
    assignments: points.map((p) => predict(p.x, p.y).label),
    logLikelihood,
    iterations,
    predict,
  };
}

/** Semi-axes and rotation of the 1-sigma ellipse of a 2x2 covariance. */
export function covarianceEllipse([a, b, c]: [number, number, number]): { rx: number; ry: number; angle: number } {
  const tr = (a + c) / 2;
  const disc = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b));
  const l1 = tr + disc;
  const l2 = tr - disc;
  const angle = 0.5 * Math.atan2(2 * b, a - c);
  return { rx: Math.sqrt(Math.max(l1, 0)), ry: Math.sqrt(Math.max(l2, 0)), angle };
}
