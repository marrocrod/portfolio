"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LineChart from "@/components/charts/line-chart";
import { Button, Slider } from "@/components/controls";
import { type AnsatzSpec, ansatzState, buildGates, expectation, type SparseMatrix } from "@/lib/quantum/givens";
import { adamAscent } from "@/lib/quantum/optimize";
import {
  benchmark,
  CHEMICAL_ACCURACY_MHA,
  gapCollapse,
  STUDY_URL,
  transferError,
  winnersCurse,
} from "@/lib/quantum/vqe-study";

interface Geometry {
  r: number;
  eHF: number;
  eFCI: number;
  H: SparseMatrix;
}

interface VqeData {
  h2: { nQubits: number; hfState: number[]; excitations: { singles: number[][]; doubles: number[][] }; geometries: Geometry[] };
  h6Gauge: {
    r: number[];
    dipThreshold: number;
    conventions: Record<"none" | "maxAbs" | "fixedReference", { overlaps: number[]; dips: number; minOverlap: number }>;
  };
}

const INK = "#17203a";
const COLORS = { hf: "#E69F00", fci: INK, vqe: "#0072B2", none: "#D55E00", maxAbs: "#E69F00", fixedReference: "#0072B2" };
const CONVENTION_LABELS = {
  none: "No fix (raw SCF signs)",
  maxAbs: "Largest coefficient positive (v1)",
  fixedReference: "Fixed reference projection (v2)",
};

const mHa = (ha: number) => ha * 1000;

export default function VqeDemo() {
  const [data, setData] = useState<VqeData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/data/vqe.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <p className="rounded-[3px] border border-dashed border-rule bg-paper-raised p-8 text-center font-serif text-[17px] text-ink-muted">
        The VQE data file is missing. Generate it with python/vqe/export_vqe.py.
      </p>
    );
  }
  if (!data) return <p className="text-[15px] text-ink-muted">Loading molecular Hamiltonians…</p>;

  return (
    <div className="space-y-20">
      <LiveH2 data={data.h2} />
      <GaugeSection data={data.h6Gauge} />
      <StudySection />
    </div>
  );
}

// ---------------------------------------------------------------- live H2 VQE

