"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Segmented, Slider } from "@/components/controls";
import { colorOf } from "@/lib/palette";
import { type Backend, createDetector, type Detector as YoloDetector, webgpuAvailable } from "@/lib/vision/session";
import { COCO_CLASSES, type Detection } from "@/lib/vision/yolo";

type Source = { kind: "none" } | { kind: "image"; bitmap: ImageBitmap } | { kind: "camera" };
type Status = { kind: "loading"; message: string } | { kind: "ready" } | { kind: "error"; message: string };

const TIMING_WINDOW = 20;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function drawFrame(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  w: number,
  h: number,
  dets: Detection[],
  colorFor: (classId: number) => string,
) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(source, 0, 0, w, h);

  // Stroke and label sizes follow the source resolution so they look the same on screen.
  const unit = Math.max(w, h) / 640;
  const lw = Math.max(2, 2.5 * unit);
  const fontSize = Math.max(12, 14 * unit);
  ctx.font = `500 ${fontSize}px "Instrument Sans Variable", system-ui, sans-serif`;
  ctx.textBaseline = "top";

  for (const d of dets) {
    const [x1, y1, x2, y2] = d.box;
    const color = colorFor(d.classId);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    const label = `${COCO_CLASSES[d.classId] ?? d.classId} ${Math.round(d.score * 100)}%`;
    const padX = 5 * unit;
    const padY = 3 * unit;
    const tw = ctx.measureText(label).width + padX * 2;
    const th = fontSize + padY * 2;
    // Put the label above the box, or inside it when there's no room at the top.
    const ly = y1 - th >= 0 ? y1 - th : y1;
    ctx.fillStyle = color;
    ctx.fillRect(x1 - lw / 2, ly, tw, th);
    ctx.fillStyle = color === "#F0E442" ? "#17203a" : "#ffffff"; // dark text on the yellow swatch
    ctx.fillText(label, x1 - lw / 2 + padX, ly + padY);
  }
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Camera access is blocked. Allow it in your browser's site settings and try again.";
  if (name === "NotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is in use by another application. Close it and try again.";
  return "The camera could not be started. Try uploading a photo instead.";
}

