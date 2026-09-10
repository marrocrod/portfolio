"""Export YOLO11n to ONNX for in-browser inference with ONNX Runtime Web.

Usage (from the repository root, with the virtual environment active):
    pip install -r python/vision/requirements.txt
    python python/vision/export_yolo.py

Writes public/models/yolo11n.onnx and checks that its input and output
shapes match what the web app expects.
"""

import os
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "public" / "models"
OUT_FILE = OUT_DIR / "yolo11n.onnx"
# Ultralytics downloads weights into the working directory, so work in a
# git-ignored folder instead of the repository root.
WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"
IMG_SIZE = 640


def export() -> Path:
    WEIGHTS_DIR.mkdir(exist_ok=True)
    os.chdir(WEIGHTS_DIR)
    # Weights are downloaded on first use. Export runs on the CPU; no GPU needed.
    model = YOLO("yolo11n.pt")
    exported = model.export(
        format="onnx",
        imgsz=IMG_SIZE,
        opset=17,
        simplify=True,
        dynamic=False,  # fixed 1x3x640x640 input, which is what the browser sends
        half=False,  # float32 keeps the WebAssembly backend supported
        nms=False,  # NMS is done in TypeScript so thresholds can change live
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(exported, OUT_FILE)
    return OUT_FILE


def verify(path: Path) -> None:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    inp = session.get_inputs()[0]
    out = session.get_outputs()[0]
    dummy = np.zeros((1, 3, IMG_SIZE, IMG_SIZE), dtype=np.float32)
    (result,) = session.run([out.name], {inp.name: dummy})

    print(f"input  {inp.name}: {inp.shape}")
    print(f"output {out.name}: {list(result.shape)}")
    # 4 box coordinates + 80 COCO class scores for 8400 anchors
    assert list(result.shape) == [1, 84, 8400], "Unexpected output shape"
    print(f"OK: {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    verify(export())
