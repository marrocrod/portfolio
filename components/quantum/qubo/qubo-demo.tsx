"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LineChart from "@/components/charts/line-chart";
import { Button, Segmented, Slider } from "@/components/controls";
import { interp, linearRamp } from "@/lib/quantum/maxcut";
import { adamAscent } from "@/lib/quantum/optimize";
import {
  anneal,
  energies,
  expectationOf,
  explain,
  independentSet,
  MAX_VARS,
  matrixText,
  numberPartition,
  optimum,
  parseMatrix,
  type ProblemKind,
  type Qubo,
  qaoaProbs,
  randomQubo,
  repetitionsFor95,
  standardized,
} from "@/lib/quantum/qubo";

const SA_COLOR = "#E69F00";
const QAOA_COLOR = "#0072B2";
const INK = "#17203a";
const SA_RUNS = 200;
const FRAME_BUDGET_MS = 12;

function generate(kind: ProblemKind, n: number, seed: number): Qubo {
  if (kind === "partition") return numberPartition(n, seed);
  if (kind === "independent-set") return independentSet(n, seed);
  return randomQubo(n, seed);
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

/** Optimizes QAOA layer by layer: depth 1 from a linear ramp, then each depth from the previous (INTERP). */
function* qaoaSchedule(n: number, cost: Float64Array, depth: number) {
  let x: number[] = [];
  let evaluations = 0;
  for (let p = 1; p <= depth; p++) {
    const r = linearRamp(1);
    const start = p === 1 ? [...r.gammas, ...r.betas] : [...interp(x.slice(0, p - 1)), ...interp(x.slice(p - 1))];
    const f = (v: number[]) => -expectationOf(qaoaProbs(n, cost, v.slice(0, p), v.slice(p)), cost);
    for (const step of adamAscent(f, start, { maxSteps: 300 })) {
      evaluations += 4 * p + 1; // central differences on 2p angles, plus the value itself
      x = step.x;
      yield { p, x, evaluations, done: step.done && p === depth };
    }
  }
}

export default function QuboDemo() {
  const [kind, setKind] = useState<ProblemKind>("independent-set");
  const [n, setN] = useState(8);
  const [seed, setSeed] = useState(5);
  const [custom, setCustom] = useState<Qubo | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const qubo = useMemo(() => (kind === "custom" && custom ? custom : generate(kind, n, seed)), [kind, n, seed, custom]);
  const E = useMemo(() => energies(qubo), [qubo]);
  const opt = useMemo(() => optimum(E), [E]);
  const cost = useMemo(() => standardized(E), [E]);
  const optSet = useMemo(() => new Set(opt.states), [opt]);
  const uniformMean = useMemo(() => E.reduce((a, b) => a + b, 0) / E.length, [E]);

  // ---- simulated annealing
  const [sweeps, setSweeps] = useState(30);
  const [saTrace, setSaTrace] = useState<{ current: number[]; best: number[] }>({ current: [], best: [] });
  const [saStats, setSaStats] = useState<{ pOpt: number; mean: number } | null>(null);
  const saRaf = useRef(0);

  // ---- QAOA
  const [depth, setDepth] = useState(2);
  const [qaoaX, setQaoaX] = useState<number[] | null>(null);
  const [qaoaTrace, setQaoaTrace] = useState<number[]>([]);
  const [qaoaEvals, setQaoaEvals] = useState(0);
  const [qaoaRunning, setQaoaRunning] = useState(false);
  const qaoaRaf = useRef(0);

  // ---- scaling study
  const [scaling, setScaling] = useState<{ n: number; sa: number; qaoa: number }[]>([]);
  const [scalingProgress, setScalingProgress] = useState<number | null>(null);
  const scalingCancel = useRef(false);

  const resetRuns = useCallback(() => {
    cancelAnimationFrame(saRaf.current);
    cancelAnimationFrame(qaoaRaf.current);
    setSaTrace({ current: [], best: [] });
    setSaStats(null);
    setQaoaX(null);
    setQaoaTrace([]);
    setQaoaEvals(0);
    setQaoaRunning(false);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(saRaf.current);
      cancelAnimationFrame(qaoaRaf.current);
      scalingCancel.current = true;
    },
    [],
  );

  const changeProblem = (next: { kind?: ProblemKind; n?: number; seed?: number }) => {
    resetRuns();
    setScaling([]);
    if (next.kind !== undefined) setKind(next.kind);
    if (next.n !== undefined) setN(next.n);
    if (next.seed !== undefined) setSeed(next.seed);
  };

  const runAnneal = () => {
    cancelAnimationFrame(saRaf.current);
    const run = anneal(qubo, sweeps, seed * 1000 + 1);
    // Many independent runs give the probability that one run finds the optimum.
    let hits = 0;
    let total = 0;
    for (let r = 0; r < SA_RUNS; r++) {
      const res = anneal(qubo, sweeps, seed * 1000 + 2 + r);
      if (Math.abs(res.best - opt.value) < 1e-9) hits++;
      total += res.final;
    }
    const start = performance.now();
    const duration = Math.min(1500, 200 + sweeps * 8);
    setSaStats(null);
    const tick = (now: number) => {
      const k = Math.max(1, Math.ceil(((now - start) / duration) * run.trace.length));
      setSaTrace({ current: run.trace.slice(0, k), best: run.bestTrace.slice(0, k) });
      if (k < run.trace.length) saRaf.current = requestAnimationFrame(tick);
      else setSaStats({ pOpt: hits / SA_RUNS, mean: total / SA_RUNS });
    };
    saRaf.current = requestAnimationFrame(tick);
  };

  const runQaoa = () => {
    cancelAnimationFrame(qaoaRaf.current);
    const gen = qaoaSchedule(qubo.n, cost, depth);
    const trace: number[] = [];
    setQaoaRunning(true);
    const tick = () => {
      const t0 = performance.now();
      let last: { p: number; x: number[]; evaluations: number; done: boolean } | null = null;
      do {
        const next = gen.next();
        if (next.done) break;
        last = next.value;
        const probs = qaoaProbs(qubo.n, cost, last.x.slice(0, last.p), last.x.slice(last.p));
        trace.push(expectationOf(probs, E));
        if (last.done) break;
      } while (performance.now() - t0 < FRAME_BUDGET_MS);
      if (last) {
        setQaoaX(last.x);
        setQaoaTrace([...trace]);
        setQaoaEvals(last.evaluations);
      }
      if (!last || last.done) {
        setQaoaRunning(false);
        return;
      }
      qaoaRaf.current = requestAnimationFrame(tick);
    };
    qaoaRaf.current = requestAnimationFrame(tick);
  };

  const qaoaResult = useMemo(() => {
    if (!qaoaX) return null;
    const p = qaoaX.length / 2;
    const probs = qaoaProbs(qubo.n, cost, qaoaX.slice(0, p), qaoaX.slice(p));
    let pOpt = 0;
    optSet.forEach((z) => (pOpt += probs[z]));
    return { p, mean: expectationOf(probs, E), pOpt };
  }, [qaoaX, qubo, cost, E, optSet]);

  const runScaling = async () => {
    scalingCancel.current = false;
    const family = kind === "custom" ? "random" : kind;
    const sizes = [4, 6, 8, 10, 12];
    const instances = 3;
    const rows: { n: number; sa: number; qaoa: number }[] = [];
    setScaling([]);
    for (let si = 0; si < sizes.length; si++) {
      let sa = 0;
      let qa = 0;
      for (let k = 0; k < instances; k++) {
        await new Promise((r) => setTimeout(r, 0)); // let the page breathe between instances
        if (scalingCancel.current) return;
        setScalingProgress((si * instances + k) / (sizes.length * instances));
        const q = generate(family, sizes[si], 100 + k);
        const En = energies(q);
        const o = optimum(En);
        let hits = 0;
        for (let r = 0; r < 100; r++) if (Math.abs(anneal(q, sweeps, r).best - o.value) < 1e-9) hits++;
        sa += hits / 100;
        const Cn = standardized(En);
        let x: number[] = [];
        for (const step of qaoaSchedule(q.n, Cn, 2)) x = step.x;
        const probs = qaoaProbs(q.n, Cn, x.slice(0, 2), x.slice(2));
        qa += o.states.reduce((s, z) => s + probs[z], 0);
      }
      rows.push({ n: sizes[si], sa: sa / instances, qaoa: qa / instances });
      setScaling([...rows]);
    }
    setScalingProgress(null);
  };

  const applyCustom = () => {
    const parsed = parseMatrix(draft);
    if (typeof parsed === "string") {
      setDraftError(parsed);
      return;
    }
    setDraftError(null);
    resetRuns();
    setScaling([]);
    setCustom(parsed);
    setKind("custom");
  };

  return (
    <div className="space-y-16">
      {/* ---------------- problem ---------------- */}
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <Segmented<ProblemKind>
            legend="Problem"
            value={kind}
            onChange={(k) => changeProblem({ kind: k })}
            options={[
              { value: "independent-set", label: "Independent set" },
              { value: "partition", label: "Partition" },
              { value: "random", label: "Random" },
              { value: "custom", label: "Custom", disabled: !custom },
            ]}
          />
          {kind !== "custom" && (
            <>
              <Slider label="Variables (qubits)" value={n} min={4} max={MAX_VARS} onChange={(v) => changeProblem({ n: v })} />
              <Button onClick={() => changeProblem({ seed: seed + 1 })}>New instance</Button>
            </>
          )}
          <p className="font-serif text-[17px] leading-[1.6] text-ink-muted">{qubo.description}</p>
          <Heatmap qubo={qubo} />
          <details className="text-[15px]">
            <summary className="cursor-pointer text-ink">Write your own matrix</summary>
            <div className="mt-3 space-y-3">
              <label htmlFor="qubo-matrix" className="block text-[14px] leading-[1.5] text-ink-muted">
                One row per line, up to {MAX_VARS} rows. The energy is xᵀMx for binary x.
              </label>
              <textarea
                id="qubo-matrix"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={matrixText(qubo)}
                className="w-full rounded-[3px] border border-ink/20 bg-paper px-3 py-2 font-mono text-[13px] text-ink"
              />
              {draftError && (
                <p role="alert" className="text-[14px] text-[#9a3412]">
                  {draftError}
                </p>
              )}
              <div className="flex gap-2">
                <Button onClick={() => setDraft(matrixText(qubo))}>Copy current problem</Button>
                <Button variant="primary" onClick={applyCustom}>
                  Use this matrix
                </Button>
              </div>
            </div>
          </details>
        </div>

        <div className="lg:col-span-7">
          <EnergyHistogram
            E={E}
            markers={[
              { value: opt.value, label: "Optimum", color: INK },
              ...(saStats ? [{ value: saStats.mean, label: "Annealing, average end", color: SA_COLOR }] : []),
              ...(qaoaResult ? [{ value: qaoaResult.mean, label: "QAOA ⟨E⟩", color: QAOA_COLOR }] : []),
            ]}
            uniformMean={uniformMean}
          />
          <div className="mt-6 space-y-1 text-[15px] leading-[1.55]">
            <p className="text-ink">
              Best possible energy: {fmt(opt.value)}
              {opt.states.length > 1 ? `, reached by ${opt.states.length} different solutions` : ""}. Found by checking all{" "}
              {E.length.toLocaleString("en-GB")} candidates.
            </p>
            <p className="text-ink-muted">{explain(qubo, opt.states[0])}</p>
          </div>
        </div>
      </div>

      {/* ---------------- the two solvers ---------------- */}
      <div className="grid gap-x-12 gap-y-14 border-t border-rule pt-12 lg:grid-cols-2">
        <section aria-labelledby="sa-title" className="space-y-5">
          <h2 id="sa-title" className="font-serif text-[28px] font-medium">
            Simulated annealing
          </h2>
          <p className="text-[15px] leading-[1.55] text-ink-muted">
            A classical random walk over bitstrings. It flips one variable at a time, always accepts improvements and
            sometimes accepts worse moves, less and less often as the temperature drops.
          </p>
          <Slider label="Sweeps per run" value={sweeps} min={5} max={2000} log onChange={(v) => {
              cancelAnimationFrame(saRaf.current);
              setSweeps(Math.round(v));
              setSaTrace({ current: [], best: [] });
              setSaStats(null);
            }}
          />
          <Button variant="primary" onClick={runAnneal}>
            Anneal
          </Button>
          <LineChart
            ariaLabel="Energy during one annealing run"
            series={[
              { name: "Current energy, one run", color: SA_COLOR, width: 1.25, points: saTrace.current.map((e, i) => [i, e] as [number, number]) },
              { name: "Best so far", color: "#9a5b00", width: 2.5, points: saTrace.best.map((e, i) => [i, e] as [number, number]) },
            ]}
            xLabel="Sweep (0 = random start)"
            yLabel="Energy"
            xDomain={[0, Math.max(1, sweeps)]}
            hLines={[{ y: opt.value, label: "optimum" }]}
            formatX={(x) => x.toFixed(0)}
            formatY={fmt}
            height={220}
          />
          {saStats && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Stat label="One run finds the optimum at some point" value={pct(saStats.pOpt)} />
              <Stat label={`Average final energy (${SA_RUNS} runs)`} value={fmt(saStats.mean)} />
              <Stat label="Energy updates per run" value={(sweeps * qubo.n).toLocaleString("en-GB")} />
              <Stat
                label="Runs for a 95% chance"
                value={Number.isFinite(repetitionsFor95(saStats.pOpt)) ? String(repetitionsFor95(saStats.pOpt)) : "never seen"}
              />
            </dl>
          )}
        </section>

        <section aria-labelledby="qaoa-title" className="space-y-5">
          <h2 id="qaoa-title" className="font-serif text-[28px] font-medium">
            QAOA
          </h2>
          <p className="text-[15px] leading-[1.55] text-ink-muted">
            The same energies become phases on a {qubo.n}-qubit state, alternated with mixing rotations. The angles are
            trained layer by layer: each depth starts from the previous one (INTERP). Simulated exactly, so these are
            ideal numbers with no hardware noise.
          </p>
          <Slider label="Circuit depth (p)" value={depth} min={1} max={4} onChange={(v) => setDepth(v)} />
          <Button variant="primary" onClick={runQaoa} disabled={qaoaRunning}>
            {qaoaRunning ? "Training…" : "Train the circuit"}
          </Button>
          <LineChart
            ariaLabel="QAOA expected energy during training"
            series={[{ name: "Expected energy ⟨E⟩", color: QAOA_COLOR, points: qaoaTrace.map((e, i) => [i + 1, e] as [number, number]) }]}
            xLabel="Optimizer step (all layers)"
            yLabel="Energy"
            xDomain={[1, Math.max(2, qaoaTrace.length)]}
            yDomain={[
              opt.value - 0.05 * (uniformMean - opt.value),
              Math.max(uniformMean, ...qaoaTrace) + 0.08 * (uniformMean - opt.value),
            ]}
            hLines={[{ y: opt.value, label: "optimum" }]}
            formatX={(x) => x.toFixed(0)}
            formatY={fmt}
            height={220}
          />
          {qaoaResult && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Stat label="One shot finds the optimum" value={pct(qaoaResult.pOpt)} />
              <Stat label="Expected energy" value={fmt(qaoaResult.mean)} />
              <Stat label="Circuit evaluations to train" value={qaoaEvals.toLocaleString("en-GB")} />
              <Stat label="Shots for a 95% chance" value={String(repetitionsFor95(qaoaResult.pOpt))} />
            </dl>
          )}
        </section>
      </div>
      <p className="-mt-6 max-w-3xl text-[14px] leading-[1.6] text-ink-muted">
        The costs are not the same currency: an annealing step is a cheap classical update, while a circuit evaluation
        on hardware would itself need many shots to estimate ⟨E⟩. QAOA also minimizes the average energy, which is not
        the same as maximizing the chance of the optimum; on some instances the two disagree.
      </p>

      {/* ---------------- scaling ---------------- */}
      <section aria-labelledby="scaling-title" className="grid gap-x-12 gap-y-8 border-t border-rule pt-12 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <h2 id="scaling-title" className="font-serif text-[28px] font-medium">
            As the problem grows
          </h2>
          <p className="text-[15px] leading-[1.55] text-ink-muted">
            Three instances of the current problem family at each size, from 4 to 12 variables. Annealing uses{" "}
            {sweeps} sweeps per run; QAOA is trained at depth 2. The chart shows how often a single run, or a single
            shot, lands on an optimal solution.
          </p>
          <Button variant="primary" onClick={runScaling} disabled={scalingProgress !== null}>
            {scalingProgress !== null ? `Running… ${Math.round(scalingProgress * 100)}%` : "Run the comparison"}
          </Button>
        </div>
        <div className="lg:col-span-7">
          <LineChart
            ariaLabel="Chance of finding the optimum versus problem size"
            series={[
              { name: `Annealing, ${sweeps} sweeps`, color: SA_COLOR, points: scaling.map((r) => [r.n, r.sa] as [number, number]), markers: true },
              { name: "QAOA, depth 2", color: QAOA_COLOR, points: scaling.map((r) => [r.n, r.qaoa] as [number, number]), markers: true },
            ]}
            xLabel="Variables"
            yLabel="Chance of the optimum"
            xDomain={[4, 12]}
            yDomain={[0, 1]}
            formatX={(x) => x.toFixed(0)}
            formatY={(y) => `${Math.round(y * 100)}%`}
            height={260}
          />
          {scaling.length === 5 && (
            <p className="mt-3 text-[15px] leading-[1.6] text-ink">
              At these sizes a modest classical annealer is hard to beat. That is the expected result: whether QAOA
              can outperform classical heuristics needs problems far larger than any laptop can simulate, and it is
              still an open question.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[14px] leading-[1.35] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-serif text-[22px] tabular-nums">{value}</dd>
    </div>
  );
}

function Heatmap({ qubo }: { qubo: Qubo }) {
  const { n, Q } = qubo;
  let max = 0;
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) max = Math.max(max, Math.abs(Q[i * n + j]));
  const cell = 100 / (n + 1);
  const color = (v: number) => {
    const t = max ? Math.min(1, Math.abs(v) / max) : 0;
    const [r, g, b] = v < 0 ? [0, 114, 178] : [213, 94, 0];
    const mix = (c: number) => Math.round(251 + (c - 251) * t);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  };
  return (
    <figure>
      <svg viewBox="0 0 100 100" className="w-full max-w-[360px]" role="img" aria-label={`QUBO matrix, ${n} by ${n}`}>
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <text x={cell * (i + 1.5)} y={cell * 0.7} textAnchor="middle" fontSize={Math.min(4, cell * 0.5)} fill="#56607a">
              {i}
            </text>
            <text x={cell * 0.6} y={cell * (i + 1.5)} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(4, cell * 0.5)} fill="#56607a">
              {i}
            </text>
            {Array.from({ length: n }, (_, j) =>
              j >= i ? (
                <rect
                  key={j}
                  x={cell * (j + 1)}
                  y={cell * (i + 1)}
                  width={cell - 0.4}
                  height={cell - 0.4}
                  fill={color(Q[i * n + j])}
                >
                  <title>{`Q[${i},${j}] = ${Q[i * n + j]}`}</title>
                </rect>
              ) : null,
            )}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 text-[14px] text-ink-muted">
        Coefficients: blue lowers the energy when both variables are 1, orange raises it. Diagonal cells act on a single
        variable.
      </figcaption>
    </figure>
  );
}

