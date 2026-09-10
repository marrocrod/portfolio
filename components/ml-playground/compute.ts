// Runs the selected algorithm and packages everything the plot needs to draw.

import { accuracy, argmax, type Classifier, knn, numClasses, svm } from "@/lib/ml/classification";
import { dbscan, type Gaussian2D, gmm, kmeans } from "@/lib/ml/clustering";
import type { LabeledPoint, Vec2 } from "@/lib/ml/data";

export type Task = "clustering" | "classification";
export type ClusteringAlgo = "kmeans" | "dbscan" | "gmm";
export type ClassificationAlgo = "knn" | "svm" | "mlp";

export interface Params {
  kmeansK: number;
  dbscanEps: number;
  dbscanMinPts: number;
  gmmK: number;
  knnK: number;
  svmC: number;
  svmGamma: number;
  mlpHidden: number;
  mlpLayers: number;
  mlpLr: number;
  seed: number;
}

export const defaultParams: Params = {
  kmeansK: 3,
  dbscanEps: 0.14,
  dbscanMinPts: 5,
  gmmK: 3,
  knnK: 7,
  svmC: 5,
  svmGamma: 8,
  mlpHidden: 12,
  mlpLayers: 2,
  mlpLr: 0.01,
  seed: 1,
};

/** Resolution of the background region grid (G x G cells over [-1, 1]^2). */
export const GRID = 140;
/** Coarser grid used while the neural network is training, to keep frames fast. */
export const GRID_LIVE = 70;

export interface Region {
  size: number;
  labels: Int16Array;
  /** Confidence rescaled to [0, 1], where 0 means "as unsure as a uniform guess". */
  strength: Float32Array;
}

export interface Stat {
  label: string;
  value: string;
}

export interface PlotData {
  /** Color index per point; -1 draws the point as noise. */
  colors: number[];
  region: Region | null;
  centres?: Vec2[];
  gaussians?: Gaussian2D[];
  /** Points to ring (SVM support vectors). */
  highlighted?: number[];
  /** Radius circles drawn around these points (DBSCAN core points). */
  radius?: { r: number; points: number[] };
  stats: Stat[];
}

export function regionFrom(
  predict: (x: number, y: number) => { label: number; confidence: number },
  classes: number,
  size = GRID,
): Region {
  const labels = new Int16Array(size * size);
  const strength = new Float32Array(size * size);
  const floor = 1 / Math.max(classes, 2);
  const centre = (i: number) => -1 + (2 * (i + 0.5)) / size;
  for (let r = 0; r < size; r++) {
    // Row 0 is the top of the plot, so y decreases with r.
    const y = -centre(r);
    for (let c = 0; c < size; c++) {
      const { label, confidence } = predict(centre(c), y);
      labels[r * size + c] = label;
      strength[r * size + c] = Math.max(0, Math.min(1, (confidence - floor) / (1 - floor)));
    }
  }
  return { size, labels, strength };
}

export function classifierRegion(model: Classifier, classes: number, size = GRID): Region {
  return regionFrom(
    (x, y) => {
      const p = model.predict(x, y);
      const label = argmax(p);
      return { label, confidence: p[label] };
    },
    classes,
    size,
  );
}

export function classifierStats(model: Classifier, points: LabeledPoint[]): Stat {
  return { label: "Training accuracy", value: `${(accuracy(model, points) * 100).toFixed(1)}%` };
}

export function computeClustering(algo: ClusteringAlgo, points: LabeledPoint[], p: Params): PlotData {
  if (points.length === 0) return { colors: [], region: null, stats: [] };

  switch (algo) {
    case "kmeans": {
      const res = kmeans(points, p.kmeansK, p.seed);
      return {
        colors: res.assignments,
        centres: res.centres,
        region: regionFrom((x, y) => ({ label: res.predict(x, y), confidence: 1 }), 2),
        stats: [
          { label: "Clusters", value: String(res.centres.length) },
          { label: "Inertia", value: res.inertia.toFixed(2) },
          { label: "Iterations", value: String(res.iterations) },
        ],
      };
    }
    case "dbscan": {
      const res = dbscan(points, p.dbscanEps, p.dbscanMinPts);
      return {
        colors: res.assignments,
        region: null,
        radius: { r: p.dbscanEps, points: res.core.flatMap((c, i) => (c ? [i] : [])) },
        stats: [
          { label: "Clusters found", value: String(res.clusters) },
          { label: "Noise points", value: String(res.noise) },
          { label: "Core points", value: String(res.core.filter(Boolean).length) },
        ],
      };
    }
    case "gmm": {
      const res = gmm(points, p.gmmK, p.seed);
      return {
        colors: res.assignments,
        gaussians: res.components,
        region: regionFrom(res.predict, res.components.length),
        stats: [
          { label: "Components", value: String(res.components.length) },
          { label: "Log-likelihood", value: res.logLikelihood.toFixed(1) },
          { label: "Iterations", value: String(res.iterations) },
        ],
      };
    }
  }
}

/** k-NN and SVM are trained in one shot. The MLP is trained incrementally by the component. */
export function computeClassification(algo: Exclude<ClassificationAlgo, "mlp">, points: LabeledPoint[], p: Params): PlotData {
  const colors = points.map((pt) => pt.label);
  const classes = numClasses(points);
  if (points.length === 0 || classes < 2) {
    return { colors, region: null, stats: [{ label: "Status", value: "Needs points from two classes" }] };
  }

  if (algo === "knn") {
    const model = knn(points, p.knnK);
    return { colors, region: classifierRegion(model, classes), stats: [classifierStats(model, points)] };
  }

  const model = svm(points, p.svmC, p.svmGamma, p.seed);
  return {
    colors,
    region: classifierRegion(model, classes),
    highlighted: model.supportVectors,
    stats: [classifierStats(model, points), { label: "Support vectors", value: String(model.supportVectors.length) }],
  };
}
