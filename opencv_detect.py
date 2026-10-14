"""
OpenCV-native grocery stock monitor.

Runs YOLOv8 ONNX inference through OpenCV's DNN module (cv2.dnn) instead of
ultralytics, counts units per product class, evaluates low-stock thresholds and
emits the same JSON payload consumed by the Node.js backend / n8n workflow:

    { timestamp, total_units, per_product: {SKU: count}, low_stock, alerts }

Live mode grabs frames on a background thread so the detector never blocks on
camera/video I/O, draws an on-screen HUD (FPS, counts, low-stock alerts) and
POSTs a throttled ingest to the backend.

Frame streaming: when --api is set, annotated frames are also streamed as
base64 JPEGs to POST /api/frame so the React dashboard can display a live
video feed without direct camera access.

Usage:
  python opencv_detect.py --source 0                                # webcam
  python opencv_detect.py --source runs/demo_shelf.mp4 --loop       # video (looped)
  python opencv_detect.py --source rtsp://user:pass@cam/stream      # IP camera
  python opencv_detect.py --source grocery.v9i.yolov8/valid/images  # batch of photos
  python opencv_detect.py --source img.jpg --api http://localhost:4000
"""
import argparse
import base64
import json
import sys
import threading
import time
import urllib.request
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import yaml

# Per-class low-stock thresholds. Any class not listed defaults to 0 (never alerts).
THRESHOLDS = {
    "Coca cola cold drink": 5,
    "Oreo biscuit": 4,
    "Lipton tea": 3,
    "Lays masala chips": 4,
    "Fanta cold drink": 5,
    "Soap bar": 4,
    "Colgate Paste": 4,
    "Britannia biscuits": 4,
    "Cadbury chocolate": 5,
    "Nescafe coffee": 3,
    "RedLabel Tea": 3,
    "Maggi Noodles": 4,
    "Chings Schezwan Chutney": 3,
    "Amul Item": 4,
    "TajMahal tea": 3,
    "DrOetker": 3,
    "Real juice": 4,
    "Bru coffee": 3,
    "Parle biscuit": 4,
    "Veeba sauce": 3,
}

VIDEO_SUFFIXES = (".mp4", ".avi", ".mov", ".mkv")
IMG_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def parse_args():
    p = argparse.ArgumentParser(description="OpenCV YOLOv8 grocery stock monitor")
    p.add_argument("--model", default="models/best.onnx", help="YOLOv8 ONNX model")
    p.add_argument("--names", default="data.yaml", help="data.yaml with class names")
    p.add_argument("--source", default="0", help="camera index, video, image, folder, or URL")
    p.add_argument("--imgsz", type=int, default=640, help="must match model input size")
    p.add_argument("--conf", type=float, default=0.30)
    p.add_argument("--iou", type=float, default=0.45)
    p.add_argument("--interval", type=float, default=0.0,
                   help="seconds to sleep between live analyses (0 = as fast as possible)")
    p.add_argument("--ingest-interval", type=float, default=3.0,
                   help="seconds between backend ingests in live mode")
    p.add_argument("--stream-fps", type=float, default=5.0,
                   help="max frames per second to stream to dashboard (default 5)")
    p.add_argument("--loop", action="store_true", help="loop video files indefinitely")
    p.add_argument("--no-display", action="store_true", help="run headless (no imshow)")
    p.add_argument("--fallback-to-dataset", action="store_true",
                   help="explicitly use validation images if the camera cannot provide frames")
    p.add_argument("--json", default=None, help="write latest stock JSON payload to this file")
    p.add_argument("--api", default=None,
                   help="Node.js backend base URL, e.g. http://localhost:4000")
    p.add_argument("--save", default="runs/opencv", help="dir for annotated output images")
    return p.parse_args()


def load_names(yaml_path):
    with open(yaml_path, "r") as f:
        data = yaml.safe_load(f)
    names = data.get("names") or []
    return {i: str(n) for i, n in enumerate(names)}


def letterbox(img, size):
    """Resize keeping aspect ratio and pad to `size` (YOLO-style)."""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    new_w, new_h = int(round(w * r)), int(round(h * r))
    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    top = (size - new_h) // 2
    bottom = size - new_h - top
    left = (size - new_w) // 2
    right = size - new_w - left
    padded = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return padded, r, left, top