function EnergyHistogram({
  E,
  markers,
  uniformMean,
}: {
  E: Float64Array;
  markers: { value: number; label: string; color: string }[];
  uniformMean: number;
}) {
  const W = 520;
  const H = 240;
  const pad = { l: 12, r: 12, t: 16, b: 40 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of E) {
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  const bins = 40;
  const counts = new Array(bins).fill(0);
  for (const e of E) counts[Math.min(bins - 1, Math.floor(((e - lo) / (hi - lo || 1)) * bins))]++;
  const maxCount = Math.max(...counts);
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const bw = (W - pad.l - pad.r) / bins;

  return (
    <figure>
      <figcaption className="mb-2 font-serif text-[20px] text-ink">Every possible solution, by energy</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Histogram of the energies of all bitstrings">
        {counts.map((c, i) => {
          const h = (c / maxCount) * (H - pad.t - pad.b);
          return <rect key={i} x={pad.l + i * bw} y={H - pad.b - h} width={bw - 1} height={h} fill="#cfd5de" />;
        })}
        <line x1={x(uniformMean)} x2={x(uniformMean)} y1={pad.t} y2={H - pad.b} stroke="#56607a" strokeDasharray="4 4" />
        {markers.map((m) => (
          <line key={m.label} x1={x(m.value)} x2={x(m.value)} y1={pad.t} y2={H - pad.b} stroke={m.color} strokeWidth={2.5} />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#cfd5de" />
        <text x={pad.l} y={H - pad.b + 18} fontSize={13} fill="#56607a">
          {fmt(lo)}
        </text>
        <text x={W - pad.r} y={H - pad.b + 18} textAnchor="end" fontSize={13} fill="#56607a">
          {fmt(hi)}
        </text>
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={13} fill="#56607a">
          Energy (lower is better)
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-ink-muted">
        {markers.map((m) => (
          <span key={m.label} className="flex items-center gap-1.5 tabular-nums">
            <span className="h-3 w-0.5" style={{ background: m.color }} />
            {m.label}: {fmt(m.value)}
          </span>
        ))}
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="h-3 w-0.5 border-l border-dashed border-ink-muted" />
          Random guess, average: {fmt(uniformMean)}
        </span>
      </div>
    </figure>
  );
}
