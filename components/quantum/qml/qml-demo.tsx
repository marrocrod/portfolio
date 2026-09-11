"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LineChart from "@/components/charts/line-chart";
import { Button, Segmented, Slider } from "@/components/controls";
import { classifierRegion, GRID_LIVE, regionFrom, type Region } from "@/components/ml-playground/compute";
import { drawPlot } from "@/components/ml-playground/draw";
import { accuracy as classicalAccuracy, createMlp, type Mlp, numClasses, trainMlp } from "@/lib/ml/classification";
import { generate, type LabeledPoint, type PresetId, presets, rng } from "@/lib/ml/data";
import {
  accuracy as quantumAccuracy,
  type Adam,
  adamStep,
  createAdam,
  createModel,
  gradient,
  loss as quantumLoss,
  PARAMS_PER_GATE_GROUP,
  predict,
  type ReuploadModel,
} from "@/lib/quantum/reupload";

type Side = "quantum" | "classical";

const TRAIN_FRACTION = 0.7;
const BATCH = 24;
const STEPS_PER_FRAME = 2;
const MAX_STEPS = 600;
const LEARNING_RATE = 0.05;

const COLORS: Record<Side, string> = { quantum: "#0072B2", classical: "#E69F00" };

/** Deterministic train/test split, stratified by nothing more than a shuffle. */
function split(points: LabeledPoint[], seed: number) {
  const rand = rng(seed);
  const shuffled = points
    .map((p) => [rand(), p] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);
  const cut = Math.round(shuffled.length * TRAIN_FRACTION);
  return { train: shuffled.slice(0, cut), test: shuffled.slice(cut) };
}

/** Hidden layer size whose parameter count is closest to the quantum model's. */
function matchedHidden(target: number, classes: number): number {
  let best = 2;
  let bestGap = Infinity;
  for (let h = 2; h <= 40; h++) {
    const count = 3 * h + (h + 1) * classes; // 2->h weights and biases, then h->classes
    const gap = Math.abs(count - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = h;
    }
  }
  return best;
}

function classicalParamCount(hidden: number, classes: number) {
  return 3 * hidden + (hidden + 1) * classes;
}

