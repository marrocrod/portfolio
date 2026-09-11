"""Export the data behind the VQE demo, following the conventions of the
vqe-param-learning study (https://github.com/marrocrod/vqe-param-learning).

  * PennyLane qchem, STO-3G, Jordan-Wigner; Angstrom -> Bohr in one place.
  * Qubit q is bit (n - 1 - q) of the basis index (PennyLane's convention).
  * A sign flip of spatial orbital i conjugates H by Z_{2i} Z_{2i+1}.

Two datasets are written to public/data/vqe.json:
  * h2: Hamiltonians along the dissociation curve in the v2 gauge. The browser
    runs the Givens-ansatz VQE on them live.
  * h6: the ansatz-free gauge diagnostic of the study. For each sign convention,
    the overlap |<gs(r)|gs(r + dr)>| between exact ground states of neighbouring
    geometries on the H6 fine grid. Physics changes smoothly, so dips signal
    that the qubit encoding itself jumped.

Usage (from the portfolio repository root):
    pip install -r python/vqe/requirements.txt
    python python/vqe/export_vqe.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pennylane as qml
import scipy.sparse as sp
import scipy.sparse.linalg as spla

BOHR_PER_ANGSTROM = 1.8897259886
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data" / "vqe.json"
DIP_THRESHOLD = 0.99  # the study's definition of an overlap dip


def molecule(n_atoms: int, r: float):
    coords = np.array([[0.0, 0.0, i * r] for i in range(n_atoms)]) * BOHR_PER_ANGSTROM
    return qml.qchem.Molecule(["H"] * n_atoms, coords)


# ---------------------------------------------------------------- sign conventions

def signs_fixed_reference(C: np.ndarray) -> list[int]:
    """v2 (the study's final convention): sign of the projection on a fixed random vector."""
    w = np.random.default_rng(12345).normal(size=C.shape[0])
    w2 = np.random.default_rng(67890).normal(size=C.shape[0])
    out = []
    for i in range(C.shape[1]):
        proj = float(w @ C[:, i])
        if abs(proj) < 1e-8:
            proj = float(w2 @ C[:, i])
        out.append(-1 if proj < 0 else 1)
    return out


def signs_max_abs(C: np.ndarray) -> list[int]:
    """v1: make the largest-magnitude coefficient of each orbital positive."""
    return [-1 if C[np.argmax(np.abs(C[:, i])), i] < 0 else 1 for i in range(C.shape[1])]


def flip_diagonal(signs: list[int], n_qubits: int) -> np.ndarray:
    idx = np.arange(2**n_qubits)
    d = np.ones(2**n_qubits)
    for i, s in enumerate(signs):
        if s < 0:
            for q in (2 * i, 2 * i + 1):
                d *= 1 - 2 * ((idx >> (n_qubits - 1 - q)) & 1)
    return d


def raw_hamiltonian(mol):
    """Qubit Hamiltonian exactly as PennyLane builds it (no gauge fix), plus MO coefficients."""
    H, n = qml.qchem.molecular_hamiltonian(mol)
    Hs = H.sparse_matrix(wire_order=list(range(n))).tocsr()
    C = np.array(qml.qchem.scf(mol)()[1], dtype=float)
    return Hs, n, C


def conjugate(Hs, d):
    D = sp.diags(d)
    return (D @ Hs @ D).tocsr()


# ---------------------------------------------------------------- datasets

def export_h2():
    grid = np.round(np.arange(0.30, 2.5001, 0.05), 2)
    geometries = []
    for r in grid:
        mol = molecule(2, float(r))
        Hs, n, C = raw_hamiltonian(mol)
        assert abs(Hs.imag).max() < 1e-12 if Hs.dtype.kind == "c" else True
        H = conjugate(Hs.real if Hs.dtype.kind == "c" else Hs, flip_diagonal(signs_fixed_reference(C), n)).toarray()
        rows, cols = np.nonzero(np.abs(H) > 1e-12)
        geometries.append(
            {
                "r": float(r),
                "eHF": float(qml.qchem.hf_energy(mol)()),
                "eFCI": float(np.linalg.eigvalsh(H)[0]),
                "H": {"rows": rows.tolist(), "cols": cols.tolist(), "vals": [round(float(v), 12) for v in H[rows, cols]]},
            }
        )
    singles, doubles = qml.qchem.excitations(2, 4)
    return {
        "nQubits": 4,
        "hfState": [int(b) for b in qml.qchem.hf_state(2, 4)],
        "excitations": {"singles": [list(map(int, s)) for s in singles], "doubles": [list(map(int, x)) for x in doubles]},
        "geometries": geometries,
    }


def export_h6_gauge():
    grid = np.round(np.arange(0.70, 1.8001, 0.05), 2)  # the study's H6 fine grid: 23 geometries
    conventions = {"none": None, "maxAbs": signs_max_abs, "fixedReference": signs_fixed_reference}
    ground = {k: [] for k in conventions}
    raw_signs = []
    for r in grid:
        Hs, n, C = raw_hamiltonian(molecule(6, float(r)))
        Hs = Hs.real if Hs.dtype.kind == "c" else Hs
        raw_signs.append(signs_fixed_reference(C))
        for name, rule in conventions.items():
            H = Hs if rule is None else conjugate(Hs, flip_diagonal(rule(C), n))
            _, vec = spla.eigsh(H, k=1, which="SA")
            ground[name].append(vec[:, 0])
        print(f"  H6 r={r:.2f} done")

    out = {"r": grid.tolist(), "dipThreshold": DIP_THRESHOLD, "conventions": {}}
    for name, states in ground.items():
        overlaps = [float(abs(states[i] @ states[i + 1])) for i in range(len(states) - 1)]
        out["conventions"][name] = {
            "overlaps": [round(o, 6) for o in overlaps],
            "dips": int(sum(o < DIP_THRESHOLD for o in overlaps)),
            "minOverlap": round(min(overlaps), 6),
        }
        print(f"  {name:15s} dips={out['conventions'][name]['dips']:2d}  min overlap={min(overlaps):.4f}")
    return out


def main():
    print("H2 Hamiltonians…")
    h2 = export_h2()
    print("H6 gauge diagnostic (ansatz-free)…")
    h6 = export_h6_gauge()
    data = {
        "source": "python/vqe/export_vqe.py, conventions of github.com/marrocrod/vqe-param-learning",
        "basis": "STO-3G",
        "mapping": "Jordan-Wigner",
        "h2": h2,
        "h6Gauge": h6,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