def decode_predictions(outputs, names, conf_threshold, iou_threshold, size, r, left, top):
    """Decode YOLOv8 [1, 4+nc, num_anchors] output into filtered detections."""
    boxes, scores, class_ids = [], [], []
    preds = outputs.transpose(0, 2, 1)[0]  # [num_anchors, 4+nc]
    for row in preds:
        cx, cy, w, h = row[:4]
        score_row = row[4:]
        cls_id = int(np.argmax(score_row))
        conf = float(score_row[cls_id])
        if conf < conf_threshold:
            continue
        x1 = (cx - w / 2 - left) / r
        y1 = (cy - h / 2 - top) / r
        x2 = (cx + w / 2 - left) / r
        y2 = (cy + h / 2 - top) / r
        boxes.append([x1, y1, x2 - x1, y2 - y1])  # x, y, w, h
        scores.append(conf)
        class_ids.append(cls_id)

    if not boxes:
        return []

    keep = cv2.dnn.NMSBoxes(boxes, scores, conf_threshold, iou_threshold)
    if isinstance(keep, tuple):
        keep = keep[0]
    keep = np.asarray(keep).flatten()

    detections = []
    for i in keep:
        x1, y1, w, h = boxes[i]
        detections.append({
            "class_id": class_ids[i],
            "name": names.get(class_ids[i], f"class_{class_ids[i]}"),
            "conf": scores[i],
            "box": [float(x1), float(y1), float(x1 + w), float(y1 + h)],
        })
    return detections


def analyze(net, frame, names, conf, iou, imgsz):
    h, w = frame.shape[:2]
    padded, r, left, top = letterbox(frame, imgsz)
    blob = cv2.dnn.blobFromImage(padded, 1 / 255.0, (imgsz, imgsz), swapRB=True, crop=False)
    net.setInput(blob)
    outputs = net.forward()  # [1, 66, 1344]

    detections = decode_predictions(outputs, names, conf, iou, imgsz, r, left, top)
    counts = Counter(d["name"] for d in detections)
    low_stock = {
        name: {"count": counts[name], "threshold": t, "needed": max(t - counts[name], 0)}
        for name, t in THRESHOLDS.items()
        if counts[name] < t
    }
    return counts, low_stock, detections


def draw(frame, detections):
    for d in detections:
        x1, y1, x2, y2 = [int(v) for v in d["box"]]
        label = f"{d['name']} {d['conf']:.2f}"
        cv2.rectangle(frame, (x1, y1), (x2, y2), (34, 211, 153), 2)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 4, y1), (34, 211, 153), -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, (2, 6, 23), 1, cv2.LINE_AA)
    return frame


