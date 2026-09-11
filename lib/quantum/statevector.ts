// Minimal state-vector simulator. Amplitudes are stored as separate real and imaginary
// Float64Arrays of length 2^n. Qubit j corresponds to bit j of the basis-state index.

export interface State {
  n: number;
  re: Float64Array;
  im: Float64Array;
}

export function zeroState(n: number): State {
  const re = new Float64Array(1 << n);
  re[0] = 1;
  return { n, re, im: new Float64Array(1 << n) };
}

/** |+>^n: the uniform superposition, the usual starting point for QAOA. */
export function plusState(n: number): State {
  const size = 1 << n;
  return { n, re: new Float64Array(size).fill(1 / Math.sqrt(size)), im: new Float64Array(size) };
}

/** Multiplies each amplitude by exp(-i * angle * diag[z]). */
export function applyDiagonalPhase(s: State, diag: Float64Array, angle: number) {
  const { re, im } = s;
  for (let z = 0; z < re.length; z++) {
    const phi = -angle * diag[z];
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const r = re[z];
    const i = im[z];
    re[z] = r * c - i * sn;
    im[z] = r * sn + i * c;
  }
}

/** Applies RX(theta) = exp(-i theta X / 2) to one qubit. */
export function applyRx(s: State, qubit: number, theta: number) {
  const c = Math.cos(theta / 2);
  const sn = Math.sin(theta / 2);
  const bit = 1 << qubit;
  const { re, im } = s;
  for (let a = 0; a < re.length; a++) {
    if (a & bit) continue;
    const b = a | bit;
    const ar = re[a];
    const ai = im[a];
    const br = re[b];
    const bi = im[b];
    // [c, -i s; -i s, c]
    re[a] = c * ar + sn * bi;
    im[a] = c * ai - sn * br;
    re[b] = c * br + sn * ai;
    im[b] = c * bi - sn * ar;
  }
}

/** Applies RY(theta) = exp(-i theta Y / 2) to one qubit. */
export function applyRy(s: State, qubit: number, theta: number) {
  const c = Math.cos(theta / 2);
  const sn = Math.sin(theta / 2);
  const bit = 1 << qubit;
  const { re, im } = s;
  for (let a = 0; a < re.length; a++) {
    if (a & bit) continue;
    const b = a | bit;
    const ar = re[a];
    const ai = im[a];
    // [c, -s; s, c]
    re[a] = c * ar - sn * re[b];
    im[a] = c * ai - sn * im[b];
    re[b] = sn * ar + c * re[b];
    im[b] = sn * ai + c * im[b];
  }
}

/** Applies RZ(theta) = exp(-i theta Z / 2) to one qubit. */
export function applyRz(s: State, qubit: number, theta: number) {
  const bit = 1 << qubit;
  const c = Math.cos(theta / 2);
  const sn = Math.sin(theta / 2);
  const { re, im } = s;
  for (let z = 0; z < re.length; z++) {
    // |0> gets exp(-i theta/2), |1> gets exp(+i theta/2)
    const sign = z & bit ? 1 : -1;
    const r = re[z];
    const i = im[z];
    re[z] = r * c - i * sign * sn;
    im[z] = r * sign * sn + i * c;
  }
}

export function applyCnot(s: State, control: number, target: number) {
  const cb = 1 << control;
  const tb = 1 << target;
  const { re, im } = s;
  for (let a = 0; a < re.length; a++) {
    if (!(a & cb) || a & tb) continue;
    const b = a | tb;
    [re[a], re[b]] = [re[b], re[a]];
    [im[a], im[b]] = [im[b], im[a]];
  }
}

export function probabilities(s: State): Float64Array {
  const p = new Float64Array(s.re.length);
  for (let z = 0; z < p.length; z++) p[z] = s.re[z] ** 2 + s.im[z] ** 2;
  return p;
}

/** Expectation of a diagonal observable. */
export function expectDiagonal(s: State, diag: Float64Array): number {
  let e = 0;
  for (let z = 0; z < diag.length; z++) e += (s.re[z] ** 2 + s.im[z] ** 2) * diag[z];
  return e;
}

/** <Z_qubit> in the computational basis. */
export function expectZ(s: State, qubit: number): number {
  const bit = 1 << qubit;
  let e = 0;
  for (let z = 0; z < s.re.length; z++) e += (z & bit ? -1 : 1) * (s.re[z] ** 2 + s.im[z] ** 2);
  return e;
}

/** Controlled-Z: flips the sign of amplitudes where both qubits are 1. */
export function applyCz(s: State, a: number, b: number) {
  const mask = (1 << a) | (1 << b);
  for (let z = 0; z < s.re.length; z++) {
    if ((z & mask) === mask) {
      s.re[z] = -s.re[z];
      s.im[z] = -s.im[z];
    }
  }
}

/** Bloch vector (<X>, <Y>, <Z>) of one qubit. */
export function blochVector(s: State, qubit: number): [number, number, number] {
  const bit = 1 << qubit;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let a = 0; a < s.re.length; a++) {
    if (a & bit) continue;
    const b = a | bit;
    // conj(amp_a) * amp_b
    const cr = s.re[a] * s.re[b] + s.im[a] * s.im[b];
    const ci = s.re[a] * s.im[b] - s.im[a] * s.re[b];
    x += 2 * cr;
    y += 2 * ci;
    z += s.re[a] ** 2 + s.im[a] ** 2 - s.re[b] ** 2 - s.im[b] ** 2;
  }
  return [x, y, z];
}
