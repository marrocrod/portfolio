// Supervised classifiers: k-nearest neighbours, RBF-kernel SVM and a small MLP.
// Every classifier exposes predict(x, y) -> class probabilities (or scores mapped to [0, 1]).

import { gaussian, type LabeledPoint, rng, sqDist } from "./data";

export interface Classifier {
  predict: (x: number, y: number) => number[];
}

export function numClasses(points: LabeledPoint[]): number {
  return points.reduce((m, p) => Math.max(m, p.label + 1), 0);
}

export function accuracy(model: Classifier, points: LabeledPoint[]): number {
  if (points.length === 0) return 0;
  const correct = points.filter((p) => argmax(model.predict(p.x, p.y)) === p.label).length;
  return correct / points.length;
}

export function argmax(v: number[]): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

function softmax(v: number[]): number[] {
  const m = Math.max(...v);
  const e = v.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

// ---------------------------------------------------------------- k-NN

export function knn(points: LabeledPoint[], k: number): Classifier {
  const C = numClasses(points);
  const kk = Math.max(1, Math.min(k, points.length));
  const bestD = new Float64Array(kk);
  const bestI = new Int32Array(kk);

  return {
    predict(x, y) {
      // Keep the k closest points with insertion into a small sorted buffer: O(n * k).
      let filled = 0;
      for (let i = 0; i < points.length; i++) {
        const d = sqDist(x, y, points[i].x, points[i].y);
        if (filled === kk && d >= bestD[kk - 1]) continue;
        let j = filled < kk ? filled++ : kk - 1;
        while (j > 0 && bestD[j - 1] > d) {
          bestD[j] = bestD[j - 1];
          bestI[j] = bestI[j - 1];
          j--;
        }
        bestD[j] = d;
        bestI[j] = i;
      }
      const votes = new Array<number>(C).fill(0);
      for (let i = 0; i < kk; i++) votes[points[bestI[i]].label] += 1 / kk;
      return votes;
    },
  };
}

// ---------------------------------------------------------------- SVM

export interface SvmModel extends Classifier {
  /** Indices of points that ended up as support vectors in any sub-problem. */
  supportVectors: number[];
}

interface BinarySvm {
  alpha: Float64Array;
  b: number;
}

/**
 * Simplified SMO (Platt 1998, as presented in Stanford CS229).
 * Solves the soft-margin dual for labels y in {-1, +1} with a precomputed kernel matrix.
 */
function smo(K: Float64Array, y: number[], C: number, rand: () => number, tol = 1e-3, maxPasses = 5, maxIter = 3000): BinarySvm {
  const n = y.length;
  const alpha = new Float64Array(n);
  let b = 0;

  const f = (i: number) => {
    let s = b;
    for (let k = 0; k < n; k++) if (alpha[k] > 0) s += alpha[k] * y[k] * K[k * n + i];
    return s;
  };

  let passes = 0;
  let iter = 0;
  while (passes < maxPasses && iter < maxIter) {
    iter++;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const Ei = f(i) - y[i];
      if (!((y[i] * Ei < -tol && alpha[i] < C) || (y[i] * Ei > tol && alpha[i] > 0))) continue;

      let j = Math.floor(rand() * (n - 1));
      if (j >= i) j++;
      const Ej = f(j) - y[j];
      const ai = alpha[i];
      const aj = alpha[j];

      const L = y[i] === y[j] ? Math.max(0, ai + aj - C) : Math.max(0, aj - ai);
      const H = y[i] === y[j] ? Math.min(C, ai + aj) : Math.min(C, C + aj - ai);
      if (L >= H) continue;

      const Kii = K[i * n + i];
      const Kjj = K[j * n + j];
      const Kij = K[i * n + j];
      const eta = 2 * Kij - Kii - Kjj;
      if (eta >= 0) continue;

      let ajNew = aj - (y[j] * (Ei - Ej)) / eta;
      ajNew = Math.min(H, Math.max(L, ajNew));
      if (Math.abs(ajNew - aj) < 1e-5) continue;
      const aiNew = ai + y[i] * y[j] * (aj - ajNew);

      const b1 = b - Ei - y[i] * (aiNew - ai) * Kii - y[j] * (ajNew - aj) * Kij;
      const b2 = b - Ej - y[i] * (aiNew - ai) * Kij - y[j] * (ajNew - aj) * Kjj;
      b = aiNew > 0 && aiNew < C ? b1 : ajNew > 0 && ajNew < C ? b2 : (b1 + b2) / 2;

      alpha[i] = aiNew;
      alpha[j] = ajNew;
      changed++;
    }
    passes = changed === 0 ? passes + 1 : 0;
  }
  return { alpha, b };
}

