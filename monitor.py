"""
Real-time stock monitor.

Reads from a webcam / video / image, runs YOLO detection, counts units per
product class, compares against configurable low-stock thresholds, and emits a
JSON payload ready for the Node.js backend / n8n automation workflow.

Usage:
  python monitor.py --source 0 --model models/best.pt
  python monitor.py --source grocery.v9i.yolov8/valid/images --json stock.json
  python monitor.py --source <image> --api http://localhost:4000   # auto-ingest
"""
import argparse
import json
import time
import urllib.request
from collections import Counter
from pathlib import Path

from ultralytics import YOLO

# Per-class reorder (low-stock) thresholds. Any class not listed defaults to 0
# (never "low stock") unless --default-threshold is passed.
THRESHOLDS = {
    "CocaCola20Oz": 6,
    "Sprite20Oz": 6,
    "Fanta20Oz": 6,
    "Oreo": 5,
    "LaysClassic": 5,
    "DoritosNachoCheese": 5,
}


def parse_args():
    p = argparse.ArgumentParser(description="Real-time stock monitoring with alerts")
    p.add_argument("--model", default="models/best.pt")
    p.add_argument("--source", default="0", help="camera index, video file, image, or folder")
    p.add_argument("--conf", type=float, default=0.30)
    p.add_argument("--default-threshold", type=int, default=None,
                   help="Threshold applied to every class (overrides class map)")
    p.add_argument("--json", default=None, help="Write latest stock JSON payload to this file")
    p.add_argument("--api", default=None,
                   help="Node.js backend base URL, e.g. http://localhost:4000 (POSTs each payload to /api/stock/ingest)")
    p.add_argument("--interval", type=float, default=2.0, help="Seconds between analyses")
    p.add_argument("--imgsz", type=int, default=416)
    return p.parse_args()


def analyze(model, frame, conf, thresholds, imgsz=416):
    names = model.names
    results = model(frame, conf=conf, imgsz=imgsz, verbose=False)[0]
    counts = Counter(names[int(b.cls)] for b in results.boxes)
    # Only flag SKUs that were actually detected this pass. Absent SKUs are
    # not "low stock" from a single frame, so they don't create noisy alerts.
    low_stock = {
        name: {"count": counts[name], "threshold": t, "needed": max(t - counts[name], 0)}
        for name, t in thresholds.items()
        if counts[name] > 0 and counts[name] < t
    }
    return counts, low_stock, results.plot()


def main():
    args = parse_args()
    model = YOLO(args.model)

    thresholds = THRESHOLDS
    if args.default_threshold is not None:
        thresholds = {name: args.default_threshold for name in model.names.values()}
    else:
        thresholds = {name: t for name, t in THRESHOLDS.items() if name in model.names.values()}

    source = args.source
    is_live = source in ("0", "1", "2", "3")

    if is_live or source.endswith((".mp4", ".avi", ".mov", ".mkv")):
        import cv2
        cap = cv2.VideoCapture(0 if is_live else source)
        if not cap.isOpened():
            raise SystemExit(f"Cannot open video source: {source}")
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                counts, low_stock, annotated = analyze(model, frame, args.conf, thresholds, args.imgsz)
                emit(counts, low_stock, args.json, args.api)
                cv2.imshow("Stock Monitor", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
                time.sleep(args.interval)
        finally:
            cap.release()
            cv2.destroyAllWindows()
    else:
        path = Path(source)
        imgs = list(path.glob("*")) if path.is_dir() else [path]
        total = Counter()
        for img in imgs:
            if not img.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
                continue
            frame = str(img)
            counts, _, _ = analyze(model, frame, args.conf, thresholds, args.imgsz)
            total.update(counts)
            print(f"{img.name}: {dict(counts)}")
        # Aggregate across the whole batch so one frame missing an SKU does not
        # mark it low-stock. Only SKUs seen anywhere in the batch are evaluated.
        low_stock = {
            name: {"count": total[name], "threshold": t, "needed": max(t - total[name], 0)}
            for name, t in thresholds.items()
            if total[name] > 0 and total[name] < t
        }
        print(f"TOTAL units: {sum(total.values())}")
        emit(total, low_stock, args.json, args.api)


def emit(counts, low_stock, json_path, api=None):
    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_units": int(sum(counts.values())),
        "per_product": dict(counts),
        "low_stock": low_stock,
        "alerts": len(low_stock),
    }
    if json_path:
        Path(json_path).write_text(json.dumps(payload, indent=2))
    else:
        print(json.dumps(payload))
    if api:
        try:
            req = urllib.request.Request(
                f"{api.rstrip('/')}/api/stock/ingest",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                print(f"[INGEST] -> {api}: HTTP {resp.status}")
        except Exception as e:
            print(f"[INGEST] failed -> {api}: {e}")
    if low_stock:
        for name, info in low_stock.items():
            print(f"[ALERT] LOW STOCK: {name} count={info['count']} "
                  f"threshold={info['threshold']} reorder={info['needed']}")


if __name__ == "__main__":
    main()