def draw_hud(frame, fps, timestamp, counts, low_stock):
    """Overlay live HUD: timestamp, FPS, per-class counts and low-stock alerts."""
    h, w = frame.shape[:2]
    y = 0
    pad = 10
    cv2.rectangle(frame, (0, 0), (w, 150), (8, 12, 20), -1)
    cv2.putText(frame, timestamp, (pad, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (148, 163, 184), 1, cv2.LINE_AA)
    cv2.putText(frame, f"FPS {fps:5.1f}   |   Units {sum(counts.values())}   |   Classes {len(counts)}",
                (pad, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (148, 163, 184), 1, cv2.LINE_AA)
    y = 74
    for name, n in sorted(counts.items()):
        is_low = name in low_stock
        color = (248, 113, 113) if is_low else (52, 211, 153)
        mark = "  LOW!" if is_low else ""
        cv2.putText(frame, f"{name}: {n}{mark}", (pad, y), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, color, 1, cv2.LINE_AA)
        y += 20
    return frame


class FrameGrabber:
    """Reads frames on a background thread so detection never blocks on I/O."""

    def __init__(self, source, loop=False, fallback_to_dataset=False):
        self.source = source
        self.loop = loop
        self.is_camera = isinstance(source, int) or str(source) in ("0", "1", "2", "3")
        self.stopped = False
        self.frame = None
        self.frames_read = 0
        self.use_image_fallback = False
        self.fallback_to_dataset = fallback_to_dataset
        self.error = None
        self.image_files = []
        self.img_idx = 0

        # Attempt to open VideoCapture
        if self.is_camera and sys.platform == "win32":
            self.cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
        else:
            self.cap = cv2.VideoCapture(source)
        if not self.cap.isOpened():
            self.cap.release()
            self.cap = None
            if not self.fallback_to_dataset or not self._init_fallback():
                raise RuntimeError(f"Cannot open video/camera source: {source}")

        if self.cap and (isinstance(source, int) or str(source) in ("0", "1", "2", "3")):
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _init_fallback(self):
        fallback_dirs = [
            Path("subset/valid/images"),
            Path("grocery.v9i.yolov8/valid/images"),
        ]
        for d in fallback_dirs:
            if d.exists():
                self.image_files = sorted(list(d.glob("*.jpg")) + list(d.glob("*.png")))
                if self.image_files:
                    self.use_image_fallback = True
                    print(f"[FrameGrabber] Falling back to {len(self.image_files)} sample shelf images from {d}")
                    if self.cap:
                        self.cap.release()
                        self.cap = None
                    return True
        return False

    def _run(self):
        failed_reads = 0
        while not self.stopped:
            if self.use_image_fallback:
                if not self.image_files:
                    break
                img_path = str(self.image_files[self.img_idx % len(self.image_files)])
                frame = cv2.imread(img_path)
                if frame is not None:
                    self.frame = frame
                    self.frames_read += 1
                self.img_idx += 1
                time.sleep(1.5) # cycle images every 1.5 seconds
            else:
                ok, frame = self.cap.read()
                if not ok or frame is None:
                    failed_reads += 1
                    if failed_reads >= 3:
                        if self.loop and self.cap and not self.is_camera:
                            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            failed_reads = 0
                            continue
                        if self.fallback_to_dataset and self._init_fallback():
                            continue
                        self.error = RuntimeError("Camera/video stopped producing frames")
                        print(f"[FrameGrabber] ERROR: {self.error}")
                        self.stopped = True
                        continue
                    time.sleep(0.1)
                    continue
                failed_reads = 0
                self.frame = frame
                self.frames_read += 1

    def latest(self):
        return self.frame

    def close(self):
        self.stopped = True
        time.sleep(0.05)
        if self.cap:
            self.cap.release()


def stream_frame(api, annotated, fps, counts, low_stock):
    """Encode the annotated frame as base64 JPEG and POST to /api/frame."""
    try:
        # Resize for streaming efficiency (max 640px wide)
        h, w = annotated.shape[:2]
        if w > 640:
            scale = 640 / w
            annotated = cv2.resize(annotated, (640, int(h * scale)))

        _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
        b64 = base64.b64encode(buf).decode("ascii")

        payload = {
            "frame": b64,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "fps": round(fps, 1),
            "counts": dict(counts),
            "low_stock": dict(low_stock) if low_stock else {},
        }

        req = urllib.request.Request(
            f"{api.rstrip('/')}/api/frame",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        # Don't let frame streaming errors crash the detector
        pass


def emit(counts, low_stock, json_path, api, save_dir=None, frame=None, filename="frame",
         names=None):
    low_stock = low_stock or {}
    class_names = names.values() if names else counts.keys()
    per_product = {
        name: int(counts.get(name, 0))
        for name in class_names
    }
    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_units": int(sum(per_product.values())),
        "per_product": per_product,
        "low_stock": low_stock,
        "alerts": len(low_stock),
    }
    if json_path:
        Path(json_path).write_text(json.dumps(payload, indent=2))
    if api:
        try:
            req = urllib.request.Request(
                f"{api.rstrip('/')}/api/stock/ingest",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                pg_result = result.get("postgres", {})
                print(
                    f"[{time.strftime('%H:%M:%S')}] [INGEST] HTTP {resp.status}; "
                    f"PostgreSQL changed={pg_result.get('changed', [])}, "
                    f"unknown={pg_result.get('unknown', [])}"
                )
        except Exception as e:
            print(f"[INGEST] failed -> {api}: {e}")
    if save_dir and frame is not None:
        out = Path(save_dir)
        out.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out / f"{filename}.jpg"), frame)
    if low_stock:
        for name, info in low_stock.items():
            print(f"[{time.strftime('%H:%M:%S')}] [ALERT] LOW STOCK: {name} count={info['count']} "
                  f"threshold={info['threshold']} reorder={info['needed']}")


def run_live(args, net, names):
    source = args.source
    is_webcam = str(source) in ("0", "1", "2", "3")
    is_url = str(source).startswith(("rtsp://", "http://", "https://"))

    try:
        grabber = FrameGrabber(
            int(source) if is_webcam else source,
            loop=args.loop,
            fallback_to_dataset=args.fallback_to_dataset,
        )
    except RuntimeError as e:
        hint = ("\nNo webcam available. On WSL2 enable USB/webcam passthrough "
                "(usbipd-win) or use a video/RTSP source, e.g. "
                "--source runs/demo_shelf.mp4 --loop") if is_webcam else ""
        raise SystemExit(f"{e}{hint}")

    window = "Grocery Stock Monitor (OpenCV)"
    last_ingest = 0.0
    last_stream = 0.0
    last_detect = 0.0
    fps = 0.0
    alpha = 0.9
    frame_idx = 0
    stream_interval = 1.0 / max(args.stream_fps, 0.5)  # seconds between streamed frames

    print(f"[LIVE] Streaming frames to dashboard at ~{args.stream_fps} fps")
    print(f"[LIVE] Ingesting stock data every {args.ingest_interval}s")

    try:
        while not grabber.stopped:
            frame = grabber.latest()
            if frame is None:
                time.sleep(0.01)
                continue

            now = time.time()
            fps = alpha * fps + (1 - alpha) * (1.0 / max(now - last_detect, 1e-6))
            last_detect = now

            counts, low_stock, detections = analyze(
                net, frame, names, args.conf, args.iou, args.imgsz
            )
            frame_idx += 1
            annotated = draw(frame.copy(), detections)
            annotated = draw_hud(
                annotated, fps, time.strftime("%Y-%m-%d %H:%M:%S"), counts, low_stock
            )

            # Ingest stock counts to backend (throttled)
            if args.api and now - last_ingest >= args.ingest_interval:
                emit(counts, low_stock, args.json, args.api, names=names)
                last_ingest = now

            # Stream annotated frame to dashboard (throttled by stream_fps)
            if args.api and now - last_stream >= stream_interval:
                # Run frame streaming in a separate thread to avoid blocking
                threading.Thread(
                    target=stream_frame,
                    args=(args.api, annotated.copy(), fps, counts, low_stock),
                    daemon=True,
                ).start()
                last_stream = now

            if args.no_display and frame_idx % 150 == 1:
                print(f"[{time.strftime('%H:%M:%S')}] [STATS] fps={fps:.1f} "
                      f"units={sum(counts.values())} detected={dict(counts)}")

            if not args.no_display:
                cv2.imshow(window, annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            elif args.save and frame_idx % 30 == 1:
                out = Path(args.save)
                out.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(out / f"live_{time.strftime('%H%M%S')}_{frame_idx:05d}.jpg"), annotated)

            if args.interval > 0:
                time.sleep(args.interval)
    finally:
        grabber.close()
        cv2.destroyAllWindows()
    if grabber.error:
        raise SystemExit(f"[LIVE] {grabber.error}")
    print(f"Live run finished: {frame_idx} frames analysed.")


def run_batch(args, net, names):
    path = Path(args.source)
    imgs = sorted(path.glob("*")) if path.is_dir() else [path]
    total = Counter()
    for img in imgs:
        if img.suffix.lower() not in IMG_SUFFIXES:
            continue
        frame = cv2.imread(str(img))
        if frame is None:
            continue
        counts, _, detections = analyze(net, frame, names, args.conf, args.iou, args.imgsz)
        total.update(counts)
        annotated = draw(frame.copy(), detections)
        emit(counts, None, None, None, args.save, annotated, img.stem, names)
        print(f"{img.name}: {dict(counts)}")
    low_stock = {
        name: {"count": total[name], "threshold": t, "needed": max(t - total[name], 0)}
        for name, t in THRESHOLDS.items()
        if total[name] < t
    }
    print(f"TOTAL units: {sum(total.values())}")
    emit(total, low_stock, args.json, args.api, names=names)


def main():
    args = parse_args()
    
    # Find the correct yaml for class names
    names_path = args.names
    if names_path == "data.yaml":
        yaml_paths = [
            "data.yaml",
            "unified_dataset/data.yaml",
            "focused_dataset/data.yaml"
        ]
        for p in yaml_paths:
            if Path(p).exists():
                names_path = p
                break
                
    names = load_names(names_path)
    net = cv2.dnn.readNetFromONNX(args.model)
    print(f"Loaded {args.model} | {len(names)} classes from {names_path} | imgsz {args.imgsz}")

    source = args.source
    is_webcam = str(source) in ("0", "1", "2", "3")
    is_url = str(source).startswith(("rtsp://", "http://", "https://"))

    if is_webcam or is_url or str(source).endswith(VIDEO_SUFFIXES):
        run_live(args, net, names)
    else:
        run_batch(args, net, names)


if __name__ == "__main__":
    main()
