// YOLO11 detection helpers: letterbox preprocessing, output decoding and NMS.
// Pure functions with no ONNX Runtime dependency, so they can be unit-tested.

export const INPUT_SIZE = 640;
const PAD_VALUE = 114; // gray padding, same as Ultralytics

// COCO class names in the order YOLO models trained on COCO output them.
export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
  "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
  "scissors", "teddy bear", "hair drier", "toothbrush",
];

export interface Letterbox {
  /** Scale applied to the source image to fit the model input. */
  scale: number;
  padX: number;
  padY: number;
}

export interface Detection {
  classId: number;
  score: number;
  /** Box in source-image pixels: x1, y1, x2, y2. */
  box: [number, number, number, number];
}

/** Letterbox geometry for a source of the given size. */
export function letterbox(srcW: number, srcH: number, size = INPUT_SIZE): Letterbox {
  const scale = Math.min(size / srcW, size / srcH);
  return { scale, padX: (size - srcW * scale) / 2, padY: (size - srcH * scale) / 2 };
}

/** Converts RGBA pixels of a letterboxed square frame to a normalized CHW float tensor. */
export function rgbaToChw(rgba: Uint8ClampedArray, size = INPUT_SIZE, out?: Float32Array): Float32Array {
  const plane = size * size;
  const data = out ?? new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = rgba[i * 4] / 255;
    data[plane + i] = rgba[i * 4 + 1] / 255;
    data[2 * plane + i] = rgba[i * 4 + 2] / 255;
  }
  return data;
}

/** Draws a source into a letterboxed square canvas and returns the input tensor data. */
export function preprocess(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  out?: Float32Array,
): { data: Float32Array; lb: Letterbox } {
  const lb = letterbox(srcW, srcH);
  ctx.fillStyle = `rgb(${PAD_VALUE},${PAD_VALUE},${PAD_VALUE})`;
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(source, lb.padX, lb.padY, srcW * lb.scale, srcH * lb.scale);
  const { data: rgba } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  return { data: rgbaToChw(rgba, INPUT_SIZE, out), lb };
}

function iou(a: Detection["box"], b: Detection["box"]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-9);
}

/** Greedy class-aware non-maximum suppression. */
export function nms(dets: Detection[], iouThreshold: number, maxDetections = 100): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.length >= maxDetections) break;
    if (kept.every((k) => k.classId !== d.classId || iou(k.box, d.box) <= iouThreshold)) kept.push(d);
  }
  return kept;
}

/**
 * Decodes a raw YOLO11 detection output of shape [1, 4 + C, N] (no objectness score):
 * rows 0-3 are cx, cy, w, h in input pixels, rows 4.. are per-class scores.
 */
export function decode(
  output: Float32Array,
  dims: readonly number[],
  lb: Letterbox,
  srcW: number,
  srcH: number,
  confThreshold: number,
  iouThreshold: number,
): Detection[] {
  const channels = dims[1];
  const n = dims[2];
  const classes = channels - 4;
  const candidates: Detection[] = [];

  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestScore = output[4 * n + i];
    for (let c = 1; c < classes; c++) {
      const s = output[(4 + c) * n + i];
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (bestScore < confThreshold) continue;

    const cx = output[i];
    const cy = output[n + i];
    const w = output[2 * n + i];
    const h = output[3 * n + i];
    // Undo the letterbox to map back to source pixels, then clip.
    const x1 = Math.max(0, (cx - w / 2 - lb.padX) / lb.scale);
    const y1 = Math.max(0, (cy - h / 2 - lb.padY) / lb.scale);
    const x2 = Math.min(srcW, (cx + w / 2 - lb.padX) / lb.scale);
    const y2 = Math.min(srcH, (cy + h / 2 - lb.padY) / lb.scale);
    if (x2 > x1 && y2 > y1) candidates.push({ classId: best, score: bestScore, box: [x1, y1, x2, y2] });
  }
  return nms(candidates, iouThreshold);
}