export default function ObjectDetector() {
  const [gpuOk, setGpuOk] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<Backend | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading", message: "Checking your browser" });
  const [source, setSource] = useState<Source>({ kind: "none" });
  const [conf, setConf] = useState(0.35);
  const [iou, setIou] = useState(0.45);
  const [detections, setDetections] = useState<(Detection & { color: string })[]>([]);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const detectorRef = useRef<YoloDetector | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timings = useRef<number[]>([]);
  const thresholds = useRef({ conf, iou });
  // Colors are handed out in order of first appearance so that classes seen together
  // get different colors, and each class keeps its color while the camera runs.
  const classColors = useRef(new Map<number, string>());
  const colorFor = useCallback((classId: number) => {
    const map = classColors.current;
    if (!map.has(classId)) map.set(classId, colorOf(map.size));
    return map.get(classId)!;
  }, []);

  useEffect(() => {
    thresholds.current = { conf, iou };
  }, [conf, iou]);

  const recordTiming = useCallback((ms: number) => {
    timings.current = [...timings.current.slice(-(TIMING_WINDOW - 1)), ms];
    setInferenceMs(median(timings.current));
  }, []);

  // Pick WebGPU when the browser supports it.
  useEffect(() => {
    let cancelled = false;
    webgpuAvailable().then((ok) => {
      if (cancelled) return;
      setGpuOk(ok);
      setBackend(ok ? "webgpu" : "wasm");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)create the inference session whenever the backend changes.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    const previous = detectorRef.current;
    detectorRef.current = null;
    timings.current = [];
    const start = setTimeout(() => {
      setInferenceMs(null);
      setStatus({ kind: "loading", message: backend === "webgpu" ? "Loading the model on WebGPU" : "Loading the model on WebAssembly" });
    }, 0);

    (async () => {
      await previous?.release().catch(() => undefined);
      try {
        const detector = await createDetector(backend);
        if (cancelled) {
          await detector.release();
          return;
        }
        detectorRef.current = detector;
        setStatus({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setStatus({
          kind: "error",
          message:
            backend === "webgpu"
              ? "The model could not start on WebGPU. Switch to WebAssembly to keep going."
              : "The model could not be loaded. Check that public/models/yolo11n.onnx exists and reload the page.",
        });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [backend]);

  // Release the session when leaving the page.
  useEffect(() => () => void detectorRef.current?.release().catch(() => undefined), []);

  // Still images: run once whenever the image, thresholds or session change.
  useEffect(() => {
    if (source.kind !== "image" || status.kind !== "ready") return;
    const detector = detectorRef.current;
    const canvas = canvasRef.current;
    if (!detector || !canvas) return;
    let cancelled = false;
    const { bitmap } = source;
    detector.detect(bitmap, bitmap.width, bitmap.height, conf, iou).then(({ detections: dets, inferenceMs: ms }) => {
      if (cancelled) return;
      drawFrame(canvas, bitmap, bitmap.width, bitmap.height, dets, colorFor);
      setDetections(dets.map((d) => ({ ...d, color: colorFor(d.classId) })));
      recordTiming(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [source, status, conf, iou, recordTiming, colorFor]);

  // Camera: draw every frame, run the model as fast as it can keep up.
  useEffect(() => {
    if (source.kind !== "camera") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let busy = false;
    let latest: Detection[] = [];
    let stopped = false;

    const loop = () => {
      if (stopped) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) {
        drawFrame(canvas, video, w, h, latest, colorFor);
        const detector = detectorRef.current;
        if (detector && !busy) {
          busy = true;
          const { conf: c, iou: i } = thresholds.current;
          detector
            .detect(video, w, h, c, i)
            .then(({ detections: dets, inferenceMs: ms }) => {
              latest = dets;
              setDetections(dets.map((d) => ({ ...d, color: colorFor(d.classId) })));
              recordTiming(ms);
            })
            .catch(() => undefined)
            .finally(() => {
              busy = false;
            });
        }
      }
      raf = requestAnimationFrame(loop);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play();
        raf = requestAnimationFrame(loop);
      })
      .catch((err) => {
        if (stopped) return;
        setCameraError(cameraErrorMessage(err));
        setSource({ kind: "none" });
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [source, recordTiming, colorFor]);

  const openImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const bitmap = await createImageBitmap(file);
      classColors.current = new Map();
      setCameraError(null);
      setDetections([]);
      setSource({ kind: "image", bitmap });
    } catch {
      setCameraError("That file could not be opened as an image. Try a JPEG or PNG.");
    }
  };

  const counts = Object.entries(
    detections.reduce<Record<string, { n: number; color: string }>>((acc, d) => {
      const name = COCO_CLASSES[d.classId] ?? String(d.classId);
      acc[name] = { n: (acc[name]?.n ?? 0) + 1, color: d.color };
      return acc;
    }, {}),
  ).sort((a, b) => b[1].n - a[1].n);

  const cameraOn = source.kind === "camera";

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            openImage(e.dataTransfer.files[0]);
          }}
          className={`relative overflow-hidden rounded-[3px] border ${dragging ? "border-accent bg-accent/5" : "border-rule bg-paper-raised"}`}
        >
          {/* Kept in the layout (not display: none) so every browser keeps decoding frames. */}
          <video ref={videoRef} playsInline muted aria-hidden className="pointer-events-none absolute h-px w-px opacity-0" />
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={
              detections.length
                ? `Detected ${counts.map(([name, { n }]) => `${n} ${name}`).join(", ")}.`
                : "Detection output. No objects detected yet."
            }
            className={source.kind === "none" ? "hidden" : "block h-auto w-full"}
          />
          {source.kind === "none" && (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="font-serif text-[20px] text-ink">Upload a photo, drop one here, or turn on your camera.</p>
              <p className="max-w-[46ch] text-[15px] leading-[1.5] text-ink-muted">
                The model runs on your device. Photos and video never leave your browser.
              </p>
            </div>
          )}
        </div>

        {cameraError && (
          <p role="alert" className="mt-3 text-[15px] text-[#9a3412]">
            {cameraError}
          </p>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <div>
            <dt className="text-[14px] text-ink-muted">Objects</dt>
            <dd className="font-serif text-[24px] tabular-nums">{detections.length}</dd>
          </div>
          <div>
            <dt className="text-[14px] text-ink-muted">Inference</dt>
            <dd className="font-serif text-[24px] tabular-nums">{inferenceMs === null ? "–" : `${inferenceMs.toFixed(0)} ms`}</dd>
          </div>
          <div>
            <dt className="text-[14px] text-ink-muted">Model speed</dt>
            <dd className="font-serif text-[24px] tabular-nums">
              {inferenceMs === null ? "–" : `${(1000 / Math.max(inferenceMs, 1)).toFixed(0)} fps`}
            </dd>
          </div>
          <div>
            <dt className="text-[14px] text-ink-muted">Runs on</dt>
            <dd className="font-serif text-[24px]">{backend === "webgpu" ? "WebGPU" : backend === "wasm" ? "WebAssembly" : "–"}</dd>
          </div>
        </dl>

        {counts.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[15px] text-ink">
            {counts.map(([name, { n, color }]) => (
              <li key={name} className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {name}
                <span className="tabular-nums text-ink-muted">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-8 lg:col-span-4">
        <div aria-live="polite" className="text-[15px]">
          {status.kind === "loading" && <p className="text-ink-muted">{status.message}…</p>}
          {status.kind === "ready" && <p className="text-ink">Model ready</p>}
          {status.kind === "error" && (
            <p role="alert" className="text-[#9a3412]">
              {status.message}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-[14px] text-ink-muted">Input</p>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-[3px] border border-ink/25 px-3.5 py-1.5 text-[15px] text-ink hover:border-ink/60 has-focus-visible:outline-2 has-focus-visible:outline-accent">
              Upload a photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  openImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              variant={cameraOn ? "primary" : "secondary"}
              onClick={() => {
                setCameraError(null);
                setDetections([]);
                setSource(cameraOn ? { kind: "none" } : { kind: "camera" });
              }}
            >
              {cameraOn ? "Turn off camera" : "Turn on camera"}
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          <Slider label="Minimum confidence" value={conf} min={0.05} max={0.95} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setConf} />
          <Slider label="Overlap allowed between boxes (IoU)" value={iou} min={0.1} max={0.9} step={0.05} format={(v) => v.toFixed(2)} onChange={setIou} />
        </div>

        {backend && (
          <div>
            <Segmented<Backend>
              legend="Run the model on"
              value={backend}
              onChange={setBackend}
              options={[
                { value: "webgpu", label: "WebGPU", disabled: !gpuOk },
                { value: "wasm", label: "WebAssembly" },
              ]}
            />
            <p className="mt-2 text-[14px] leading-[1.5] text-ink-muted">
              {gpuOk
                ? "WebGPU uses your graphics card. Switch to compare it with the CPU."
                : "WebGPU is not available in this browser, so the model runs on the CPU with WebAssembly."}
            </p>
          </div>
        )}

        <p className="border-t border-rule pt-6 text-[14px] leading-[1.5] text-ink-muted">
          Model: YOLO11n by Ultralytics (AGPL-3.0), trained on the 80 COCO object classes and exported to ONNX.
        </p>
      </div>
    </div>
  );
}
