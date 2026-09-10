"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ChoiceList, Segmented, Slider } from "@/components/controls";
import { accuracy, createMlp, type Mlp, numClasses, trainMlp } from "@/lib/ml/classification";
import { generate, type LabeledPoint, type PresetId, presets } from "@/lib/ml/data";
import {
  classifierRegion,
  type ClassificationAlgo,
  type ClusteringAlgo,
  computeClassification,
  computeClustering,
  defaultParams,
  GRID_LIVE,
  type Params,
  type PlotData,
  type Task,
} from "./compute";
import { colorOf, drawPlot, toPx, toPy } from "./draw";

const MAX_POINTS = 400;
const CLASS_NAMES = ["A", "B", "C"];
const MLP_MAX_EPOCHS = 2500;
const MLP_EPOCHS_PER_FRAME = 3;
const MLP_TARGET_LOSS = 0.01;

const clusteringOptions: { value: ClusteringAlgo; label: string; hint: string }[] = [
  { value: "kmeans", label: "k-means", hint: "Splits the points into k groups around centres that move until they settle." },
  { value: "dbscan", label: "DBSCAN", hint: "Grows clusters out of dense regions and leaves isolated points as noise." },
  { value: "gmm", label: "Gaussian mixture", hint: "Fits k Gaussians with expectation-maximization. Membership is a probability." },
];

const classificationOptions: { value: ClassificationAlgo; label: string; hint: string }[] = [
  { value: "knn", label: "k-nearest neighbours", hint: "Each location takes the majority class of its k closest points." },
  { value: "svm", label: "Support vector machine", hint: "Finds a maximum-margin boundary using an RBF kernel." },
  { value: "mlp", label: "Neural network", hint: "A small multilayer perceptron trained with Adam as you watch." },
];

const legends: Record<ClusteringAlgo | ClassificationAlgo, string> = {
  kmeans: "Crosses mark the cluster centres. Shading shows which centre is closest.",
  dbscan: "Hollow points are noise. Shaded discs show the ε-neighbourhood of each core point.",
  gmm: "Ellipses show one and two standard deviations of each Gaussian. Stronger shading means higher membership probability.",
  knn: "Shading shows the predicted class. Paler areas are closer votes.",
  svm: "Rings mark the support vectors. Paler shading sits close to the decision boundary.",
  mlp: "Shading shows the network's prediction. Paler areas are less certain.",
};

