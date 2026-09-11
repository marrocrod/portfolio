// Particle-conserving Givens-rotation ansatz, matching the vqe-param-learning study:
// qubit q is bit (n - 1 - q) of the basis index (PennyLane's convention), all single
// excitations first and then all doubles, each gate rotating every amplitude pair as
//   excited'  = c * excited - s * occupied
//   occupied' = s * excited + c * occupied        with c = cos(theta/2), s = sin(theta/2)
// Molecular Hamiltonians here are real, so real amplitudes are enough.

export interface SparseMatrix {
  rows: number[];
  cols: number[];
  vals: number[];
}

export interface AnsatzSpec {
  nQubits: number;
  hfState: number[]; // occupation per qubit, e.g. [1, 1, 0, 0]
  singles: number[][];
  doubles: number[][];
}

type Gate = { exc: Int32Array; occ: Int32Array };

export function buildGates(spec: AnsatzSpec): Gate[] {
  const n = spec.nQubits;
  const dim = 1 << n;
  const bit = (z: number, q: number) => (z >> (n - 1 - q)) & 1;
  const weight = (q: number) => 1 << (n - 1 - q);
  const gates: Gate[] = [];
  const make = (occupied: number[], virtual: number[]) => {
    const occ: number[] = [];
    const exc: number[] = [];
    for (let z = 0; z < dim; z++) {
      if (occupied.every((q) => bit(z, q) === 1) && virtual.every((q) => bit(z, q) === 0)) {
        occ.push(z);
        exc.push(z - occupied.reduce((a, q) => a + weight(q), 0) + virtual.reduce((a, q) => a + weight(q), 0));
      }
    }
    gates.push({ exc: Int32Array.from(exc), occ: Int32Array.from(occ) });
  };
  for (const [r, p] of spec.singles) make([r], [p]);
  for (const [i, j, a, b] of spec.doubles) make([i, j], [a, b]);
  return gates;
}

export function hfIndex(spec: AnsatzSpec): number {
  return spec.hfState.reduce((acc, b, q) => acc | (b << (spec.nQubits - 1 - q)), 0);
}

export function ansatzState(spec: AnsatzSpec, gates: Gate[], params: number[]): Float64Array {
  const psi = new Float64Array(1 << spec.nQubits);
  psi[hfIndex(spec)] = 1;
  gates.forEach(({ exc, occ }, k) => {
    const c = Math.cos(params[k] / 2);
    const s = Math.sin(params[k] / 2);
    for (let m = 0; m < exc.length; m++) {
      const e = psi[exc[m]];
      const o = psi[occ[m]];
      psi[exc[m]] = c * e - s * o;
      psi[occ[m]] = s * e + c * o;
    }
  });
  return psi;
}

export function expectation(H: SparseMatrix, psi: Float64Array): number {
  let e = 0;
  for (let k = 0; k < H.vals.length; k++) e += psi[H.rows[k]] * H.vals[k] * psi[H.cols[k]];
  return e;
}

/** D H D with D = diag(d): the qubit Hamiltonian in a different orbital sign gauge. */
export function conjugateByDiagonal(H: SparseMatrix, d: Float64Array): SparseMatrix {
  return { rows: H.rows, cols: H.cols, vals: H.vals.map((v, k) => v * d[H.rows[k]] * d[H.cols[k]]) };
}

/** Diagonal of the Z-string that flips the given spatial orbitals (qubits 2i and 2i + 1). */
export function orbitalFlipDiagonal(nQubits: number, flippedOrbitals: number[]): Float64Array {
  const d = new Float64Array(1 << nQubits).fill(1);
  for (let z = 0; z < d.length; z++) {
    for (const i of flippedOrbitals) {
      for (const q of [2 * i, 2 * i + 1]) if ((z >> (nQubits - 1 - q)) & 1) d[z] = -d[z];
    }
  }
  return d;
}