function LiveH2({ data }: { data: VqeData["h2"] }) {
  const spec: AnsatzSpec = useMemo(
    () => ({ nQubits: data.nQubits, hfState: data.hfState, singles: data.excitations.singles, doubles: data.excitations.doubles }),
    [data],
  );
  const gates = useMemo(() => buildGates(spec), [spec]);
  const nParams = gates.length;
  const doubleIndex = spec.singles.length; // H2 has exactly one double excitation, after the singles

  const [index, setIndex] = useState(() => data.geometries.findIndex((g) => Math.abs(g.r - 0.75) < 1e-6));
  const [params, setParams] = useState<number[]>(() => new Array(nParams).fill(0));
  const [solved, setSolved] = useState<Record<number, number>>({}); // geometry index -> VQE energy
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState(0);
  const raf = useRef(0);

  const geom = data.geometries[index];
  const energy = expectation(geom.H, ansatzState(spec, gates, params));
  const errorMHa = mHa(energy - geom.eFCI);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setRunning(false);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const selectGeometry = (i: number) => {
    stop();
    setIndex(i);
    setParams(new Array(nParams).fill(0));
    setSteps(0);
  };

  const optimizeAt = (g: Geometry, start: number[]) => {
    const f = (x: number[]) => -expectation(g.H, ansatzState(spec, gates, x));
    let last = null;
    for (const s of adamAscent(f, start, { lr: 0.05, maxSteps: 3000, tol: 1e-7 })) last = s;
    return last!;
  };

  const run = () => {
    const g = geom;
    const f = (x: number[]) => -expectation(g.H, ansatzState(spec, gates, x));
    const gen = adamAscent(f, new Array(nParams).fill(0), { lr: 0.05, maxSteps: 3000, tol: 1e-7 });
    setRunning(true);
    let count = 0;
    const tick = () => {
      // A few optimizer steps per frame keeps the animation readable.
      let step = null;
      for (let k = 0; k < 3; k++) {
        const next = gen.next();
        if (next.done) break;
        step = next.value;
        count++;
        if (step.done) break;
      }
      if (step) {
        setParams(step.x);
        setSteps(count);
      }
      if (!step || step.done) {
        setRunning(false);
        if (step) setSolved((s) => ({ ...s, [index]: -step.value }));
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const runCurve = () => {
    stop();
    // Parameter continuation along the curve: each geometry starts from the previous optimum.
    let start = new Array(nParams).fill(0);
    const out: Record<number, number> = {};
    data.geometries.forEach((g, i) => {
      const res = optimizeAt(g, start);
      start = res.x;
      out[i] = -res.value;
    });
    setSolved(out);
  };

  // Energy along the double-excitation angle, singles held at zero.
  const landscape = useMemo(() => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= 160; k++) {
      const t = -Math.PI + (2 * Math.PI * k) / 160;
      const x = new Array(nParams).fill(0);
      x[doubleIndex] = t;
      pts.push([t, expectation(geom.H, ansatzState(spec, gates, x))]);
    }
    return pts;
  }, [geom, spec, gates, nParams, doubleIndex]);

  const curve = {
    hf: data.geometries.map((g) => [g.r, g.eHF] as [number, number]),
    fci: data.geometries.map((g) => [g.r, g.eFCI] as [number, number]),
    vqe: Object.entries(solved)
      .map(([i, e]) => [data.geometries[Number(i)].r, e] as [number, number])
      .sort((a, b) => a[0] - b[0]),
  };

  return (
    <section aria-labelledby="live-h2">
      <div className="max-w-3xl">
        <h2 id="live-h2" className="font-serif text-[36px] font-medium leading-[1.1]">
          Live: VQE on the hydrogen molecule
        </h2>
        <p className="mt-4 font-serif text-[18px] leading-[1.6] text-ink-muted">
          Four qubits, a Givens-rotation ansatz with three angles (two single excitations and one double), and the
          exact STO-3G Hamiltonian at each bond length. The simulator here is the same one the study verified against
          PennyLane, reimplemented in TypeScript and checked gate by gate.
        </p>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <LineChart
            ariaLabel="H2 dissociation curve"
            series={[
              { name: "Hartree-Fock", color: COLORS.hf, points: curve.hf },
              { name: "Exact (FCI)", color: COLORS.fci, points: curve.fci },
              { name: "VQE", color: COLORS.vqe, points: curve.vqe, dots: true },
            ]}
            xLabel="Bond length (Å)"
            yLabel="Energy (Ha)"
            vLine={geom.r}
            onPickX={(x) => {
              const i = data.geometries.reduce((b, g, k) => (Math.abs(g.r - x) < Math.abs(data.geometries[b].r - x) ? k : b), 0);
              selectGeometry(i);
            }}
          />
          <p className="mt-2 text-[14px] text-ink-muted">Click the curve to pick a bond length.</p>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <Slider
            label="Bond length"
            value={geom.r}
            min={data.geometries[0].r}
            max={data.geometries[data.geometries.length - 1].r}
            step={0.05}
            format={(v) => `${v.toFixed(2)} Å`}
            onChange={(v) => selectGeometry(data.geometries.findIndex((g) => Math.abs(g.r - v) < 0.026))}
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={running ? stop : run}>
              {running ? "Stop" : "Run VQE here"}
            </Button>
            <Button onClick={runCurve} disabled={running}>
              Solve the whole curve
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-[14px] text-ink-muted">Energy now</dt>
              <dd className="font-serif text-[22px] tabular-nums">{energy.toFixed(6)} Ha</dd>
            </div>
            <div>
              <dt className="text-[14px] text-ink-muted">Exact (FCI)</dt>
              <dd className="font-serif text-[22px] tabular-nums">{geom.eFCI.toFixed(6)} Ha</dd>
            </div>
            <div>
              <dt className="text-[14px] text-ink-muted">Error</dt>
              <dd className="font-serif text-[22px] tabular-nums">
                {errorMHa < 0.001 ? "< 0.001" : errorMHa.toFixed(3)} mHa
              </dd>
            </div>
            <div>
              <dt className="text-[14px] text-ink-muted">Optimizer steps</dt>
              <dd className="font-serif text-[22px] tabular-nums">{steps}</dd>
            </div>
          </dl>
          <p className="text-[15px] leading-[1.5] text-ink">
            {errorMHa <= CHEMICAL_ACCURACY_MHA
              ? "Within chemical accuracy (1.6 mHa)."
              : `${(errorMHa / CHEMICAL_ACCURACY_MHA).toFixed(0)}× above chemical accuracy. Starting point: Hartree-Fock.`}
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <LineChart
            ariaLabel="Energy as a function of the double-excitation angle"
            series={[
              { name: "Energy with singles at zero", color: COLORS.vqe, points: landscape },
              { name: "Current angle", color: INK, points: [[params[doubleIndex], energy]], dots: true },
            ]}
            xLabel="Double-excitation angle θ (radians)"
            yLabel="Energy (Ha)"
            hLines={[{ y: geom.eFCI, label: "exact ground energy" }]}
            formatX={(x) => x.toFixed(1)}
            height={240}
          />
        </div>
        <p className="text-[15px] leading-[1.6] text-ink-muted lg:col-span-5 lg:pt-4">
          In H₂ the single excitations stay at zero by symmetry, so the whole problem is this one-dimensional
          landscape: a shifted cosine in θ whose minimum touches the exact energy. The ansatz is exact for H₂ at every
          bond length, which is the study&apos;s fourth verification check.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- gauge diagnostic

function GaugeSection({ data }: { data: VqeData["h6Gauge"] }) {
  const keys = ["none", "maxAbs", "fixedReference"] as const;
  const mid = data.r.slice(0, -1).map((r, i) => (r + data.r[i + 1]) / 2);

  return (
    <section aria-labelledby="gauge" className="border-t border-rule pt-14">
      <div className="max-w-3xl">
        <h2 id="gauge" className="font-serif text-[36px] font-medium leading-[1.1]">
          The finding: orbital signs are a hidden gauge
        </h2>
        <p className="mt-4 font-serif text-[18px] leading-[1.6] text-ink-muted">
          Every molecular orbital is defined only up to a sign, and the self-consistent-field solver picks one
          arbitrarily at each geometry. Energies do not care, but the qubit Hamiltonian does: flipping orbital i
          conjugates it by Z₂ᵢZ₂ᵢ₊₁, and every circuit angle touching that orbital changes sign. A model that learns
          angles from geometry then trains on contradictory labels.
        </p>
        <p className="mt-4 font-serif text-[18px] leading-[1.6] text-ink-muted">
          The test below needs no ansatz. Physics changes smoothly along the H₆ chain, so exact ground states of
          neighbouring geometries should overlap almost perfectly. Dips mean the encoding jumped, not the molecule.
        </p>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <LineChart
            ariaLabel="Overlap between exact ground states of neighbouring H6 geometries"
            series={keys.map((k) => ({
              name: CONVENTION_LABELS[k],
              color: COLORS[k],
              points: mid.map((x, i) => [x, data.conventions[k].overlaps[i]] as [number, number]),
              width: k === "fixedReference" ? 2.5 : 1.75,
              markers: true,
            }))}
            xLabel="H–H spacing (Å), midpoint of each 0.05 Å step"
            yLabel="|⟨gs(r)|gs(r + dr)⟩|"
            yDomain={[0, 1.04]}
            hLines={[{ y: data.dipThreshold, label: `dip threshold ${data.dipThreshold}` }]}
            formatY={(y) => y.toFixed(2)}
          />
        </div>
        <div className="lg:col-span-5">
          <table className="w-full border-collapse text-[15px] tabular-nums">
            <caption className="mb-3 text-left text-[14px] leading-[1.5] text-ink-muted">
              H₆ fine grid, 23 geometries. Dips and overlaps recomputed for this page from PennyLane; transfer errors
              from the study.
            </caption>
            <thead>
              <tr className="border-b border-rule text-left text-[14px] text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-normal">Sign convention</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Dips</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Min overlap</th>
                <th scope="col" className="py-2 text-right font-normal">Max transfer error</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-b border-rule/70">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="h-0.5 w-4 shrink-0" style={{ background: COLORS[k] }} />
                      {CONVENTION_LABELS[k]}
                    </span>
                  </th>
                  <td className="py-2.5 pr-3 text-right text-ink">{data.conventions[k].dips}</td>
                  <td className="py-2.5 pr-3 text-right text-ink">{data.conventions[k].minOverlap.toFixed(4)}</td>
                  <td className="whitespace-nowrap py-2.5 text-right text-ink">{transferError[k]} mHa</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 text-[15px] leading-[1.6] text-ink">
            With the fix, the worst-case gap between copying the nearest geometry&apos;s angles and optimizing each
            geometry from scratch fell from {gapCollapse.before} to {gapCollapse.after.toFixed(2)} mHa: about{" "}
            {(100 * (1 - gapCollapse.after / gapCollapse.before)).toFixed(1)}% of the apparent per-geometry signal was
            gauge.
          </p>
          <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">
            The first convention is itself a lesson: the largest coefficient can hop between near-tied entries, which
            creates new dips instead of removing them. H₂ never shows the problem, because its only relevant
            excitation moves a closed-shell pair and is unchanged by any sign flip.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- study results

function StudySection() {
  const cols = benchmark.methods;
  return (
    <section aria-labelledby="study" className="border-t border-rule pt-14">
      <div className="max-w-3xl">
        <h2 id="study" className="font-serif text-[36px] font-medium leading-[1.1]">
          Can a model predict the angles?
        </h2>
        <p className="mt-4 font-serif text-[18px] leading-[1.6] text-ink-muted">
          On the gauge-fixed benchmark, a small network maps eleven cheap classical features of a molecule to all of
          its circuit angles. Every method is charged for the circuit evaluations it spends on each test geometry.
        </p>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[15px] tabular-nums">
          <caption className="mb-3 text-left text-[14px] text-ink-muted">
            Mean error against the exact energy on unseen geometries (mHa). Chemical accuracy is{" "}
            {CHEMICAL_ACCURACY_MHA} mHa.
          </caption>
          <thead>
            <tr className="border-b border-rule text-[14px] text-ink-muted">
              <th scope="col" className="py-2 pr-4 text-left font-normal">Molecule</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="py-2 pr-4 text-right font-normal">
                  {c.label}
                  <span className="block text-[12px]">
                    {c.evals} evaluation{c.evals > 1 ? "s" : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {benchmark.rows.map((row) => (
              <tr key={row.molecule} className="border-b border-rule/70">
                <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink">
                  {row.molecule} <span className="text-ink-muted">({row.qubits} qubits)</span>
                </th>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`py-2.5 pr-4 text-right ${c.key === "model" ? "font-medium text-accent-strong" : "text-ink"}`}
                  >
                    {row[c.key].toFixed(3)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-6 font-serif text-[17px] leading-[1.6] text-ink-muted md:grid-cols-3">
        <p>
          <span className="text-ink">One evaluation instead of 451.</span> The model lands on the floor of what the
          ansatz can express for all three molecules, matching the per-geometry optimizer on geometries it never saw.
        </p>
        <p>
          <span className="text-ink">Predict, then leave it alone.</span> With {winnersCurse.shots} measurement shots,
          fine-tuning the prediction with SPSA made it worse: {winnersCurse.before.toFixed(2)} to{" "}
          {winnersCurse.after.toFixed(2)} mHa after {winnersCurse.evals} noisy evaluations.
        </p>
        <p>
          <span className="text-ink">Declared failures.</span> The model breaks when extrapolating toward
          dissociation and when transferred zero-shot to a molecule it was not trained on. Both exams were declared
          before running them.
        </p>
      </div>
      <p className="mt-8 text-[15px]">
        <a href={STUDY_URL} className="text-link">
          Code, logs and verification suite on GitHub
        </a>
      </p>
    </section>
  );
}