export default function Playground() {
  const [task, setTask] = useState<Task>("clustering");
  const [clusterAlgo, setClusterAlgo] = useState<ClusteringAlgo>("kmeans");
  const [classAlgo, setClassAlgo] = useState<ClassificationAlgo>("svm");
  const [params, setParams] = useState<Params>(defaultParams);
  const [points, setPoints] = useState<LabeledPoint[]>(() => generate("blobs", 1));
  const [activeClass, setActiveClass] = useState(0);
  const [plot, setPlot] = useState<PlotData>({ colors: [], region: null, stats: [] });
  const [training, setTraining] = useState(false);
  const [converged, setConverged] = useState(false);

  const presetSeed = useRef(1);
  const netRef = useRef<Mlp | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ css: number; dpr: number } | null>(null);

  const isMlp = task === "classification" && classAlgo === "mlp";
  const activeAlgo = task === "clustering" ? clusterAlgo : classAlgo;
  const set = <K extends keyof Params>(key: K) => (v: Params[K]) => setParams((p) => ({ ...p, [key]: v }));

  // One-shot algorithms: recompute shortly after any change (debounced for slider drags).
  useEffect(() => {
    if (isMlp) return;
    const id = setTimeout(() => {
      setPlot(
        task === "clustering"
          ? computeClustering(clusterAlgo, points, params)
          : computeClassification(classAlgo as Exclude<ClassificationAlgo, "mlp">, points, params),
      );
    }, 40);
    return () => clearTimeout(id);
  }, [task, clusterAlgo, classAlgo, points, params, isMlp]);

  // Neural network: rebuild when the data or architecture changes, then train frame by frame.
  const classes = numClasses(points);
  const { mlpHidden, mlpLayers, mlpLr, seed } = params;
  useEffect(() => {
    if (!isMlp) return;
    if (classes < 2) {
      netRef.current = null;
      const id = setTimeout(() => {
        setTraining(false);
        setPlot({ colors: points.map((p) => p.label), region: null, stats: [{ label: "Status", value: "Needs points from two classes" }] });
      }, 0);
      return () => clearTimeout(id);
    }
    netRef.current = createMlp(Array(mlpLayers).fill(mlpHidden), classes, seed);
    const id = setTimeout(() => {
      setConverged(false);
      setTraining(true);
    }, 0);
    return () => clearTimeout(id);
  }, [isMlp, points, classes, mlpHidden, mlpLayers, seed]);

  useEffect(() => {
    if (!isMlp || !training) return;
    let frame = 0;
    let raf = 0;
    const colors = points.map((p) => p.label);

    const tick = () => {
      const net = netRef.current;
      if (!net) return;
      const loss = trainMlp(net, points, MLP_EPOCHS_PER_FRAME, mlpLr);
      const done = net.epoch >= MLP_MAX_EPOCHS || loss < MLP_TARGET_LOSS;
      // Re-rendering the boundary is the expensive part: coarse grid every other frame
      // while training, full resolution once training stops.
      if (frame++ % 2 === 0 || done) {
        setPlot({
          colors,
          region: classifierRegion(net, net.classes, done ? undefined : GRID_LIVE),
          stats: [
            { label: "Training accuracy", value: `${(accuracy(net, points) * 100).toFixed(1)}%` },
            { label: "Loss", value: loss.toFixed(4) },
            { label: "Epoch", value: String(net.epoch) },
          ],
        });
      }
      if (done) {
        setTraining(false);
        setConverged(true);
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isMlp, training, points, mlpLr]);

  const pause = () => {
    setTraining(false);
    const net = netRef.current;
    if (net) setPlot((p) => ({ ...p, region: classifierRegion(net, net.classes) }));
  };

  // Square plot that follows its container width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ css: Math.round(entry.contentRect.width), dpr: Math.min(window.devicePixelRatio || 1, 2) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    canvas.width = size.css * size.dpr;
    canvas.height = size.css * size.dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    drawPlot(ctx, size.css, points, plot);
  }, [plot, points, size]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const s = rect.width;

    // Clicking on an existing point removes it; anywhere else adds one.
    const hit = points.findIndex((p) => Math.hypot(toPx(p.x, s) - px, toPy(p.y, s) - py) <= 9);
    if (hit >= 0) {
      setPoints((pts) => pts.filter((_, i) => i !== hit));
      return;
    }
    if (points.length >= MAX_POINTS) return;
    const x = (px / s) * 2 - 1;
    const y = 1 - (py / s) * 2;
    setPoints((pts) => [...pts, { x, y, label: activeClass }]);
  };

  const loadPreset = (id: PresetId) => {
    presetSeed.current += 1;
    setPoints(generate(id, presetSeed.current));
  };

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <div ref={wrapRef} className="aspect-square w-full overflow-hidden rounded-[3px] border border-rule">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className="h-full w-full cursor-crosshair"
            role="img"
            aria-label={`Scatter plot with ${points.length} points. ${plot.stats.map((s) => `${s.label}: ${s.value}`).join(". ")}.`}
          />
        </div>
        <p className="mt-3 text-[15px] leading-[1.5] text-ink-muted">
          Click to add a point, click a point to remove it. {legends[activeAlgo]}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <div>
            <dt className="text-[14px] text-ink-muted">Points</dt>
            <dd className="font-serif text-[24px] tabular-nums">{points.length}</dd>
          </div>
          {plot.stats.map((s) => (
            <div key={s.label}>
              <dt className="text-[14px] text-ink-muted">{s.label}</dt>
              <dd className="font-serif text-[24px] tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-8 lg:col-span-5">
        <Segmented<Task>
          legend="Task"
          value={task}
          onChange={setTask}
          options={[
            { value: "clustering", label: "Clustering" },
            { value: "classification", label: "Classification" },
          ]}
        />

        {task === "clustering" ? (
          <ChoiceList legend="Algorithm" value={clusterAlgo} options={clusteringOptions} onChange={setClusterAlgo} />
        ) : (
          <ChoiceList legend="Algorithm" value={classAlgo} options={classificationOptions} onChange={setClassAlgo} />
        )}

        <div className="space-y-5">
          {activeAlgo === "kmeans" && <Slider label="Clusters (k)" value={params.kmeansK} min={1} max={8} onChange={set("kmeansK")} />}
          {activeAlgo === "dbscan" && (
            <>
              <Slider label="Radius (ε)" value={params.dbscanEps} min={0.03} max={0.4} step={0.01} format={(v) => v.toFixed(2)} onChange={set("dbscanEps")} />
              <Slider label="Minimum points" value={params.dbscanMinPts} min={2} max={15} onChange={set("dbscanMinPts")} />
            </>
          )}
          {activeAlgo === "gmm" && <Slider label="Components" value={params.gmmK} min={1} max={8} onChange={set("gmmK")} />}
          {activeAlgo === "knn" && <Slider label="Neighbours (k)" value={params.knnK} min={1} max={25} onChange={set("knnK")} />}
          {activeAlgo === "svm" && (
            <>
              <Slider label="Regularization (C)" value={params.svmC} min={0.1} max={100} log onChange={set("svmC")} />
              <Slider label="Kernel sharpness (γ)" value={params.svmGamma} min={0.5} max={100} log onChange={set("svmGamma")} />
            </>
          )}
          {activeAlgo === "mlp" && (
            <>
              <Slider label="Hidden layers" value={params.mlpLayers} min={1} max={3} onChange={set("mlpLayers")} />
              <Slider label="Units per layer" value={params.mlpHidden} min={2} max={32} onChange={set("mlpHidden")} />
              <Slider label="Learning rate" value={params.mlpLr} min={0.001} max={0.1} log onChange={set("mlpLr")} />
            </>
          )}

          {(activeAlgo === "kmeans" || activeAlgo === "gmm") && (
            <Button onClick={() => set("seed")(params.seed + 1)}>Try another starting point</Button>
          )}
          {activeAlgo === "mlp" && (
            <div className="flex flex-wrap items-center gap-3">
              {converged ? (
                <Button variant="primary" onClick={() => set("seed")(params.seed + 1)}>
                  Train again from new weights
                </Button>
              ) : (
                <>
                  <Button variant="primary" onClick={training ? pause : () => setTraining(true)}>
                    {training ? "Pause training" : "Resume training"}
                  </Button>
                  <Button onClick={() => set("seed")(params.seed + 1)}>Reset weights</Button>
                </>
              )}
              {converged && <span className="text-[14px] text-ink-muted">Training finished</span>}
            </div>
          )}
        </div>

        <div className="space-y-4 border-t border-rule pt-6">
          <div>
            <p className="mb-2 text-[14px] text-ink-muted">Load a dataset</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button key={p.id} onClick={() => loadPreset(p.id)}>
                  {p.label}
                </Button>
              ))}
              <Button onClick={() => setPoints([])}>Clear points</Button>
            </div>
          </div>

          {task === "classification" && (
            <fieldset>
              <legend className="mb-2 text-[14px] text-ink-muted">Class for new points</legend>
              <div className="flex gap-2">
                {CLASS_NAMES.map((name, i) => (
                  <label
                    key={name}
                    className="flex cursor-pointer items-center gap-2 rounded-[3px] border border-ink/25 px-3 py-1.5 text-[15px] has-checked:border-ink has-checked:bg-ink/[0.06] has-focus-visible:outline-2 has-focus-visible:outline-accent"
                  >
                    <input
                      type="radio"
                      name="active-class"
                      checked={activeClass === i}
                      onChange={() => setActiveClass(i)}
                      className="sr-only"
                    />
                    <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: colorOf(i) }} />
                    Class {name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </div>
    </div>
  );
}
