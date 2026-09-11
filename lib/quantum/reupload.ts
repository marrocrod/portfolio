// Data re-uploading classifier (Pérez-Salinas, Cervera-Lierta, Gil-Fuster, Latorre,
// Quantum 4, 226, 2020). Every layer encodes the input again:
//   for each qubit: RY(a1 x + b1) · RZ(a2 y + b2) · RY(b3), then CZ between neighbours.
// Readout: the Bloch vector r of qubit 0, scored against one target direction per class.
// Gradients use the parameter-shift rule, as a quantum computer would.

import { rng, gaussian } from "@/lib/ml/data";
import { applyCz, applyRy, applyRz, blochVector, zeroState } from "./statevector";

export const PARAMS_PER_GATE_GROUP = 5; // a1, a2, b1, b2, b3
const LOGIT_SCALE = 3;

export interface ReuploadModel {
  qubits: number;
  layers: number;
  classes: number;
  params: Float64Array;
}

export interface Sample {
  x: number;
  y: number;
  label: number;
}

/** Unit target directions on the Bloch sphere: poles for two classes, 120° apart for three. */
export function targets(classes: number): [number, number, number][] {
  if (classes <= 2) return [
    [0, 0, 1],
    [0, 0, -1],
  ];
  return Array.from({ length: classes }, (_, c) => {
    const a = (2 * Math.PI * c) / classes;
    return [Math.sin(a), 0, Math.cos(a)] as [number, number, number];
  });
}

export function createModel(qubits: number, layers: number, classes: number, seed = 1): ReuploadModel {
  const rand = rng(seed);
  const params = new Float64Array(qubits * layers * PARAMS_PER_GATE_GROUP);
  for (let k = 0; k < params.length; k += PARAMS_PER_GATE_GROUP) {
    params[k] = gaussian(rand) * 1.5; // a1: input weights start near the scale of the data
    params[k + 1] = gaussian(rand) * 1.5; // a2
    params[k + 2] = gaussian(rand) * 0.3; // b1
    params[k + 3] = gaussian(rand) * 0.3; // b2
    params[k + 4] = gaussian(rand) * 0.3; // b3
  }
  return { qubits, layers, classes: Math.max(2, classes), params };
}

/** Gate angles for one input, in circuit order: [RY, RZ, RY] per qubit per layer. */
function angles(m: ReuploadModel, x: number, y: number): Float64Array {
  const out = new Float64Array(m.qubits * m.layers * 3);
  for (let g = 0; g < m.qubits * m.layers; g++) {
    const p = g * PARAMS_PER_GATE_GROUP;
    out[3 * g] = m.params[p] * x + m.params[p + 2];
    out[3 * g + 1] = m.params[p + 1] * y + m.params[p + 3];
    out[3 * g + 2] = m.params[p + 4];
  }
  return out;
}

function run(m: ReuploadModel, phi: Float64Array): [number, number, number] {
  const s = zeroState(m.qubits);
  for (let l = 0; l < m.layers; l++) {
    for (let q = 0; q < m.qubits; q++) {
      const g = 3 * (l * m.qubits + q);
      applyRy(s, q, phi[g]);
      applyRz(s, q, phi[g + 1]);
      applyRy(s, q, phi[g + 2]);
    }
    if (m.qubits > 1) {
      for (let q = 0; q < m.qubits - 1; q++) applyCz(s, q, q + 1);
      if (m.qubits > 2) applyCz(s, m.qubits - 1, 0);
    }
  }
  return blochVector(s, 0);
}

function softmaxScores(r: [number, number, number], classes: number): number[] {
  const t = targets(classes);
  const z = t.map((v) => LOGIT_SCALE * (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]));
  const max = Math.max(...z);
  const e = z.map((v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

export function predict(m: ReuploadModel, x: number, y: number): number[] {
  return softmaxScores(run(m, angles(m, x, y)), m.classes);
}

export function loss(m: ReuploadModel, data: Sample[]): number {
  let total = 0;
  for (const d of data) total -= Math.log(Math.max(predict(m, d.x, d.y)[d.label], 1e-12));
  return total / Math.max(1, data.length);
}

export function accuracy(m: ReuploadModel, data: Sample[]): number {
  if (!data.length) return 0;
  let ok = 0;
  for (const d of data) {
    const p = predict(m, d.x, d.y);
    if (p.indexOf(Math.max(...p)) === d.label) ok++;
  }
  return ok / data.length;
}

/**
 * Cross-entropy gradient by the parameter-shift rule. For a rotation exp(-i phi P / 2),
 * d<O>/dphi = (<O>(phi + pi/2) - <O>(phi - pi/2)) / 2; the chain rule then maps gate
 * angles to the weights and biases that produce them.
 */
export function gradient(m: ReuploadModel, batch: Sample[]): Float64Array {
  const grad = new Float64Array(m.params.length);
  const t = targets(m.classes);
  for (const d of batch) {
    const phi = angles(m, d.x, d.y);
    const r = run(m, phi);
    const p = softmaxScores(r, m.classes);
    // dL/dr = k * sum_c (p_c - y_c) t_c
    const dr = [0, 0, 0];
    for (let c = 0; c < m.classes; c++) {
      const w = LOGIT_SCALE * (p[c] - (c === d.label ? 1 : 0));
      for (let i = 0; i < 3; i++) dr[i] += w * t[c][i];
    }
    for (let g = 0; g < phi.length; g++) {
      const saved = phi[g];
      phi[g] = saved + Math.PI / 2;
      const rp = run(m, phi);
      phi[g] = saved - Math.PI / 2;
      const rm = run(m, phi);
      phi[g] = saved;
      const dPhi = (dr[0] * (rp[0] - rm[0]) + dr[1] * (rp[1] - rm[1]) + dr[2] * (rp[2] - rm[2])) / 2;
      const group = Math.floor(g / 3) * PARAMS_PER_GATE_GROUP;
      const kind = g % 3;
      if (kind === 0) {
        grad[group] += dPhi * d.x; // a1
        grad[group + 2] += dPhi; // b1
      } else if (kind === 1) {
        grad[group + 1] += dPhi * d.y; // a2
        grad[group + 3] += dPhi; // b2
      } else {
        grad[group + 4] += dPhi; // b3
      }
    }
  }
  for (let k = 0; k < grad.length; k++) grad[k] /= Math.max(1, batch.length);
  return grad;
}

/** Adam state kept outside the model so training can pause and resume. */
export interface Adam {
  m: Float64Array;
  v: Float64Array;
  t: number;
}

export function createAdam(size: number): Adam {
  return { m: new Float64Array(size), v: new Float64Array(size), t: 0 };
}

export function adamStep(model: ReuploadModel, grad: Float64Array, opt: Adam, lr = 0.05) {
  opt.t++;
  const b1 = 0.9;
  const b2 = 0.999;
  for (let k = 0; k < grad.length; k++) {
    opt.m[k] = b1 * opt.m[k] + (1 - b1) * grad[k];
    opt.v[k] = b2 * opt.v[k] + (1 - b2) * grad[k] ** 2;
    const mh = opt.m[k] / (1 - b1 ** opt.t);
    const vh = opt.v[k] / (1 - b2 ** opt.t);
    model.params[k] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
  }
}
