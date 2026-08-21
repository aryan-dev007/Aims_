"""Fast CPU training launcher.

Loads the last checkpoint as base weights and resumes training with:
- RAM image caching (avoid slow /mnt/c disk re-reads)
- real dataloader workers (patch ultralytics' CPU workers=0 override)
- smaller imgsz, fewer epochs
"""
import os

os.environ.setdefault("OMP_NUM_THREADS", "8")

import torch
import ultralytics.engine.trainer as ut
from ultralytics import YOLO

_orig_init = ut.BaseTrainer.__init__


def _patched_init(self, *args, **kwargs):
    _orig_init(self, *args, **kwargs)
    if self.device.type in {"cpu", "mps"} and getattr(self.args, "workers", 0) <= 0:
        self.args.workers = min(8, (os.cpu_count() or 1) // 2)


ut.BaseTrainer.__init__ = _patched_init

CHECKPOINT = "runs/detect/runs/detect/stock_subset/weights/last.pt"

model = YOLO(CHECKPOINT)
results = model.train(
    data="subset/data.yaml",
    epochs=6,
    imgsz=256,
    batch=16,
    device="cpu",
    workers=8,
    cache="ram",
    freeze=10,
    mosaic=0.0,
    hsv_h=0.0,
    hsv_s=0.0,
    hsv_v=0.0,
    translate=0.0,
    scale=0.0,
    fliplr=0.0,
    optimizer="AdamW",
    lr0=0.0005,
    cos_lr=True,
    close_mosaic=0,
    patience=8,
    val=True,
    project="runs/detect",
    name="stock_subset",
    exist_ok=True,
    seed=42,
    plots=True,
)
print("Done. Best weights:", results.save_dir)