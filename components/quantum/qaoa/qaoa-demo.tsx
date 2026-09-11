"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ChoiceList, Slider } from "@/components/controls";
import { adamAscent } from "@/lib/quantum/optimize";
import {
  complete,
  cube,
  cutDiagonal,
  edgeKey,
  type Graph,
  interp,
  linearRamp,
  MAX_NODES,
  maxCut,
  qaoaExpectation,
  qaoaProbabilities,
  random,
  ring,
} from "@/lib/quantum/maxcut";
import GraphEditor, { type Point } from "./graph-editor";
import Landscape from "./landscape";

type Init = "ramp" | "random" | "map" | "interp";
type Params = { gammas: number[]; betas: number[] };

const MAX_P = 5;
const FRAME_BUDGET_MS = 12;

function circle(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: 50 + 36 * Math.cos(a), y: 50 + 36 * Math.sin(a) };
  });
}

function cubePositions(): Point[] {
  // Two nested squares: an isometric-ish drawing of the 3-cube.
  const outer = [
    [18, 18],
    [82, 18],
    [18, 82],
    [82, 82],
  ];
  const inner = [
    [36, 36],
    [64, 36],
    [36, 64],
    [64, 64],
  ];
  return [...outer, ...inner].map(([x, y]) => ({ x, y }));
}

const PRESETS: { id: string; label: string; make: () => { graph: Graph; positions: Point[] } }[] = [
  { id: "ring", label: "Ring", make: () => ({ graph: ring(8), positions: circle(8) }) },
  { id: "cube", label: "Cube", make: () => ({ graph: cube(), positions: cubePositions() }) },
  { id: "complete", label: "Complete", make: () => ({ graph: complete(6), positions: circle(6) }) },
  {
    id: "random",
    label: "Random",
    make: () => ({ graph: random(9, 0.35, Math.random), positions: circle(9) }),
  },
];

const bitstring = (z: number, n: number) => Array.from({ length: n }, (_, i) => (z >> i) & 1).join("");

function initialParams(init: Init, p: number, trained: Record<number, number[]>, mapStart: [number, number]): Params {
  if (init === "map" && p === 1) return { gammas: [mapStart[0]], betas: [mapStart[1]] };
  if (init === "interp" && trained[p - 1]) {
    const prev = trained[p - 1];
    return { gammas: interp(prev.slice(0, p - 1)), betas: interp(prev.slice(p - 1)) };
  }
  if (init === "random") {
    return {
      gammas: Array.from({ length: p }, () => Math.random() * Math.PI),
      betas: Array.from({ length: p }, () => Math.random() * (Math.PI / 2)),
    };
  }
  return linearRamp(p);
}