export default function QmlDemo() {
  const [preset, setPreset] = useState<PresetId>("circles");
  const [seed, setSeed] = useState(3);
  const [qubits, setQubits] = useState(1);
  const [layers, setLayers] = useState(4);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [history, setHistory] = useState<{ q: number[]; c: number[] }>({ q: [], c: [] });
  const [regions, setRegions] = useState<{ quantum: Region | null; classical: Region | null }>({
    quantum: null,
    classical: null,
  });
  const [scores, setScores] = useState<{ quantum: [number, number]; classical: [number, number] } | null>(null);

  const points = useMemo(() => generate(preset, seed), [preset, seed]);
  const classes = useMemo(() => numClasses(points), [points]);
  const { train, test } = useMemo(() => split(points, seed + 1), [points, seed]);

  const quantumParams = qubits * layers * PARAMS_PER_GATE_GROUP;
  const hidden = useMemo(() => matchedHidden(quantumParams, classes), [quantumParams, classes]);

  const modelRef = useRef<{ q: ReuploadModel; adam: Adam; c: Mlp } | null>(null);
  const rafRef = useRef(0);
  const randRef = useRef(rng(1));

  const evaluate = useCallback(
    (final: boolean) => {
      const m = modelRef.current;
      if (!m) return;
      const size = final ? undefined : GRID_LIVE;
      setRegions({
        quantum: regionFrom(
          (x, y) => {
            const p = predict(m.q, x, y);
            const label = p.indexOf(Math.max(...p));
            return { label, confidence: p[label] };
          },
          classes,
          size,
        ),
        classical: classifierRegion(m.c, classes, size),
      });
      setScores({
        quantum: [quantumAccuracy(m.q, train), quantumAccuracy(m.q, test)],
        classical: [classicalAccuracy(m.c, train), classicalAccuracy(m.c, test)],
      });
    },
    [classes, train, test],
  );

  // Rebuild both models whenever the data or the architecture changes, then show their
  // untrained boundaries. Deferred to the next frame so no state is set during the effect.
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    modelRef.current = {
      q: createModel(qubits, layers, classes, seed),
      adam: createAdam(qubits * layers * PARAMS_PER_GATE_GROUP),
      c: createMlp([hidden], classes, seed),
    };
    randRef.current = rng(seed + 7);
    const id = requestAnimationFrame(() => {
      setRunning(false);
      setStep(0);
      setHistory({ q: [], c: [] });
      evaluate(true);
    });
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(rafRef.current);
    };
  }, [qubits, layers, classes, seed, hidden, evaluate]);

  const trainLoop = useCallback(() => {
    const m = modelRef.current;
    if (!m) return;
    let count = step;
    const qHistory = [...history.q];
    const cHistory = [...history.c];

    const tick = () => {
      for (let k = 0; k < STEPS_PER_FRAME; k++) {
        const batch = Array.from({ length: BATCH }, () => train[Math.floor(randRef.current() * train.length)]);
        adamStep(m.q, gradient(m.q, batch), m.adam, LEARNING_RATE);
        // The classical net trains full batch, which is cheap at this size.
        const cLoss = trainMlp(m.c, train, 4, 0.03);
        count++;
        qHistory.push(quantumLoss(m.q, train));
        cHistory.push(cLoss);
      }
      setStep(count);
      setHistory({ q: [...qHistory], c: [...cHistory] });
      const done = count >= MAX_STEPS;
      evaluate(done);
      if (done) {
        setRunning(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    setRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [step, history, train, evaluate]);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    evaluate(true);
  };

  return (
    <div className="space-y-12">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <ModelPanel
          title="Quantum classifier"
          subtitle={`${qubits} qubit${qubits > 1 ? "s" : ""}, ${layers} layers, ${quantumParams} parameters`}
          color={COLORS.quantum}
          points={points}
          test={test}
          region={regions.quantum}
          scores={scores?.quantum}
        />
        <ModelPanel
          title="Classical neural network"
          subtitle={`1 hidden layer of ${hidden} units, ${classicalParamCount(hidden, classes)} parameters`}
          color={COLORS.classical}
          points={points}
          test={test}
          region={regions.classical}
          scores={scores?.classical}
        />
      </div>

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="space-y-7 lg:col-span-5">
          <Segmented<PresetId>
            legend="Dataset"
            value={preset}
            onChange={(p) => setPreset(p)}
            options={presets.map((p) => ({ value: p.id, label: p.label }))}
          />
          <div className="space-y-5">
            <Slider label="Qubits" value={qubits} min={1} max={3} onChange={setQubits} />
            <Slider label="Layers (data re-uploads)" value={layers} min={1} max={6} onChange={setLayers} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={running ? stop : trainLoop} disabled={step >= MAX_STEPS && !running}>
              {running ? "Pause" : step > 0 ? "Continue training" : "Train both"}
            </Button>
            <Button onClick={() => setSeed(seed + 1)} disabled={running}>
              New data and weights
            </Button>
          </div>
          <p className="text-[15px] leading-[1.55] text-ink-muted">
            {step === 0
              ? "Both models start from random weights. Training runs on the same 70% of the points; the circled points are the held-out 30%."
              : `Step ${step} of ${MAX_STEPS}. Each step is one Adam update from a batch of ${BATCH} points for the circuit, and four full-batch epochs for the network.`}
          </p>
        </div>

        <div className="lg:col-span-7">
          <LineChart
            ariaLabel="Training loss of both models"
            series={[
              {
                name: "Quantum",
                color: COLORS.quantum,
                points: history.q.map((v, i) => [i + 1, v] as [number, number]),
              },
              {
                name: "Classical",
                color: COLORS.classical,
                points: history.c.map((v, i) => [i + 1, v] as [number, number]),
              },
            ]}
            xLabel="Training step"
            yLabel="Cross-entropy loss"
            xDomain={[1, Math.max(20, history.q.length)]}
            yDomain={[0, Math.max(0.2, ...history.q.slice(0, 3), ...history.c.slice(0, 3))]}
            formatX={(x) => x.toFixed(0)}
            formatY={(y) => y.toFixed(2)}
            height={260}
          />
        </div>
      </div>

      <section aria-labelledby="how" className="grid gap-x-12 gap-y-6 border-t border-rule pt-10 md:grid-cols-3">
        <h2 id="how" className="font-serif text-[28px] font-medium leading-[1.15] md:col-span-3">
          How the circuit classifies
        </h2>
        <p className="font-serif text-[17px] leading-[1.6] text-ink-muted">
          <span className="text-ink">Re-upload the data.</span> Each layer rotates every qubit by angles that depend on
          the point being classified: RY(a₁x + b₁), then RZ(a₂y + b₂), then a plain RY(b₃). Feeding the input again at
          every layer is what makes the model non-linear, the same way stacked layers do classically.
        </p>
        <p className="font-serif text-[17px] leading-[1.6] text-ink-muted">
          <span className="text-ink">Read one qubit.</span> After the last layer, the Bloch vector of qubit 0 is
          compared with one target direction per class: the poles for two classes, three directions 120° apart for
          three. The closest direction wins.
        </p>
        <p className="font-serif text-[17px] leading-[1.6] text-ink-muted">
          <span className="text-ink">Train by shifting parameters.</span> Gradients come from the parameter-shift rule,
          evaluating the same circuit at angles shifted by ±π/2, which is how a real device would do it. Here the
          circuit is simulated exactly, so there is no shot noise.
        </p>
      </section>

      <p className="max-w-3xl font-serif text-[17px] leading-[1.6] text-ink-muted">
        <span className="text-ink">Worth noticing:</span> the two boundaries have a different character even when both
        models score the same. The circuit is built from rotations, so what it can draw is a sum of waves in x and y:
        smooth, curved, and periodic if you look far enough out. The network stacks tanh units, so its boundary is
        closer to a polygon with rounded corners. Neither is better in general, but on circular data the circuit gets
        there with fewer parameters, and on data with straight edges the network does.
      </p>

      <p className="max-w-3xl text-[14px] leading-[1.6] text-ink-muted">
        A fair reading: these datasets are two-dimensional and small, where a classical network of the same size is
        expected to do at least as well. The point of the comparison is that a handful of qubits can learn the same
        boundaries at all, not that they learn them better. Whether quantum models help on real data is still open, and
        it will not be settled by toy problems that fit on a laptop.
      </p>
    </div>
  );
}

function ModelPanel({
  title,
  subtitle,
  color,
  points,
  test,
  region,
  scores,
}: {
  title: string;
  subtitle: string;
  color: string;
  points: LabeledPoint[];
  test: LabeledPoint[];
  region: Region | null;
  scores?: [number, number];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ css: number; dpr: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ css: Math.round(entry.contentRect.width), dpr: Math.min(window.devicePixelRatio || 1, 2) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const testSet = useMemo(() => new Set(test), [test]);
  const highlighted = useMemo(() => points.flatMap((p, i) => (testSet.has(p) ? [i] : [])), [points, testSet]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    canvas.width = size.css * size.dpr;
    canvas.height = size.css * size.dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    drawPlot(ctx, size.css, points, {
      colors: points.map((p) => p.label),
      region,
      highlighted,
      stats: [],
    });
  }, [points, region, highlighted, size]);

  return (
    <figure>
      <figcaption className="mb-3">
        <h2 className="flex items-center gap-2.5 font-serif text-[24px] font-medium">
          <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: color }} />
          {title}
        </h2>
        <p className="mt-1 text-[15px] text-ink-muted">{subtitle}</p>
      </figcaption>
      <div ref={wrapRef} className="aspect-square w-full overflow-hidden rounded-[3px] border border-rule">
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          role="img"
          aria-label={`${title} decision boundary${scores ? `, test accuracy ${(scores[1] * 100).toFixed(0)}%` : ""}`}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6">
        <div>
          <dt className="text-[14px] text-ink-muted">Training accuracy</dt>
          <dd className="font-serif text-[24px] tabular-nums">{scores ? `${(scores[0] * 100).toFixed(0)}%` : "–"}</dd>
        </div>
        <div>
          <dt className="text-[14px] text-ink-muted">Held-out accuracy</dt>
          <dd className="font-serif text-[24px] tabular-nums" style={{ color }}>
            {scores ? `${(scores[1] * 100).toFixed(0)}%` : "–"}
          </dd>
        </div>
      </dl>
    </figure>
  );
}
