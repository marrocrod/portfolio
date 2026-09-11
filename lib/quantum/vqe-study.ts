// Headline results of the vqe-param-learning study, copied from its final (gauge-fixed, v2)
// run. Sources are noted per field so every number can be traced.
// Repository: https://github.com/marrocrod/vqe-param-learning

export const STUDY_URL = "https://github.com/marrocrod/vqe-param-learning";

/** Mean test error vs exact energy (mHa). Source: results/logs/phase3_model.log. */
export const benchmark = {
  methods: [
    { key: "hf", label: "Hartree-Fock", evals: 1 },
    { key: "shared", label: "One shared parameter vector", evals: 1 },
    { key: "nearest", label: "Copy nearest training geometry", evals: 1 },
    { key: "model", label: "Learned model", evals: 1 },
    { key: "opt", label: "Per-instance optimizer", evals: 451 },
  ],
  rows: [
    { molecule: "H₂", qubits: 4, hf: 101.444, shared: 35.689, nearest: 1.234, model: 0.02, opt: 0.0 },
    { molecule: "H₄", qubits: 8, hf: 147.806, shared: 38.098, nearest: 2.837, model: 1.361, opt: 1.351 },
    { molecule: "H₆", qubits: 12, hf: 180.058, shared: 44.037, nearest: 7.709, model: 6.069, opt: 6.011 },
  ],
} as const;

export const CHEMICAL_ACCURACY_MHA = 1.6;

/**
 * Max parameter-transfer error on the H6 fine grid (mHa) per sign convention.
 * v2: results/logs/check_lih_transfer.log (19.355). none and v1: the study's article, Table 1.
 */
export const transferError = { none: 452, maxAbs: 779, fixedReference: 19.4 };

/** Worst-case gap between nearest-geometry transfer and per-instance optimization on H6 (mHa). */
export const gapCollapse = {
  before: 469, // article (pre-fix run)
  after: 2.051, // results/logs/phase1_transfer.log
};

/** Finite shots, SPSA at 1024 shots: fine-tuning the model's prediction makes it worse. */
export const winnersCurse = { shots: 1024, evals: 501, before: 6.069, after: 9.282 }; // phase5_shots.log