/** RBF-kernel SVM. Multiclass problems use one-vs-rest. */
export function svm(points: LabeledPoint[], C: number, gamma: number, seed = 1): SvmModel {
  const n = points.length;
  const classes = numClasses(points);
  const rbf = (ax: number, ay: number, bx: number, by: number) => Math.exp(-gamma * sqDist(ax, ay, bx, by));

  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const v = rbf(points[i].x, points[i].y, points[j].x, points[j].y);
      K[i * n + j] = v;
      K[j * n + i] = v;
    }
  }

  // Binary problems need a single machine; otherwise one per class.
  const targets = classes <= 2 ? [1] : Array.from({ length: classes }, (_, c) => c);
  const rand = rng(seed);
  const machines = targets.map((c) => {
    const y = points.map((p) => (p.label === c ? 1 : -1));
    const { alpha, b } = smo(K, y, C, rand);
    const sv = [...alpha.keys()].filter((i) => alpha[i] > 1e-8);
    return { sv, coef: sv.map((i) => alpha[i] * y[i]), b };
  });

  const decision = (x: number, y: number) =>
    machines.map(({ sv, coef, b }) => {
      let s = b;
      sv.forEach((i, k) => {
        s += coef[k] * rbf(points[i].x, points[i].y, x, y);
      });
      return s;
    });

  return {
    supportVectors: [...new Set(machines.flatMap((m) => m.sv))],
    predict(x, y) {
      const d = decision(x, y);
      if (classes <= 2) {
        // Map the signed margin to a two-class score.
        const p1 = 1 / (1 + Math.exp(-2 * d[0]));
        return [1 - p1, p1];
      }
      return softmax(d.map((v) => 2 * v));
    },
  };
}

// ---------------------------------------------------------------- MLP

interface Layer {
  W: Float64Array; // out x in, row-major
  b: Float64Array;
  inSize: number;
  outSize: number;
}

interface AdamState {
  m: Float64Array[];
  v: Float64Array[];
  t: number;
}

export interface Mlp extends Classifier {
  layers: Layer[];
  adam: AdamState;
  epoch: number;
  classes: number;
}

/** Fully connected network 2 -> hidden... -> classes, tanh hidden units and softmax output. */
export function createMlp(hidden: number[], classes: number, seed = 1): Mlp {
  const rand = rng(seed);
  const sizes = [2, ...hidden, Math.max(classes, 2)];
  const layers: Layer[] = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const inSize = sizes[l];
    const outSize = sizes[l + 1];
    const scale = Math.sqrt(1 / inSize); // Xavier-style for tanh
    const W = new Float64Array(outSize * inSize).map(() => gaussian(rand) * scale);
    layers.push({ W, b: new Float64Array(outSize), inSize, outSize });
  }
  const params = layers.flatMap((L) => [L.W, L.b]);
  const net: Mlp = {
    layers,
    adam: { m: params.map((p) => new Float64Array(p.length)), v: params.map((p) => new Float64Array(p.length)), t: 0 },
    epoch: 0,
    classes: Math.max(classes, 2),
    predict: (x, y) => forward(net, x, y).out,
  };
  return net;
}

function forward(net: Mlp, x: number, y: number) {
  const acts: Float64Array[] = [Float64Array.of(x, y)];
  net.layers.forEach((L, l) => {
    const a = acts[l];
    const z = new Float64Array(L.outSize);
    for (let o = 0; o < L.outSize; o++) {
      let s = L.b[o];
      for (let i = 0; i < L.inSize; i++) s += L.W[o * L.inSize + i] * a[i];
      z[o] = s;
    }
    const last = l === net.layers.length - 1;
    acts.push(last ? z : z.map(Math.tanh));
  });
  const out = softmax([...acts[acts.length - 1]]);
  return { acts, out };
}

/** Runs full-batch Adam for a number of epochs. Returns the final cross-entropy loss. */
export function trainMlp(net: Mlp, points: LabeledPoint[], epochs: number, lr = 0.02): number {
  if (points.length === 0) return 0;
  const { layers, adam } = net;
  const beta1 = 0.9;
  const beta2 = 0.999;
  let loss = 0;

  for (let e = 0; e < epochs; e++) {
    const gW = layers.map((L) => new Float64Array(L.W.length));
    const gb = layers.map((L) => new Float64Array(L.b.length));
    loss = 0;

    for (const p of points) {
      const { acts, out } = forward(net, p.x, p.y);
      loss -= Math.log(Math.max(out[p.label], 1e-12));
      // Softmax + cross-entropy gradient w.r.t. logits.
      let delta = Float64Array.from(out, (v, c) => v - (c === p.label ? 1 : 0));
      for (let l = layers.length - 1; l >= 0; l--) {
        const L = layers[l];
        const a = acts[l];
        for (let o = 0; o < L.outSize; o++) {
          gb[l][o] += delta[o];
          for (let i = 0; i < L.inSize; i++) gW[l][o * L.inSize + i] += delta[o] * a[i];
        }
        if (l > 0) {
          // Backpropagate through W and the tanh of the previous layer.
          const prev = new Float64Array(L.inSize);
          for (let i = 0; i < L.inSize; i++) {
            let s = 0;
            for (let o = 0; o < L.outSize; o++) s += L.W[o * L.inSize + i] * delta[o];
            prev[i] = s * (1 - a[i] * a[i]);
          }
          delta = prev;
        }
      }
    }

    // Adam update on the averaged gradients.
    adam.t++;
    const n = points.length;
    const params = layers.flatMap((L) => [L.W, L.b]);
    const grads = layers.flatMap((_, l) => [gW[l], gb[l]]);
    const c1 = 1 - beta1 ** adam.t;
    const c2 = 1 - beta2 ** adam.t;
    params.forEach((P, k) => {
      const G = grads[k];
      const M = adam.m[k];
      const V = adam.v[k];
      for (let i = 0; i < P.length; i++) {
        const g = G[i] / n;
        M[i] = beta1 * M[i] + (1 - beta1) * g;
        V[i] = beta2 * V[i] + (1 - beta2) * g * g;
        P[i] -= (lr * (M[i] / c1)) / (Math.sqrt(V[i] / c2) + 1e-8);
      }
    });
    net.epoch++;
    loss /= n;
  }
  return loss;
}
