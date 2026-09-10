// Browser-only wrapper around ONNX Runtime Web for the YOLO model.
// The runtime is imported lazily so it only loads on pages that use it. Its .wasm
// file is emitted and served by the Next.js bundler, so no manual copying is needed.

import type * as Ort from "onnxruntime-web/webgpu";
import { decode, type Detection, INPUT_SIZE, preprocess } from "./yolo";

export type Backend = "webgpu" | "wasm";

export const MODEL_URL = "/models/yolo11n.onnx";

let ortPromise: Promise<typeof Ort> | null = null;

function loadOrt(): Promise<typeof Ort> {
  ortPromise ??= import("onnxruntime-web/webgpu");
  return ortPromise;
}

/** True when the browser exposes a usable WebGPU adapter. */
export async function webgpuAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export interface Detector {
  backend: Backend;
  /** Runs detection on a source and reports the time spent in the model itself. */
  detect: (
    source: CanvasImageSource,
    width: number,
    height: number,
    conf: number,
    iou: number,
  ) => Promise<{ detections: Detection[]; inferenceMs: number }>;
  release: () => Promise<void>;
}

export async function createDetector(backend: Backend): Promise<Detector> {
  const ort = await loadOrt();
  const session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: [backend],
    graphOptimizationLevel: "all",
  });

  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context is not available");
  const buffer = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  const run = async (data: Float32Array) => {
    const input = new ort.Tensor("float32", data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const t0 = performance.now();
    const results = await session.run({ [inputName]: input });
    const output = results[outputName];
    const values = (await output.getData()) as Float32Array;
    const inferenceMs = performance.now() - t0;
    const dims = output.dims;
    output.dispose();
    return { values, dims, inferenceMs };
  };

  // Warm-up run: the first WebGPU call compiles shaders and is much slower than the rest.
  await run(buffer);

  return {
    backend,
    async detect(source, width, height, conf, iou) {
      const { data, lb } = preprocess(ctx, source, width, height, buffer);
      const { values, dims, inferenceMs } = await run(data);
      return { detections: decode(values, dims, lb, width, height, conf, iou), inferenceMs };
    },
    release: () => session.release(),
  };
}