export default function QaoaDemo() {
  const [graph, setGraph] = useState<Graph>(() => cube());
  const [positions, setPositions] = useState<Point[]>(() => cubePositions());
  const [p, setP] = useState(1);
  const [init, setInit] = useState<Init>("ramp");
  const [mapStart, setMapStart] = useState<[number, number]>([1.4, 0.15]);
  const [params, setParams] = useState<Params>(() => linearRamp(1));
  const [trained, setTrained] = useState<Record<number, number[]>>({});
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [path, setPath] = useState<[number, number][]>([]);
  const rafRef = useRef(0);

  const diag = useMemo(() => cutDiagonal(graph), [graph]);
  const best = useMemo(() => maxCut(diag), [diag]);
  const hasEdges = graph.edges.length > 0;

  const results = useMemo(() => {
    if (!hasEdges) return null;
    const probs = qaoaProbabilities(graph, diag, params.gammas, params.betas);
    let expectation = 0;
    let pOpt = 0;
    const optimal = new Set(best.states);
    probs.forEach((pr, z) => {
      expectation += pr * diag[z];
      if (optimal.has(z)) pOpt += pr;
    });
    const order = Array.from(probs.keys()).sort((a, b) => probs[b] - probs[a]);
    return {
      expectation,
      ratio: expectation / best.value,
      pOpt,
      top: order.slice(0, 8).map((z) => ({ z, prob: probs[z], cut: diag[z], optimal: optimal.has(z) })),
      partition: Array.from({ length: graph.n }, (_, i) => (order[0] >> i) & 1),
    };
  }, [graph, diag, best, params, hasEdges]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
  }, []);

  // Anything that changes the problem or the depth starts over from fresh parameters.
  const restart = useCallback(
    (next: { graph?: Graph; p?: number; init?: Init; trained?: Record<number, number[]>; mapStart?: [number, number] }) => {
      stop();
      const depth = next.p ?? p;
      const tr = next.trained ?? trained;
      let strategy = next.init ?? init;
      if ((strategy === "map" && depth !== 1) || (strategy === "interp" && !tr[depth - 1])) strategy = "ramp";
      const start = initialParams(strategy, depth, tr, next.mapStart ?? mapStart);
      setInit(strategy);
      setParams(start);
      setHistory([]);
      setPath(depth === 1 ? [[start.gammas[0], start.betas[0]]] : []);
    },
    [stop, p, trained, init, mapStart],
  );

  const changeGraph = (g: Graph, pos: Point[]) => {
    setGraph(g);
    setPositions(pos);
    setTrained({});
    restart({ graph: g, trained: {} });
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const optimize = () => {
    if (!hasEdges) return;
    const depth = p;
    const f = (x: number[]) => qaoaExpectation(graph, diag, x.slice(0, depth), x.slice(depth));
    const gen = adamAscent(f, [...params.gammas, ...params.betas]);
    const ratios: number[] = [f([...params.gammas, ...params.betas]) / best.value];
    const trail: [number, number][] = depth === 1 ? [[params.gammas[0], params.betas[0]]] : [];
    setRunning(true);
    setHistory(ratios);

    const tick = () => {
      const frameStart = performance.now();
      let last: ReturnType<typeof gen.next> | null = null;
      // Take as many optimizer steps as fit in the frame budget.
      do {
        last = gen.next();
        if (last.done || !last.value) break;
        ratios.push(last.value.value / best.value);
        if (depth === 1) trail.push([last.value.x[0], last.value.x[1]]);
        if (last.value.done) break;
      } while (performance.now() - frameStart < FRAME_BUDGET_MS);

      const step = last && !last.done ? last.value : null;
      if (step) {
        setParams({ gammas: step.x.slice(0, depth), betas: step.x.slice(depth) });
        setHistory([...ratios]);
        if (depth === 1) setPath([...trail]);
      }
      if (!step || step.done) {
        setRunning(false);
        if (step) setTrained((t) => ({ ...t, [depth]: step.x }));
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const initOptions: { value: Init; label: string; hint: string }[] = [
    { value: "ramp", label: "Linear ramp", hint: "γ grows and β shrinks layer by layer, like a discretized quantum anneal." },
    { value: "random", label: "Random", hint: "Uniformly random angles. Often lands in a poor local optimum at higher depth." },
    ...(p === 1
      ? [{ value: "map" as Init, label: "Point on the map", hint: "Click the landscape to choose where the optimizer starts." }]
      : [
          {
            value: "interp" as Init,
            label: "Interpolate from depth p − 1",
            hint: trained[p - 1]
              ? "INTERP: stretch the optimized angles from the previous depth. Usually the best start."
              : `Optimize at depth ${p - 1} first to unlock this start.`,
          },
        ]),
  ];

  return (
    <div className="space-y-14">
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <GraphEditor
            graph={graph}
            positions={positions}
            partition={results?.partition ?? null}
            canAddNode={graph.n < MAX_NODES}
            onAddNode={(pt) => changeGraph({ n: graph.n + 1, edges: graph.edges }, [...positions, pt])}
            onToggleEdge={(a, b) => {
              const key = edgeKey([a, b]);
              const exists = graph.edges.some((e) => edgeKey(e) === key);
              const edges = exists ? graph.edges.filter((e) => edgeKey(e) !== key) : [...graph.edges, [a, b] as [number, number]];
              changeGraph({ n: graph.n, edges }, positions);
            }}
            onRemoveNode={(i) => {
              const edges = graph.edges
                .filter(([a, b]) => a !== i && b !== i)
                .map(([a, b]) => [a > i ? a - 1 : a, b > i ? b - 1 : b] as [number, number]);
              changeGraph({ n: graph.n - 1, edges }, positions.filter((_, j) => j !== i));
            }}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((pr) => (
              <Button
                key={pr.id}
                onClick={() => {
                  const { graph: g, positions: pos } = pr.make();
                  changeGraph(g, pos);
                }}
              >
                {pr.label}
              </Button>
            ))}
          </div>
          <p className="mt-4 text-[15px] leading-[1.5] text-ink">
            {graph.n} nodes, {graph.edges.length} edges.{" "}
            {hasEdges ? `The best possible cut has ${best.value} edges.` : "Add some edges to define a problem."}
          </p>
          {results && (
            <p className="mt-1 text-[15px] leading-[1.5] text-ink-muted">
              Node colors show the most likely measurement: solid edges are cut, dashed ones are not.
            </p>
          )}
        </div>

        <div className="space-y-8 lg:col-span-7">
          <Landscape
            graph={graph}
            maxCutValue={best.value}
            path={p === 1 ? path : null}
            onPick={
              p === 1 && !running && hasEdges
                ? (g, b) => {
                    setMapStart([g, b]);
                    restart({ init: "map", mapStart: [g, b] });
                  }
                : null
            }
          />
          {p > 1 && (
            <p className="-mt-4 text-[14px] leading-[1.5] text-ink-muted">
              At depth {p} the landscape has {2 * p} dimensions, so only the depth-1 slice is drawn. Follow the
              optimizer in the convergence plot below.
            </p>
          )}

          <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <div className="space-y-6">
              <Slider
                label="Circuit depth (p)"
                value={p}
                min={1}
                max={MAX_P}
                onChange={(v) => {
                  setP(v);
                  restart({ p: v, init: v > p && trained[v - 1] ? "interp" : init });
                }}
              />
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={running ? stop : optimize} disabled={!hasEdges}>
                  {running ? "Stop" : "Optimize"}
                </Button>
                <Button onClick={() => restart({})} disabled={running}>
                  Reset angles
                </Button>
              </div>
            </div>
            <ChoiceList legend="Starting angles" value={init} options={initOptions} onChange={(v) => restart({ init: v })} />
          </div>
        </div>
      </div>

      {results && (
        <div className="grid gap-x-12 gap-y-10 border-t border-rule pt-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Stat label="Expected cut" value={`${results.expectation.toFixed(2)} of ${best.value}`} />
              <Stat label="Approximation ratio" value={results.ratio.toFixed(3)} />
              <Stat label="Chance of an optimal cut" value={`${(results.pOpt * 100).toFixed(1)}%`} />
              <Stat label="Optimizer steps" value={String(Math.max(0, history.length - 1))} />
            </dl>
            <ParamsTable params={params} />
          </div>
          <div className="space-y-10 lg:col-span-7">
            <Convergence history={history} />
            <Distribution top={results.top} n={graph.n} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[14px] text-ink-muted">{label}</dt>
      <dd className="font-serif text-[24px] tabular-nums">{value}</dd>
    </div>
  );
}

function ParamsTable({ params }: { params: Params }) {
  return (
    <table className="mt-8 w-full max-w-sm border-collapse text-[15px] tabular-nums">
      <caption className="mb-2 text-left text-[14px] text-ink-muted">Current angles (radians)</caption>
      <thead>
        <tr className="border-b border-rule text-[14px] text-ink-muted">
          <th scope="col" className="py-1.5 text-left font-normal">Layer</th>
          <th scope="col" className="py-1.5 text-right font-normal font-serif italic">γ</th>
          <th scope="col" className="py-1.5 text-right font-normal font-serif italic">β</th>
        </tr>
      </thead>
      <tbody>
        {params.gammas.map((g, k) => (
          <tr key={k} className="border-b border-rule/60">
            <td className="py-1.5 text-ink">{k + 1}</td>
            <td className="py-1.5 text-right text-ink">{g.toFixed(3)}</td>
            <td className="py-1.5 text-right text-ink">{params.betas[k].toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Convergence({ history }: { history: number[] }) {
  const W = 600;
  const H = 180;
  const pad = { l: 40, r: 10, t: 22, b: 24 };
  // Fit the axis to the run (the ratio can never exceed 1), so small gains stay visible.
  const min = history.length ? Math.min(...history) : 0.5;
  const lo = Math.max(0, Math.floor((min - (1 - min) * 0.25) * 20) / 20);
  const steps = Math.max(1, history.length - 1);
  const x = (i: number) => pad.l + (i / steps) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (1 - lo)) * (H - pad.t - pad.b);
  const d = history.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [lo, (lo + 1) / 2, 1];

  return (
    <figure>
      <figcaption className="mb-2 font-serif text-[20px] text-ink">Convergence</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Approximation ratio at each optimizer step">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(23,32,58,0.1)" />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={12} fill="#56607a">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={W - pad.r} y={y(1) - 6} textAnchor="end" fontSize={12} fill="#56607a">
          optimal cut
        </text>
        {history.length > 1 ? (
          <path d={d} fill="none" stroke="#2c6690" strokeWidth={2} />
        ) : (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={14} fill="#56607a">
            Press Optimize to train the circuit
          </text>
        )}
        <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize={12} fill="#56607a">
          step {history.length ? history.length - 1 : 0}
        </text>
        <text x={pad.l} y={H - 4} fontSize={12} fill="#56607a">
          approximation ratio
        </text>
      </svg>
    </figure>
  );
}

function Distribution({ top, n }: { top: { z: number; prob: number; cut: number; optimal: boolean }[]; n: number }) {
  const max = Math.max(...top.map((t) => t.prob), 1e-9);
  return (
    <figure>
      <figcaption className="mb-3 font-serif text-[20px] text-ink">Most likely measurements</figcaption>
      <ul className="space-y-1.5">
        {top.map((t) => (
          <li key={t.z} className="grid grid-cols-[auto_1fr_3.5rem_4.5rem] items-center gap-3 text-[14px]">
            <span className="font-mono tracking-[0.08em] text-ink">{bitstring(t.z, n)}</span>
            <span className="relative h-3.5 rounded-[2px] bg-ink/[0.05]">
              <span
                className="absolute inset-y-0 left-0 rounded-[2px]"
                style={{ width: `${(t.prob / max) * 100}%`, background: t.optimal ? "#2c6690" : "#aab3c2" }}
              />
            </span>
            <span className="text-right tabular-nums text-ink">{(t.prob * 100).toFixed(1)}%</span>
            <span className={`text-right tabular-nums ${t.optimal ? "text-accent-strong" : "text-ink-muted"}`}>
              cut {t.cut}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[14px] leading-[1.5] text-ink-muted">
        Each digit is one node, 0 or 1 for its side of the cut. Blue bars are optimal cuts. Flipping every bit gives the
        same cut, so solutions come in pairs.
      </p>
    </figure>
  );
}
